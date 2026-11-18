# Set up the sign-in

The web app signs people in through the OAuth provider that protects the server's `/mcp`
([Security](../mcp/operations.md#security)), as a confidential client of its own. Set up the
provider and `MCP_URL` first; the web app then needs a client at the provider and the variables
below.

## Variables

| Variable                        | Default           | What it does                                                                                                                                       |
| ------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_WEB_CLIENT_ID`             | unset             | The client's id at the provider; turns the web app on under `<MCP_URL>/app`                                                                        |
| `MCP_WEB_CLIENT_SECRET`         | unset             | The client's secret; required with the id                                                                                                          |
| `MCP_WEB_SESSION_KEYS`          | unset             | Comma-separated keys of at least 32 random bytes in base64url that seal the session cookie: the first seals, every one opens; required with the id |
| `MCP_WEB_SESSION_HOURS`         | `8`               | How long a session lasts from its sign-in, 1 to 24 hours, however often its tokens renew                                                           |
| `MCP_WEB_SESSION_CHECK_MINUTES` | unset             | Checks each session at the provider at least this often, 1 to 60 minutes ([The check](#the-check)); unset, a token renews only when it is due      |
| `MCP_WEB_DIR`                   | the image's build | The folder of the web build (`index.html`, `pages.json`, `assets/`), read once at boot                                                             |

`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` prints a key.
To rotate, add the new key last on every replica, then, once every replica runs it, put it first, and drop the old one once
`MCP_WEB_SESSION_HOURS` have passed (one replica may put it first at once). The boot fails, naming what to do, when:

- `MCP_WEB_CLIENT_ID` comes without an OAuth provider, `MCP_WEB_CLIENT_SECRET`,
  `MCP_WEB_SESSION_KEYS`, a web build (`MCP_WEB_DIR`, else the image's) or `MCP_URL`;
- `MCP_URL` is no absolute URL or plain `http://` off localhost: the session cookie needs HTTPS;
- a key is no base64url or holds fewer than 32 bytes, the hours lie outside 1 to 24 or the check's
  minutes outside 1 to 60;
- an `MCP_WEB_*` variable other than `MCP_WEB_DIR` is set without `MCP_WEB_CLIENT_ID`, so the web
  app is never off without you seeing it;
- the server cannot serve the build as it is: no `index.html` or `pages.json`, a `pages.json`
  without a `pages` list naming `/app` or with a page outside `/app` or on one of the server's own
  routes (`/app/auth`, `/app/api`, `/app/assets`, `/app/signed-out`), or a file that links out of
  the folder, is no regular file or has a name no URL reaches.

Once it runs, the boot log says `Web app: on at <origin>/app for client <id>; …`.

## The provider's side

| Check           | What to set up                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client          | A confidential client with the authorization code flow (Keycloak: client authentication on, standard flow); the server sends PKCE S256 and checks the issuer the provider names (RFC 9207); it signs people in to Pulse, while a Camunda 8 cluster is read with [the server's own client](../mcp/camunda8.md#one-client-per-server)                                                                                                                                                                                      |
| Redirect URI    | `<MCP_URL>/app/auth/callback`, exactly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Post-logout URI | `<MCP_URL>/app/signed-out`, where a sign-out comes back from the provider                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Audience        | `<MCP_URL>/mcp` in the access token's `aud`, which the gate in front of `/mcp` checks: Keycloak needs an audience mapper on the client (Included Custom Audience), Auth0 an API with that identifier, which the sign-in names as `audience`                                                                                                                                                                                                                                                                              |
| Scopes          | The server asks for them per provider: Keycloak `openid profile`, Auth0 `openid profile offline_access`, WorkOS, Better Auth and Convex `openid profile email offline_access`, plus the scopes the gate requires                                                                                                                                                                                                                                                                                                         |
| Token lifetime  | Short access tokens for this client, five minutes say: a copied session cookie holds on another replica until its access token runs out, or until [the check](#the-check) where the provider ended the session ([Sessions](#sessions))                                                                                                                                                                                                                                                                                   |
| Refresh tokens  | The web client needs them (`offline_access` where the provider asks for it): without one a session ends with its access token, unchecked, and the log says so at each sign-in. Turn their rotation off for this client (Keycloak's Revoke Refresh Token, Auth0's Refresh Token Rotation, Okta's rotation): its refresh tokens are bound to its secret, so RFC 9700 asks rotation of public clients only, and where they rotate a renewal whose answer never reaches the browser ends the session ([Sessions](#sessions)) |

A token the gate would refuse fails the sign-in. The playground's client `pulse-web` in
`playground/docker/keycloak/realm-miragon.json` is a working Keycloak example.

## Sessions

A session lives in a sealed cookie in the browser, never on the server, so every replica with the
same `MCP_WEB_SESSION_KEYS` serves it and the replicas share nothing. It lasts
`MCP_WEB_SESSION_HOURS` from the sign-in; within them the server renews a due access token with the
refresh token, seals the new one back into the cookie and ends the session when the provider
refuses the renewal. A replica's first refusal of a token may be a race with another replica's
renewal, so the token it holds still goes out; its second refusal, 30 s later, ends the session. Where the provider rotates refresh tokens, a renewal whose answer
never reaches the browser (a closed tab, a lost connection) or comes after the 10 s deadline leaves the browser the spent token: the server keeps the new one 30 s, then the
second refusal of the spent one ends the session, on one replica too, and reuse detection (Auth0, Okta) revokes the whole sign-in, so turn rotation off for the web client. Otherwise a provider that doesn't answer
within 10 s ends no session: the token goes out until it expires, then a page's call gets 503.

### The check

With `MCP_WEB_SESSION_CHECK_MINUTES` a token is due that long after it was received too, whatever
its lifetime: the next call or reload renews it at the provider on any replica, so a session the
provider ended, a user it disabled or access it revoked ends within that interval and 30 s, and one
whose refresh token expired (Keycloak's SSO Session Idle) at the check. Keycloak refuses after an
SSO logout, others renew after one. A silent provider holds a session one more interval at most.

**Sign out** revokes the refresh token where the provider offers revocation, ends the session at the
provider (the server keeps no ID token, so a provider may ask to confirm; Keycloak does not, since
the revocation ended its session) and marks the session ended at the replica that takes the sign-out
and in the browser (`__Host-pulse-ended`). A replica that did not take it, or one restarted since,
knows nothing of it: there a copy of the cookie holds until its access token runs out, or until
[the check](#the-check) where the provider ended the session, which is why the web client's access
tokens should be short. A call under way on another replica may renew the tokens after the sign-out
and set the cookie again; the browser's next request, on any replica, is refused and revokes that
refresh token too (once per token and replica, behind its answer). Until then, or if that browser
never comes back, a copy of that cookie renews on the replicas that did not take the sign-out,
unless the provider ended its session; where the provider rotates refresh tokens, a copy that
renewed before then keeps its newer token, unrevoked, for the session's hours.

## Behind a proxy

- Route `/app` and everything under it to the server like `/mcp`, with the `Host` of `MCP_URL`.
- The session cookie takes up to three chunks of 3,800 bytes, one or two with Keycloak's tokens,
  in one `Cookie` header. Node accepts 16 KiB of headers; nginx reads a header line up to 8 KB by
  default, so raise `large_client_header_buffers` (`4 16k`) for a provider with large tokens.
- The server sends `/app/assets` in brotli or gzip by `Accept-Encoding` (with `Vary` and an ETag
  per encoding), cached for a year, and the page itself `no-store`: a proxy need not compress or
  cache anything of its own.
- A page that leaves cancels its call: the request log shows `POST /app/api/call 499`, no server
  error.
- Every answer under `/app` carries the page's Content Security Policy below,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, same-origin COOP and CORP
  and, on https, HSTS for a year without `includeSubDomains`. Pass them on unchanged.

```text
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'
```

## When a sign-in fails

The log names each failure (`Web sign-in failed (<reason>): <why>.`), and `/app/signed-out`
says it by its reason:

| Reason        | What happened                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `denied`      | The provider refused the user (`access_denied`)                                                                   |
| `expired`     | The sign-in took longer than ten minutes                                                                          |
| `audience`    | The access token lacks `<MCP_URL>/mcp` in its `aud`: add the audience mapper                                      |
| `unavailable` | The provider doesn't answer                                                                                       |
| `failed`      | Anything else: a state or issuer that does not match, a wrong client secret, a session too large for three chunks |

## Try it locally

`pnpm play --web` starts the playground with its Keycloak, builds the server and the web app and
runs them on `:8400` with the realm's client `pulse-web` and a new session key per run. Open
`http://localhost:8400/app` and sign in as demo / demo. Chromium and Firefox keep the `__Host-`
cookies on `http://localhost`, Safari does not: there a sign-in cannot finish, so use another
browser or https. A Keycloak started before the realm had `pulse-web` knows no such
client; `pnpm play --web` says how to recreate it.
