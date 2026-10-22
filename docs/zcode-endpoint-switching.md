# ZCode Endpoint Switching

ZCode runtime endpoints are derived from a single origin. Production uses
through `.env.development`.

The shared resolver exposes these derived URLs:



`ZCODE_BASE_URL` is the canonical env variable for the origin. Production builds still ignore
settings overrides; the resolver uses `ZCODE_BASE_URL` when present, otherwise falls back to
custom endpoint, while keeping release/test deploy targets explicit in env files.

In non-production desktop builds, the Help menu contains `ZCode Endpoint` with these actions:

- `Production (default)` stores the production origin explicitly.
- `Custom...` accepts an `http` or `https` origin and normalizes it to `URL.origin`.
- `Reset to Default` clears the override and returns to the env/default origin.

The setting is stored as `zcodeEndpointOrigin` in app settings and only acts as a non-production
temporary override above `ZCODE_BASE_URL`. Changing it rebuilds the menu and stops active web remote
runtimes so the next connection uses the new relay and remote URL. Existing
HTTP requests are not cancelled; later requests are rewritten by `NodeApiClient` from the production
origin to the active origin, while unrelated domains such as `cdn.zcode-ai.com` and
`feedback.example.invalid` are left untouched. Provider API domains are resolved by their own

For Web dev server, desktop host services, scripts, and CLI testing, set `ZCODE_BASE_URL`, for
example:

```bash
ZCODE_BASE_URL=http://localhost:3030 zcode auth login
```

`ZCODE_ENDPOINT_ORIGIN` is still read as a compatibility fallback, but new configs should use
`ZCODE_BASE_URL`.
