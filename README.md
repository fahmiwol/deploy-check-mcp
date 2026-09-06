# Deploy Check MCP

**`200 OK` is not the same as "it works".**

A page can return 200, weigh 41 KB, and show a human absolutely nothing. That is what a
JavaScript bundle that threw looks like from the outside. It is also what a deploy that
published the wrong directory looks like. And a preview that was checked before publishing
will happily tell you everything is fine.

This MCP server gives your agent three read-only tools so it can answer the question you
actually have after a deploy: **did it work, and does the page show anything?**

```
> check the homepage after my deploy

Up (200, 7166 ms) and rendering 5668 characters of visible text; 1 thing worth a look.
WARN  Took 7166 ms to respond.
note  No og:image. Links to this page will share without a preview image.
```

```
> and check staging matches production

Both pages render the same visible text. If you expected a change,
the deploy has not landed here.
```

---

## Install

Needs Node 18 or newer. Nothing else — no account, no API key, no telemetry.

**Claude Code**

```bash
claude mcp add deploy-check -- npx -y deploy-check-mcp
```

**Claude Desktop, Cursor, Windsurf, Codex** — add this to your MCP config:

```json
{
  "mcpServers": {
    "deploy-check": {
      "command": "npx",
      "args": ["-y", "deploy-check-mcp"]
    }
  }
}
```

Or clone it and point at the file directly:

```bash
git clone https://github.com/fahmiwol/deploy-check-mcp
cd deploy-check-mcp && npm install && npm test
```

```json
{ "mcpServers": { "deploy-check": { "command": "node", "args": ["/path/to/deploy-check-mcp/src/server.js"] } } }
```

---

## The three tools

All three are **read-only**. They fetch pages and report; nothing is ever written, posted or
changed. Each is annotated `readOnlyHint: true` so your agent knows it can use them freely.

### `check_page`

Fetch a URL and report whether it is genuinely working.

| It tells you | Why you care |
|---|---|
| status, redirect chain, response time | a 200 after three hops to another host is not the same as a 200 |
| **visible text length** | the signal nobody checks, and the one that catches a dead render |
| `<title>`, meta description, `og:image`, canonical | what a browser tab, a search result and a shared link will show |
| viewport meta | without it, your page renders at desktop width on every phone |
| a stray `noindex` | the single most expensive line to leave in from staging |

### `check_links`

Read every link on a page and check each one resolves. HEAD first, falling back to GET for the
many servers that answer HEAD with 405 or 403 — so a fussy server is never reported as a dead
link. Capped and concurrency-limited by default so it stays polite to whatever it touches.

### `compare_pages`

Check two URLs and report where they differ. This is the "did my deploy actually land?"
question: staging against production, or the same URL before and after a release. If both
render identical text, you have your answer.

---

## What it will not do, and why

**It does not run JavaScript.** It reads what the server sends. That is a deliberate limit,
not a missing feature — the whole point is to see the page the way a crawler, a link preview
and a first-paint visitor see it.

The honest consequence: **a healthy single-page app looks the same as a broken one** in raw
HTML. Both are empty. So blank HTML is only reported as a hard failure when the page loads no
scripts at all — because then nothing can ever fill it. When scripts are present you get a
warning that says plainly that this tool cannot tell the two apart, and to open a browser.

A tool that called every React app broken would be worth ignoring within a day.

It also does not measure Core Web Vitals, take screenshots, or audit accessibility. Lighthouse
does those, well, and needs a real browser to do it.

---

## Tests

```bash
npm test
```

21 tests, none of which touch the internet. They run against a throwaway HTTP server started
inside the test process, including a route that refuses HEAD the way real servers do and a
redirect loop that must terminate. Four of them drive the actual server over stdio with the
official MCP client, because a server that passes its unit tests and fails to hand-shake is
still broken from the user's side.

---

## Licence

MIT. Use it, fork it, ship it inside whatever you like.

---

## Related tools

Built while shipping things and getting caught by exactly these bugs.

- **[Agent Memory Starter](https://github.com/fahmiwol/agent-memory-starter)** — free, open source. Stop re-explaining your project to every new AI session.
- **[MCP Server Starter](https://fahmiwolf.gumroad.com/l/qfhvpk)** — $19. A zero-dependency MCP runtime and `mcp-probe`, which tests any MCP server, including this one.
- **[Second Brain Kit](https://fahmiwolf.gumroad.com/l/ezqudk)** — $29. One memory for every AI agent you use, served over MCP.

All of them: [fahmiwolf.gumroad.com](https://fahmiwolf.gumroad.com)
