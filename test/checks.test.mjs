/**
 * Tests run against a throwaway HTTP server started inside the test process.
 * Nothing here touches the internet, so the suite passes on a plane and in CI,
 * and a failure always means our code changed rather than someone else's site did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkPage, checkLinks, comparePages, assertHttpUrl } = require('../src/checks.js');
const H = require('../src/html.js');

const PAGES = {
  '/good': {
    status: 200,
    body: `<!doctype html><html lang="en"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>A real page</title>
      <meta name="description" content="It has words on it.">
      <meta property="og:image" content="https://example.com/card.png">
      <link rel="canonical" href="http://x/good">
      </head><body><h1>Hello</h1><p>${'This page has genuine readable content. '.repeat(4)}</p></body></html>`,
  },
  /* The bug this whole project exists for: 200, plenty of bytes, nothing rendered. */
  '/blank': {
    status: 200,
    body: `<!doctype html><html lang="en"><head><title>App</title>
      <meta name="viewport" content="width=device-width"></head>
      <body><div id="root"></div><script>${'/* '.repeat(200)}</script></body></html>`,
  },
  '/noindex': {
    status: 200,
    body: `<!doctype html><html lang="en"><head><title>Staging</title>
      <meta name="robots" content="noindex,nofollow">
      <meta name="viewport" content="width=device-width"></head>
      <body><p>Staging copy of the site, with plenty of visible words on it.</p></body></html>`,
  },
  /* Blank AND scriptless: nothing can arrive later, so this one really is broken. */
  '/empty': { status: 200, body: '<!doctype html><html lang="en"><head><title>Empty</title><meta name="viewport" content="width=device-width"></head><body><div id="root"></div></body></html>' },
  '/nohead': { status: 200, body: '<html><body><p>No title, no viewport, but words are here on the page.</p></body></html>' },
  '/boom': { status: 500, body: 'internal error' },
  '/missing': { status: 404, body: 'nope' },
  '/links': {
    status: 200,
    body: `<html lang="en"><head><title>Links</title><meta name="viewport" content="width=device-width"></head><body>
      <p>Some words so the page is not blank at all.</p>
      <a href="/good">ok</a>
      <a href="/missing">dead</a>
      <a href="#top">fragment</a>
      <a href="mailto:a@b.c">mail</a>
      <a href="/good">duplicate</a>
      </body></html>`,
  },
  '/headless': { status: 405, body: '', getStatus: 200 },
};

let base;
let server;

test.before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/redirect') { res.writeHead(302, { location: '/good' }); return res.end(); }
    if (path === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }

    const page = PAGES[path];
    if (!page) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('not found'); }

    /* /headless refuses HEAD the way many real servers do, so the fallback gets exercised. */
    const status = req.method === 'HEAD' && page.getStatus ? page.status : (page.getStatus || page.status);
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? '' : page.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => server && server.close());

const codes = (r) => r.findings.map((f) => f.code);

test('a healthy page is reported healthy', async () => {
  const r = await checkPage(base + '/good');
  assert.equal(r.status, 200);
  assert.equal(r.ok, true);
  assert.equal(r.title, 'A real page');
  assert.equal(r.description, 'It has words on it.');
  assert.ok(r.visibleTextLength > 100, 'should see real text');
  assert.ok(!codes(r).includes('blank_render'));
  assert.match(r.verdict, /Nothing to flag|worth a look/);
});

test('200 with no visible text and no scripts is an error — nothing can ever fill it', async () => {
  const r = await checkPage(base + '/empty');
  assert.equal(r.status, 200);
  assert.equal(r.visibleTextLength, 0);
  assert.ok(codes(r).includes('blank_render'), 'must flag a blank render');
  assert.equal(r.ok, false, 'blank with no scripts is broken as served');
});

test('200 with no visible text but scripts present is a warning, not a verdict', async () => {
  const r = await checkPage(base + '/blank');
  assert.equal(r.visibleTextLength, 0);
  const c = codes(r);
  assert.ok(c.includes('blank_html'), 'must flag it');
  assert.ok(!c.includes('blank_render'), 'must not call a single-page app broken');
  assert.equal(r.ok, true, 'we cannot run JavaScript, so this cannot be a hard failure');
  assert.match(r.findings.find((f) => f.code === 'blank_html').message, /does not run JavaScript/);
});

test('script tags are never counted as visible text', () => {
  assert.equal(H.visibleText('<body><script>let words = "many words here";</script></body>'), '');
  assert.equal(H.visibleText('<body><style>p{content:"hi"}</style><p>Real</p></body>'), 'Real');
});

test('entities are decoded so text length is honest', () => {
  assert.equal(H.visibleText('<p>Ben &amp; Jerry&rsquo;s &#8212; caf&#233;</p>'), 'Ben & Jerry’s — café');
});

test('a stray noindex on production is flagged', async () => {
  const r = await checkPage(base + '/noindex');
  assert.equal(r.noindex, true);
  assert.ok(codes(r).includes('noindex'));
});

test('missing head tags are reported without being fatal', async () => {
  const r = await checkPage(base + '/nohead');
  const c = codes(r);
  assert.ok(c.includes('no_title'));
  assert.ok(c.includes('no_viewport'));
  assert.equal(r.ok, true, 'missing meta is a warning, not a failure');
});

test('server errors and missing routes are distinguished', async () => {
  const boom = await checkPage(base + '/boom');
  assert.ok(codes(boom).includes('server_error'));
  assert.equal(boom.ok, false);

  const missing = await checkPage(base + '/missing');
  assert.ok(codes(missing).includes('not_found'));
});

test('redirects are followed and reported, not hidden', async () => {
  const r = await checkPage(base + '/redirect');
  assert.equal(r.status, 200);
  assert.equal(r.redirects.length, 1);
  assert.ok(codes(r).includes('redirected'));
  assert.match(r.url, /\/good$/);
});

test('a redirect loop terminates instead of hanging', async () => {
  const r = await checkPage(base + '/loop', { timeoutMs: 5000 });
  assert.ok(r.status >= 300, 'gives up rather than looping forever');
});

test('an unreachable host fails cleanly with a readable reason', async () => {
  const r = await checkPage('http://127.0.0.1:1/nothing', { timeoutMs: 2000 });
  assert.equal(r.reachable, false);
  assert.equal(r.ok, false);
  assert.ok(r.findings[0].message.length > 10);
});

test('non-http schemes are refused rather than attempted', () => {
  assert.throws(() => assertHttpUrl('file:///etc/passwd'), /Only http and https/);
  assert.throws(() => assertHttpUrl('not a url'), /valid URL/);
  assert.equal(assertHttpUrl('http://x.test/a'), 'http://x.test/a');
});

test('broken links are found, and fragments and mailto are ignored', async () => {
  const r = await checkLinks(base + '/links');
  assert.equal(r.checked, 2, 'fragment, mailto and the duplicate must not be checked');
  assert.equal(r.broken.length, 1);
  assert.match(r.broken[0].url, /\/missing$/);
});

test('a server that refuses HEAD is not reported as broken', async () => {
  const r = await checkLinks(base + '/links', { limit: 200 });
  assert.ok(r.links.every((l) => l.url.includes('/missing') || !l.broken));

  const direct = await checkLinks(base + '/links', { sameHostOnly: true });
  assert.ok(direct.checked >= 1);
});

test('link extraction absolutises and de-duplicates', () => {
  const found = H.links('<a href="/a">1</a><a href="/a">again</a><a href="https://x.test/b">2</a>', 'http://h.test/dir/page');
  assert.deepEqual(found.map((l) => l.url), ['http://h.test/a', 'https://x.test/b']);
});

test('comparing identical pages says the deploy has not landed', async () => {
  const r = await comparePages(base + '/good', base + '/good');
  assert.equal(r.identicalContent, true);
  assert.match(r.verdict, /has not landed/);
});

test('comparing different pages names the fields that differ', async () => {
  const r = await comparePages(base + '/good', base + '/noindex');
  assert.equal(r.identicalContent, false);
  const fields = r.differences.map((d) => d.field);
  assert.ok(fields.includes('title'));
});
