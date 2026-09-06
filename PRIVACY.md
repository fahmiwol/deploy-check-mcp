# Privacy Policy

**Deploy Check MCP** · Last updated 6 September 2026

## The short version

This extension runs entirely on your own machine. It sends nothing to the author, and there
is no server of ours for it to send anything to. It has no account, no API key, no analytics
and no telemetry.

## What data is collected

**None.** No personal data, no usage data, no crash reports, no identifiers.

The extension makes HTTP requests to exactly one category of address: **the URLs you ask it
to check**, in the moment you ask. It does not crawl beyond the page you name, except when
you call `check_links`, which requests the links found on that page in order to see whether
they resolve.

Every request it makes identifies itself honestly with the user agent
`deploy-check-mcp (+https://github.com/fahmiwol/deploy-check-mcp)`.

## How data is used and stored

Results are returned to the AI client that asked for them and are not written to disk by this
extension. It creates no files, no cache and no logs. Nothing persists after the call returns.

What the AI client you are using does with that answer afterwards is governed by that client's
own privacy policy, not this one.

## Third-party sharing

**None.** The author receives nothing. No third-party service is contacted, other than the
websites whose URLs you supply.

Be aware of the obvious consequence: if you ask it to check a URL, the operator of that
website will see a request from your machine, as they would for any browser visit. If a URL
contains a private token in its query string, that token is sent to that site in the request.
Do not point it at URLs carrying secrets you would not put in a browser address bar.

## Data retention

Nothing is retained, because nothing is collected or stored.

## Children

The extension is a developer tool and is not directed at children.

## Changes

Any change to this policy will be committed to the public repository, so its full history is
visible at
<https://github.com/fahmiwol/deploy-check-mcp/commits/main/PRIVACY.md>.

## Contact

Fahmi Ghani — <fahmiwol@gmail.com>
Issues: <https://github.com/fahmiwol/deploy-check-mcp/issues>
