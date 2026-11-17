# How the web app works

The web app is a backend for frontend inside the MCP server, the pattern the IETF's _OAuth 2.0 for
Browser-Based Applications_ recommends: the server signs people in, keeps their tokens sealed in a
cookie and calls its own `/mcp` for each page. The browser never holds a token. The server half is
widget-shell's (`packages/core/widget-shell/src/web`), the page is `apps/web`.

```mermaid
flowchart LR
  Browser -->|"/app, session cookie"| Server[Pulse server]
  Server <-->|"sign-in: code, tokens"| IdP[Identity provider]
  Server -->|"tools/call in-process, bearer token"| MCP["/mcp: gate, toolsets"]
  MCP -->|REST| Engine[(Engine)]
```

## Two interfaces, one server

The server serves two interfaces from one app: `/mcp` to MCP clients with a bearer token, and
`/app` to browsers with the session cookie. No route takes both: `/mcp` answers a request that
carries the session cookie with the gate's 401, every route under `/app` answers 400 to one that
carries an `Authorization` header, and without an OAuth provider there is no `/app`.

| Route                                    | What it does                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /app/auth/login`                    | Starts a sign-in: the code flow with PKCE S256, the provider's scopes and the gate's resource (RFC 8707), back to a page under `/app`                     |
| `GET /app/auth/callback`                 | Checks the state and the issuer (RFC 9207), exchanges the code, checks the access token as the gate does, starts a new session (a new id and CSRF secret) |
| `POST /app/auth/logout`                  | Ends the session, revokes the refresh token and names where to go: the provider's end of the session, else `/app/signed-out`                              |
| `GET /app/api/session`                   | The signed-in name, the CSRF token and the session's end; 401 `signed_out` without a session                                                              |
| `POST /app/api/call`                     | A page's call of a tool, forwarded to `/mcp` ([below](#what-a-page-may-call))                                                                             |
| `GET /app` and each page of `pages.json` | The page, `no-store`; without a session a 302 to the sign-in, which comes back to the page with its query                                                 |
| `GET /app/signed-out`                    | The page without a session                                                                                                                                |
| `GET /app/assets/*`                      | The build's assets, immutable, in brotli or gzip where the browser takes it                                                                               |

## The cookie

`__Host-pulse-session` (HttpOnly, Secure, SameSite=Lax, Path=/, at most three chunks) holds the
access and refresh token with their expiries, the name the page shows, the session's id and its
CSRF secret, never the ID token. It is a JWE (`dir`, `A256GCM`) under a key derived from
`MCP_WEB_SESSION_KEYS`: only the server reads it, and nobody alters it unseen. During a sign-in
`__Host-pulse-login` holds the state, the PKCE verifier and the page to return to, for ten minutes;
after a sign-out `__Host-pulse-ended` names the ended session until it would have expired, so the
cookie a call still under way sets opens no session.

A page's call and the sign-out pass a CSRF check besides SameSite: a `Sec-Fetch-Site` other than
same-origin is refused, the `Origin` must be `MCP_URL`'s, and the `x-pulse-csrf` header must hold
the session's secret, which only a page of this origin reads from `/app/api/session`.

## Where the identity comes from

The session is no second source of identity. It holds a token the server's own sign-in got from
the same provider, which the gate checked before the session kept it, and `/mcp` verifies it again
on every forwarded call like any bearer token: the caller is its subject, and nothing the browser
chooses names one. Under passthrough an engine gets the user's own token, as from a chat. The
per-caller caches key on the token, so a renewed token starts afresh.

## What a page may call

`POST /app/api/call` takes `{ name, arguments }` as JSON of at most 64 KiB, with the CSRF token. It
admits a tool a view calls that only reads (`readOnlyHint`): the view tool `engine_open_cockpit`,
the app-only `*_data` feeds and the model tools marked `forViews` because the widgets read them
(`engine_list_engines`, `engine_query_historic_activity_instances`, `engine_get_task_form`). Any
other tool gets 403 `WEB_NOT_FOR_PAGES`, a write 403 `WEB_READ_ONLY`, before it runs.

The server then sends one `tools/call` in-process to `/mcp` with the session's bearer token and an
MCP client's headers, so the edge guard, the OAuth gate, toolsets, engine routing, read-only
engines and passthrough decide as for a chat: a tool the toolset drops does not run for a page
either. A due access token is renewed first, once per pair of tokens and replica, and sealed back
into the cookie. The page gets `{ result }`, never a token; a JSON-RPC error answers 502, a
provider that doesn't answer while the token has expired 503, a session that is gone 401
`signed_out`. A page that leaves cancels the tool's call (499). The request log names the forwarded
call too (`tools/call engine_jobs_data /mcp 200 client=unknown via=/app/api/call 9ms`).

A page writes to no engine: its view host answers `useHostWrites()` with false, so no widget shows
a write control or asks the write gate (`engine_widget_actions_data`), and the forward refuses any
tool without `readOnlyHint`.

## The page

`apps/web` is a Vite build on React, `@miragon/pulse-ui` and widget-shell. It mounts the engine
module's views with `mountPage` from `@miragon/pulse-widget-shell/widgets` under a frame of its own
(the bar, the session's notices), reads its session with `readWebSession()` and calls tools through
`webToolCaller(session)`, which posts each call with the CSRF token and rejects a refusal as a
`WebApiError`. The build holds `index.html`, `pages.json` (router patterns under `/app`, never a
route of the server's own) and `assets/`:

```json
{ "pages": ["/app", "/app/cockpit", "/app/boards/:id"] }
```

The server reads the build once at boot, so no request touches the file system, and compresses each
text asset over 1 KiB once, in brotli and gzip, keeping an encoding only where it is smaller. The
image builds the page beside the server into its `web/` and keeps the page's
`THIRD_PARTY_LICENSES.txt` in `/usr/share/doc/pulse-server/web/`; the browser gets no licence list.

`test:web` (`apps/mcp-server/test-host/web`) runs the built page in Chromium against the real server
with a fake identity provider: the sign-in and sign-out, renewals and refusals, the forward's rules,
every page state, with axe on each page.
