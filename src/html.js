/**
 * html.js — just enough HTML understanding to answer "did this page actually render?"
 *
 * This is deliberately not a parser. Four questions need answering — how much text a
 * reader would actually see, what the head claims, where the links go, and how much
 * script the page pulls in — and a regex scanner gives those without a dependency tree.
 * Anything needing a real DOM (executing JavaScript, measuring layout) is out of scope,
 * and the README says so plainly.
 */
'use strict';

/** Elements whose text a human never reads, so their content must not count as "rendered". */
const UNREADABLE = ['script', 'style', 'noscript', 'template', 'svg', 'head'];

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018',
  ldquo: '\u201C', rdquo: '\u201D', copy: '\u00A9', reg: '\u00AE', trade: '\u2122',
};

function safeChar(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch { return ''; }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => {
      const hit = ENTITIES[n.toLowerCase()];
      return hit === undefined ? m : hit;
    });
}

/**
 * The text a reader would actually see. This is THE signal: a page can return 200,
 * weigh 400 KB and still show a human nothing — which is exactly what a broken
 * bundle, a failed hydration or a wrong-root deploy looks like from the outside.
 */
function visibleText(html) {
  let s = String(html);
  for (const tag of UNREADABLE) {
    s = s.replace(new RegExp('<' + tag + '\\b[\\s\\S]*?</' + tag + '>', 'gi'), ' ');
  }
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

/** Attribute lookup inside one tag string, tolerant of quoting styles. */
function attr(tag, name) {
  const re = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = re.exec(tag);
  if (!m) return null;
  const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || '';
  return decodeEntities(raw).trim();
}

function metaContent(html, { name, property } = {}) {
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    if (name && (attr(tag, 'name') || '').toLowerCase() === name.toLowerCase()) return attr(tag, 'content');
    if (property && (attr(tag, 'property') || '').toLowerCase() === property.toLowerCase()) return attr(tag, 'content');
  }
  return null;
}

function title(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html));
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : null;
}

function htmlLang(html) {
  const m = /<html\b[^>]*>/i.exec(String(html));
  return m ? attr(m[0], 'lang') : null;
}

function canonical(html) {
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    if (rel.split(/\s+/).includes('canonical')) return attr(tag, 'href');
  }
  return null;
}

/** Counts, not contents: enough to notice "this page is forty scripts and no words". */
function assetCounts(html) {
  const s = String(html);
  return {
    scripts: (s.match(/<script\b/gi) || []).length,
    stylesheets: (s.match(/<link\b[^>]*rel\s*=\s*["']?stylesheet/gi) || []).length,
    images: (s.match(/<img\b/gi) || []).length,
  };
}

/**
 * Every link worth checking, absolutised against the page URL. Fragment-only,
 * mailto:, tel:, sms:, javascript: and data: links are dropped, because "broken"
 * means nothing for them.
 */
function links(html, base) {
  const out = new Map();
  for (const tag of String(html).match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href');
    if (!href) continue;
    const raw = href.trim();
    if (!raw || raw.startsWith('#')) continue;
    if (/^(mailto:|tel:|javascript:|data:|sms:)/i.test(raw)) continue;
    let absolute;
    try { absolute = new URL(raw, base).toString(); } catch { continue; }
    if (!/^https?:$/.test(new URL(absolute).protocol)) continue;
    if (!out.has(absolute)) out.set(absolute, raw);
  }
  return [...out].map(([url, written]) => ({ url, written }));
}

module.exports = {
  visibleText, attr, metaContent, title, htmlLang, canonical, assetCounts, links, decodeEntities,
};
