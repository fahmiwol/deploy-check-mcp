#!/usr/bin/env node
/**
 * server.js — the MCP surface. All the thinking lives in checks.js; this file only
 * describes the tools and formats replies.
 *
 * Every tool here is read-only and network-touching, and says so in its annotations.
 * That matters: an agent that knows a tool cannot change anything will use it freely,
 * and directory reviewers check those hints before anything else.
 *
 * This server uses the official MCP SDK on purpose. If you want to see how the
 * protocol works underneath — a zero-dependency runtime and a probe that tests any
 * MCP server — that is a different project, linked in the README.
 */
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const { checkPage, checkLinks, comparePages } = require('./checks');

const pkg = require('../package.json');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Replies carry both a readable summary and the raw JSON, so a human and a model each get what they need. */
function reply(summary, data) {
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: '```json\n' + JSON.stringify(data, null, 2) + '\n```' },
    ],
  };
}

function fail(e) {
  return { isError: true, content: [{ type: 'text', text: (e && e.message) || String(e) }] };
}

function describeFindings(findings) {
  if (!findings || !findings.length) return '';
  const order = { error: 0, warn: 1, info: 2 };
  const mark = { error: 'FAIL', warn: 'WARN', info: 'note' };
  return '\n\n' + [...findings]
    .sort((a, b) => order[a.level] - order[b.level])
    .map((f) => mark[f.level] + '  ' + f.message)
    .join('\n');
}

const server = new McpServer({ name: 'deploy-check', version: pkg.version });

server.registerTool(
  'check_page',
  {
    title: 'Check a page is up and actually rendering',
    description:
      'Fetch a URL and report whether it is genuinely working: status, redirect chain, response time, '
      + 'and — the part people miss — how much visible text it actually renders. A page can return 200, '
      + 'weigh half a megabyte and still show a human nothing. Also reports title, meta description, '
      + 'viewport, canonical, og:image and a stray noindex. Use this right after a deploy.',
    inputSchema: {
      url: z.string().describe('The page to check, including http:// or https://. localhost works.'),
      timeoutMs: z.number().int().min(1000).max(60000).optional().describe('Give up after this many milliseconds. Default 15000.'),
    },
    annotations: { ...READ_ONLY, title: 'Check a page' },
  },
  async ({ url, timeoutMs }) => {
    try {
      const r = await checkPage(url, { timeoutMs });
      return reply(r.verdict + describeFindings(r.findings), r);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'check_links',
  {
    title: 'Find broken links on a page',
    description:
      'Read every link on a page and check each one resolves. Uses HEAD first and falls back to GET for '
      + 'servers that refuse it, so a 405 is not mistaken for a dead link. Capped and rate-limited by '
      + 'default so it stays polite to the sites it touches.',
    inputSchema: {
      url: z.string().describe('The page whose links should be checked.'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum links to check. Default 50.'),
      concurrency: z.number().int().min(1).max(10).optional().describe('Parallel requests. Default 6.'),
      sameHostOnly: z.boolean().optional().describe('Only check links pointing at the same host. Default false.'),
      timeoutMs: z.number().int().min(1000).max(60000).optional(),
    },
    annotations: { ...READ_ONLY, title: 'Check links' },
  },
  async ({ url, limit, concurrency, sameHostOnly, timeoutMs }) => {
    try {
      const r = await checkLinks(url, { limit, concurrency, sameHostOnly, timeoutMs });
      const list = r.broken.length
        ? '\n\n' + r.broken.map((b) => 'BROKEN  ' + b.url + '  (' + (b.reason || 'unknown') + ')').join('\n')
        : '';
      return reply(r.verdict + list, r);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'compare_pages',
  {
    title: 'Compare two pages, or the same page before and after',
    description:
      'Check two URLs and report where they differ: status, title, description, canonical, visible text '
      + 'length and byte size. This answers "did my deploy actually land?" — point it at staging and '
      + 'production, or at the same URL before and after a release. If both render identical text, the '
      + 'deploy has not reached the second one.',
    inputSchema: {
      urlA: z.string().describe('First URL, for example your staging site.'),
      urlB: z.string().describe('Second URL, for example production.'),
      timeoutMs: z.number().int().min(1000).max(60000).optional(),
    },
    annotations: { ...READ_ONLY, title: 'Compare pages' },
  },
  async ({ urlA, urlB, timeoutMs }) => {
    try {
      const r = await comparePages(urlA, urlB, { timeoutMs });
      const diff = r.differences.length
        ? '\n\n' + r.differences.map((d) => d.field + ':\n  A = ' + JSON.stringify(d.a) + '\n  B = ' + JSON.stringify(d.b)).join('\n')
        : '';
      return reply(r.verdict + diff, r);
    } catch (e) { return fail(e); }
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
}

if (require.main === module) {
  main().catch((e) => {
    /* stdout is the protocol channel; diagnostics must never go there. */
    process.stderr.write('deploy-check-mcp failed to start: ' + ((e && e.stack) || e) + '\n');
    process.exit(1);
  });
}

module.exports = { server };
