# Publishing

Everything in this repository is ready. What is left needs an npm account and a GitHub
login, which have to be done by a human at a keyboard.

## Why npm comes first

The official MCP Registry stores **metadata only, not artefacts**. It will not accept
`server.json` until the package it points at actually exists on npm. So the order is fixed:
npm, then the registry.

`package.json` already carries `"mcpName": "io.github.fahmiwol/deploy-check"`, which is how
the registry verifies the package belongs to the GitHub account publishing it. Keep the
`io.github.fahmiwol/` prefix or verification fails.

## The three commands

```bash
npm login                 # once per machine
npm publish --access public
```

Check it landed: <https://www.npmjs.com/package/deploy-check-mcp>

```bash
# macOS / Linux
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/

# Windows PowerShell
Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_amd64.tar.gz" -OutFile "mcp-publisher.tar.gz"; tar xf mcp-publisher.tar.gz mcp-publisher.exe; Remove-Item mcp-publisher.tar.gz
```

```bash
mcp-publisher login github     # opens a browser, authorises the io.github.fahmiwol namespace
mcp-publisher validate         # checks server.json before anything is sent
mcp-publisher publish
```

## After publishing

Two things in this repository become out of date the moment npm accepts the package:

1. **README install section.** Replace the clone instructions with the one-liner, and delete
   the note that says it is not on npm yet:

   ```bash
   claude mcp add deploy-check -- npx -y deploy-check-mcp
   ```

2. **Version bumps.** `version` appears in three places that must agree: `package.json`,
   `server.json` top level, and `server.json` → `packages[0].version`. Publishing with them
   out of step is rejected.

## The other directories, and what each actually costs

| Directory | How to get listed | Cost |
|---|---|---|
| **Official MCP Registry** | `mcp-publisher publish`, after npm | free |
| **Glama** | requires an account; sign-up has a CAPTCHA | free |
| **mcp.so** | submission form is paid-only as of 2026-09-06 | **$39 one-time** |
| **Smithery** | account, then `smithery mcp publish` or the web dashboard | free |
| **awesome-mcp-servers** | pull request to the list | free |

mcp.so quotes 2.2M unique visitors over twelve months and a DR 72 domain, which is why it
charges. Worth revisiting once there is revenue to justify it — not before.

Glama lists over 82,000 servers. Being on it is table stakes, not a traffic source. Treat all
of these as places to be findable, not as an audience.
