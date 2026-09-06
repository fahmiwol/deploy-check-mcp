/**
 * checks.js — the actual work, with no MCP in sight so it can be tested and imported alone.
 *
 * Every check returns findings, not just numbers. A number tells you the page has 0
 * characters of visible text; a finding tells you that is what a broken bundle looks
 * like and what to look at next. The findings are the product.
 */
'use strict';

const H = require('./html');

const UA = 'deploy-check-mcp (+https://github.com/fahmiwol/deploy-check-mcp)';
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** A page that returns 200 with less than this much text has almost certainly not rendered. */
const BLANK_TEXT_THRESHOLD = 50;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function finding(level, code, message) {
  return { level, code, message };
}

/**
 * fetch with a hard timeout and a byte cap, returning the redirect chain rather than
 * hiding it: "it works" and "it works after three redirects to a different host" are
 * different answers.
 */
async function request(url, { method = 'GET', timeoutMs = DEFAULT_TIMEOUT_MS, maxHops = 10 } = {}) {
  const chain = [];
  let current = url;
  const started = Date.now();

  for (let hop = 0; hop <= maxHops; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), clamp(timeoutMs, 1000, 60000));
    let res;
    try {
      res = await fetch(current, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      });
    } finally {
      clearTimeout(timer);
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      let next;
      try { next = new URL(location, current).toString(); } catch { next = null; }
      if (!next) break;
      chain.push({ from: current, status: res.status, to: next });
      current = next;
      if (hop === maxHops) {
        return { url: current, status: res.status, chain, tooManyRedirects: true, ms: Date.now() - started, headers: {}, body: '' };
      }
      continue;
    }

    let body = '';
    let bytes = 0;
    let truncated = false;
    if (method !== 'HEAD' && res.body) {
      const chunks = [];
      for await (const chunk of res.body) {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) { truncated = true; break; }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString('utf8');
    }

    const headers = {};
    for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;

    return {
      url: current, status: res.status, chain, headers, body,
      bytes: bytes || Buffer.byteLength(body), truncated, ms: Date.now() - started,
    };
  }
  return { url: current, status: 0, chain, headers: {}, body: '', bytes: 0, ms: Date.now() - started };
}

function assertHttpUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Not a valid URL: ' + url); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http and https URLs can be checked, got: ' + parsed.protocol);
  return parsed.toString();
}

/**
 * The main check. Answers the question people actually ask after a deploy:
 * "is the page up, and does it show anything?"
 */
async function checkPage(url, { timeoutMs } = {}) {
  const target = assertHttpUrl(url);
  let res;
  try {
    res = await request(target, { timeoutMs });
  } catch (e) {
    return {
      url: target, ok: false, reachable: false,
      findings: [finding('error', 'unreachable', describeNetworkError(e, target))],
      verdict: 'Could not reach the page at all.',
    };
  }

  const html = res.body || '';
  const contentType = (res.headers['content-type'] || '').toLowerCase();
  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(html);
  const text = isHtml ? H.visibleText(html) : html.trim();

  const page = {
    url: res.url,
    requestedUrl: target,
    status: res.status,
    redirects: res.chain,
    ms: res.ms,
    bytes: res.bytes,
    contentType: res.headers['content-type'] || null,
    isHtml,
    visibleTextLength: text.length,
    textPreview: text.slice(0, 300),
    title: isHtml ? H.title(html) : null,
    description: isHtml ? H.metaContent(html, { name: 'description' }) : null,
    ogTitle: isHtml ? H.metaContent(html, { property: 'og:title' }) : null,
    ogImage: isHtml ? H.metaContent(html, { property: 'og:image' }) : null,
    canonical: isHtml ? H.canonical(html) : null,
    lang: isHtml ? H.htmlLang(html) : null,
    viewport: isHtml ? H.metaContent(html, { name: 'viewport' }) : null,
    noindex: /noindex/i.test(H.metaContent(html, { name: 'robots' }) || ''),
    assets: isHtml ? H.assetCounts(html) : null,
    truncated: !!res.truncated,
  };

  page.findings = judgePage(page);
  page.ok = !page.findings.some((f) => f.level === 'error');
  page.reachable = true;
  page.verdict = summarise(page);
  return page;
}

function describeNetworkError(e, url) {
  const name = e && (e.cause && e.cause.code) ? e.cause.code : e && e.name;
  if (name === 'AbortError' || e.name === 'TimeoutError') return 'Timed out before the server responded.';
  if (name === 'ENOTFOUND') return 'DNS did not resolve ' + new URL(url).hostname + '. The domain may not exist or may not be pointed anywhere yet.';
  if (name === 'ECONNREFUSED') return 'The connection was refused. Nothing is listening on that host and port.';
  if (name === 'CERT_HAS_EXPIRED') return 'The TLS certificate has expired.';
  if (String(name || '').startsWith('ERR_TLS') || String(e && e.message).includes('certificate')) return 'The TLS certificate was rejected: ' + (e.message || name);
  return 'Request failed: ' + ((e && e.message) || String(e));
}

/** Opinions, in the order a person would care about them. */
function judgePage(p) {
  const out = [];

  if (p.status === 0) out.push(finding('error', 'no_response', 'No response was received.'));
  else if (p.status >= 500) out.push(finding('error', 'server_error', 'The server returned ' + p.status + '. This is the server failing, not a missing page.'));
  else if (p.status === 404) out.push(finding('error', 'not_found', 'The server returned 404. The route does not exist at this host.'));
  else if (p.status >= 400) out.push(finding('error', 'client_error', 'The server returned ' + p.status + '.'));

  if (p.status >= 200 && p.status < 300 && p.isHtml) {
    const scripts = (p.assets && p.assets.scripts) || 0;
    /* Blank HTML means two very different things. With no scripts, nothing can ever fill
       the page and it is simply broken. With scripts, a single-page app looks exactly like
       this when it is perfectly healthy, and this tool cannot run JavaScript to tell the
       difference. Calling every SPA broken would make the whole tool worth ignoring, so the
       uncertainty is reported honestly instead of guessed at. */
    if (p.visibleTextLength === 0 && scripts === 0) {
      out.push(finding('error', 'blank_render',
        'The page returned ' + p.status + ' and ' + p.bytes + ' bytes, loads no scripts, and renders no '
        + 'visible text at all. Nothing can fill this page later, so it is broken as served. Usual causes: '
        + 'a deploy that published the wrong directory, or a template that rendered empty.'));
    } else if (p.visibleTextLength === 0) {
      out.push(finding('warn', 'blank_html',
        'The page returned ' + p.status + ' and ' + p.bytes + ' bytes but renders no visible text in the HTML. '
        + 'It loads ' + scripts + ' script tag(s), so this is either a single-page app behaving normally, or a '
        + 'bundle that failed to load or threw. This tool does not run JavaScript and cannot tell those apart — '
        + 'open it in a browser and read the console. If you expected server-rendered HTML here, it is broken.'));
    } else if (p.visibleTextLength < BLANK_TEXT_THRESHOLD) {
      out.push(finding('warn', 'almost_blank',
        'Only ' + p.visibleTextLength + ' characters of visible text'
        + (scripts ? ', with ' + scripts + ' script tag(s) — most likely rendered client-side.' : '.')
        + ' If this is meant to be a full page, something did not render.'));
    }
  }

  if (p.redirects.length) {
    const last = p.redirects[p.redirects.length - 1];
    const from = new URL(p.requestedUrl).host;
    const to = new URL(last.to).host;
    const level = p.redirects.length > 2 ? 'warn' : 'info';
    out.push(finding(level, 'redirected',
      'Redirected ' + p.redirects.length + ' time(s), ending at ' + p.url
      + (from !== to ? ' — note the host changed from ' + from + ' to ' + to + '.' : '.')));
  }

  if (p.isHtml && p.status < 400) {
    if (!p.title) out.push(finding('warn', 'no_title', 'No <title>. Browser tabs, search results and shared links will all show the bare URL.'));
    else if (p.title.length > 70) out.push(finding('info', 'long_title', 'The <title> is ' + p.title.length + ' characters; search results usually cut off near 60.'));
    if (!p.description) out.push(finding('info', 'no_description', 'No meta description. Search engines will invent one from the page text.'));
    if (!p.viewport) out.push(finding('warn', 'no_viewport', 'No viewport meta tag. On a phone this page will render at desktop width and be zoomed out.'));
    if (!p.lang) out.push(finding('info', 'no_lang', 'No lang attribute on <html>. Screen readers guess the language.'));
    if (p.noindex) out.push(finding('warn', 'noindex', 'This page asks search engines not to index it. If this is production, that is probably a leftover from staging.'));
    if (!p.ogImage) out.push(finding('info', 'no_og_image', 'No og:image. Links to this page will share without a preview image.'));
  }

  if (p.ms > 3000) out.push(finding('warn', 'slow', 'Took ' + p.ms + ' ms to respond.'));
  if (p.truncated) out.push(finding('info', 'truncated', 'The body was larger than the read limit and was truncated; text length is a floor, not the total.'));

  return out;
}

function summarise(p) {
  const errors = p.findings.filter((f) => f.level === 'error');
  if (errors.length) return errors[0].message;
  const warns = p.findings.filter((f) => f.level === 'warn');
  const base = 'Up (' + p.status + ', ' + p.ms + ' ms) and rendering ' + p.visibleTextLength + ' characters of visible text';
  return warns.length ? base + '; ' + warns.length + ' thing(s) worth a look.' : base + '. Nothing to flag.';
}

/**
 * Broken links, checked politely: capped count, capped concurrency, HEAD first and
 * GET only when a server rejects HEAD (many do, with 405 or 403).
 */
async function checkLinks(url, { limit = 50, concurrency = 6, timeoutMs = 10000, sameHostOnly = false } = {}) {
  const target = assertHttpUrl(url);
  const page = await request(target, { timeoutMs });
  if (!page.body) return { url: target, checked: 0, links: [], broken: [], verdict: 'No HTML body to read links from.' };

  const host = new URL(page.url).host;
  let found = H.links(page.body, page.url);
  if (sameHostOnly) found = found.filter((l) => new URL(l.url).host === host);

  const total = found.length;
  const slice = found.slice(0, clamp(limit, 1, 200));
  const lanes = clamp(concurrency, 1, 10);
  const results = [];
  let cursor = 0;

  await Promise.all(Array.from({ length: lanes }, async () => {
    while (cursor < slice.length) {
      const item = slice[cursor++];
      results.push(await checkOneLink(item, timeoutMs));
    }
  }));

  results.sort((a, b) => slice.findIndex((s) => s.url === a.url) - slice.findIndex((s) => s.url === b.url));
  const broken = results.filter((r) => r.broken);
  return {
    url: page.url,
    totalLinksOnPage: total,
    checked: results.length,
    notChecked: Math.max(0, total - results.length),
    links: results,
    broken,
    verdict: broken.length
      ? broken.length + ' of ' + results.length + ' checked link(s) are broken.'
      : 'All ' + results.length + ' checked link(s) resolved.',
  };
}

async function checkOneLink(item, timeoutMs) {
  try {
    let res = await request(item.url, { method: 'HEAD', timeoutMs });
    /* Plenty of servers refuse HEAD outright; that is not a broken link, so ask again properly. */
    if (res.status === 405 || res.status === 403 || res.status === 501 || res.status === 0) {
      res = await request(item.url, { method: 'GET', timeoutMs });
    }
    return {
      url: item.url, written: item.written, status: res.status,
      finalUrl: res.url, redirects: res.chain.length,
      broken: res.status === 0 || res.status >= 400,
      reason: res.status >= 400 ? 'HTTP ' + res.status : null,
    };
  } catch (e) {
    return { url: item.url, written: item.written, status: 0, broken: true, reason: describeNetworkError(e, item.url) };
  }
}

/**
 * Two URLs, same signals. This is the "did my deploy actually land?" question:
 * staging against production, or the same URL before and after a release.
 */
async function comparePages(urlA, urlB, opts = {}) {
  const [a, b] = await Promise.all([checkPage(urlA, opts), checkPage(urlB, opts)]);
  const fields = ['status', 'title', 'description', 'canonical', 'visibleTextLength', 'bytes'];
  const differences = [];
  for (const f of fields) {
    if (a[f] !== b[f]) differences.push({ field: f, a: a[f], b: b[f] });
  }
  const same = a.textPreview === b.textPreview && a.visibleTextLength === b.visibleTextLength;
  return {
    a, b, differences,
    identicalContent: same,
    verdict: same
      ? 'Both pages render the same visible text. If you expected a change, the deploy has not landed here.'
      : differences.length
        ? 'The pages differ in: ' + differences.map((d) => d.field).join(', ') + '.'
        : 'The pages differ in body text but match on every headline signal.',
  };
}

module.exports = {
  checkPage, checkLinks, comparePages, request, assertHttpUrl,
  BLANK_TEXT_THRESHOLD, judgePage, describeNetworkError,
};
