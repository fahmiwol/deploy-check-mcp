/**
 * End-to-end over real stdio, using the official client. Unit tests prove the checks
 * are right; this proves the thing you actually install starts, lists its tools and
 * answers a call. A server that passes its unit tests and fails to hand-shake is
 * still broken from the buyer's side.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'src', 'server.js');

let site;
let base;
let client;

test.before(async () => {
  site = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="en"><head><title>Fixture</title>'
      + '<meta name="viewport" content="width=device-width"></head>'
      + '<body><p>A page with enough visible words to count as rendered.</p></body></html>');
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + site.address().port;

  client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
});

test.after(async () => {
  if (client) await client.close();
  if (site) site.close();
});

test('the server hand-shakes and lists all three tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['check_links', 'check_page', 'compare_pages']);
});

test('every tool declares itself read-only, which is what reviewers check first', async () => {
  const { tools } = await client.listTools();
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, t.name + ' must be marked read-only');
    assert.equal(t.annotations?.destructiveHint, false, t.name + ' must not be marked destructive');
    assert.ok(t.description && t.description.length > 40, t.name + ' needs a real description');
  }
});

test('check_page returns a usable answer through the protocol', async () => {
  const r = await client.callTool({ name: 'check_page', arguments: { url: base + '/' } });
  assert.ok(!r.isError, 'should not be an error');
  const text = r.content.map((c) => c.text).join('\n');
  assert.match(text, /Up \(200/);
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  assert.equal(json.title, 'Fixture');
  assert.ok(json.visibleTextLength > 20);
});

test('a bad URL comes back as a tool error, not a crash', async () => {
  const r = await client.callTool({ name: 'check_page', arguments: { url: 'file:///etc/passwd' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Only http and https/);
  /* and the server must still be alive afterwards */
  const { tools } = await client.listTools();
  assert.equal(tools.length, 3);
});
