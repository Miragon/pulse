# Identity providers

The server's OAuth provider protects `/mcp`, where each MCP client sends a bearer token of its own,
and signs people in to the [web app](../web/index.md) under `/app`; it verifies tokens and never
issues them. The server reads one provider, whose variables and startup failures
[Operations](operations.md#security) lists. This page says what to set up at the identity provider,
what the server checks, what a refusal at renewal catches and what the server cannot serve.

| Identity provider                                                                                    | The server's provider  | Variables                            |
| ---------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------ |
| [Keycloak](#keycloak)                                                                                | Keycloak               | `MCP_OAUTH_KEYCLOAK_*`               |
| [Microsoft Entra ID](#microsoft-entra-id), one tenant                                                | Entra ID               | `MCP_OAUTH_ENTRA_*`                  |
| [ADFS](#adfs) 2019 and later                                                                         | Generic OpenID Connect | `MCP_OAUTH_OIDC_*`                   |
| [Okta, authentik, Zitadel, PingOne](#okta-authentik-zitadel-and-pingone), any with JWT access tokens | Generic OpenID Connect | `MCP_OAUTH_OIDC_*`                   |
| Auth0, WorkOS, Better Auth, Convex                                                                   | Its own                | [Operations](operations.md#security) |

## Identity provider checklist

What every provider needs on its side:

| Check              | What to set up                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token              | `<MCP_URL>/mcp` in the access token's `aud` (`https://mcp.example.com/mcp` for `MCP_URL=https://mcp.example.com`: the `resource` that `/.well-known/oauth-protected-resource/mcp` advertises; a string, or an array of strings only; Entra ID: the API's client id), the caller claim (`sub`; the generic provider's `MCP_OAUTH_OIDC_SUBJECT_CLAIM`; Entra ID `oid`, else `sub`) and an `iss` that equals the provider's issuer. The boot logs what the tokens must carry: `OAuth: tokens must carry …`                    |
| Signature          | A JWT signed with an asymmetric key of the provider's key set: an opaque token, one signed with a shared secret (`HS*`) and an unsigned one get 401                                                                                                                                                                                                                                                                                                                                                                        |
| Access tokens only | `/mcp` refuses a JWT shaped like an ID, logout or refresh token: an `at_hash`, `c_hash` or `events` claim, Keycloak's `typ` `ID`, `Refresh`, `Offline` or `Logout`, a `logout+jwt` header. So an audience mapper with **Add to ID token** lets no ID token through. The server reads no `nonce`, so an ID token without these marks passes this check: the audience keeps it out (where the audience is an id, a required scope does), so no client may have the id `<MCP_URL>/mcp` (Keycloak admits a URL as a client id) |
| Who gets one       | A token that passes gets the standard toolset `engine:operations`, writes included ([Module activation](operations.md#module-activation)): let only the people who may operate the engines get one (Keycloak: who may sign in through a client with the audience, every user of the realm where it is a Default Client Scope; Entra ID: Assignment required on the API, consent by admins only)                                                                                                                            |
| MCP clients        | A client registered per MCP client where the provider allows it, else Dynamic Client Registration ([MCP clients](#mcp-clients)), which lets anyone register a client                                                                                                                                                                                                                                                                                                                                                       |
| Reading a 401      | Its `WWW-Authenticate` header names the reason; with `MCP_OAUTH_DEBUG=1` the server logs why the signature, issuer, audience, caller claim or `exp` check failed and the claims it checked, never the token                                                                                                                                                                                                                                                                                                                |

## Keycloak

**`/mcp`.** Set `MCP_OAUTH_KEYCLOAK_SERVER_URL` to Keycloak's frontend URL, which its tokens carry in
`iss`, never an internal address, and `MCP_OAUTH_KEYCLOAK_REALM`. Give every MCP client and the web
client a client scope with an audience mapper (Included Custom Audience `<MCP_URL>/mcp`, added to
the access token). The built-in `basic` scope must keep Keycloak's own mappers, `auth_time` (the
time of the user's sign-in) and `sub`: a realm import that defines its own client scopes brings
both along, else every user gets 401 `Token carries no auth_time claim`. The server takes only the
token of a user's sign-in at Keycloak: one without `sid` or `auth_time` gets 401, so a service
account's token (client credentials, also where its client keeps a session for it) and a password
grant's (Direct Access Grants: a `sid`, no `auth_time`) are refused. Lightweight access tokens carry
no `sub`: turn them off for these clients. The server serves a copy of the realm's metadata, its
registration endpoint included.

**MCP clients.** Register a client per MCP client with the audience scope where you can. Clients
that register themselves do so anonymously, under a Trusted Hosts policy for loopback redirects that
checks every URI a client names (admit `github.com` for the MCP Inspector's `client_uri`), beside
Keycloak's default registration policies, Max Clients and Allowed Protocol Mapper Types above all (a
client's own mapper could write `auth_time`). Such a client gets the realm's Default Client Scopes,
so the audience scope must be one of them: then anyone may register clients, up to Max Clients (200
by default), whose tokens `/mcp` takes, writes included, though only through the sign-in of a user
of the realm. With `offline_access` among them, its role mapped and held by the users (by the
default roles, which an import gives only where it names them), such a client keeps its session past
the access token in an offline token, which outlives a logout; an optional scope misses the MCP
Inspector, which registers with an empty scope. Let clients register themselves only in a realm
whose users may all operate the engines, or in a realm of its own for Pulse.
`playground/docker/keycloak/realm-miragon.json` is a working realm with all of it and the web client
`pulse-web`.

**`/app`.** A confidential client (client authentication on, standard flow) with the redirect URI
`<MCP_URL>/app/auth/callback`, the post-logout URI `<MCP_URL>/app/signed-out` and the audience
mapper; leave Revoke Refresh Token off. The sign-in asks `openid profile` and never
`offline_access`, since an offline token outlives a logout. Sign out revokes the refresh token,
which ends the Keycloak session without a confirmation.

## Microsoft Entra ID

One tenant: `MCP_OAUTH_ENTRA_TENANT_ID` is its id, a GUID; `common`, `organizations` and `consumers`
stop the server at startup. Guests of other tenants sign in through this one. Two app registrations,
never one: as the API's own registration the web client would ask a token for itself, which Entra
ID grants only for a scope named by the client id (`AADSTS90009`), while
`MCP_OAUTH_ENTRA_APP_ID_URI` takes `api:` and `https:` URIs alone:

| Registration                             | What to set up                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The API, `MCP_OAUTH_ENTRA_API_CLIENT_ID` | Expose an API with the scope `user_impersonation` (`MCP_OAUTH_ENTRA_SCOPE`), consent by admins only. The App ID URIs `api://<API client id>` and, for MCP clients, `<MCP_URL>/mcp` without a trailing slash, both in `MCP_OAUTH_ENTRA_APP_ID_URI`. `requestedAccessTokenVersion` 2 in the manifest. No group claims. On its enterprise application, Assignment required, with the people assigned who may operate the engines |
| The web client, `MCP_WEB_CLIENT_ID`      | A client secret (`MCP_WEB_CLIENT_SECRET`; the server signs in with no certificate), the platform Web with the redirect URIs `<MCP_URL>/app/auth/callback` and `<MCP_URL>/app/signed-out`, and the API's `user_impersonation` with admin consent                                                                                                                                                                               |

**What the server checks.** `iss` is the tenant's v2.0 authority or its `oauth21/2026-08` one, each
verified only with a key of its own key set tagged for it. `aud` is the API's client id or an App ID
URI `MCP_OAUTH_ENTRA_APP_ID_URI` names (`<MCP_URL>/mcp` only where it names it, since another app of
the tenant may own that URI), `ver` is 2.0, a `tid` names the tenant, and `scp` holds the scope,
read as `api://<API client id>/user_impersonation`. The caller is `oid`, else `sub` (Microsoft
issues `oid` only where `profile` was asked, which MCP clients don't), and `roles` are the
permissions. A v1 token for the API gets 401 saying to set `requestedAccessTokenVersion` to 2, and
a token for Microsoft Graph, a v1 token too, 401 for its `aud`, never that hint. An app-only token
and an ID token carry no `scp` and get 401 too,
a token whose `scp` lacks the scope 403 `insufficient_scope`. `MCP_OAUTH_ENTRA_CLIENT_IDS` admits
only the clients it names (`azp`), the web client among them.

**Where clients sign in.** The protected resource metadata names the oauth21 authority, whose
metadata names PKCE's methods, which MCP clients require; `/.well-known/oauth-authorization-server`
answers 404. The web sign-in goes through the v2.0 authority, sends no `resource` (Entra ID refuses
one that is no App ID URI of the API, `AADSTS9010010`) and asks `openid profile offline_access` and
the API's scope at the authorization request, the code exchange and every refresh. Another cloud is
`MCP_OAUTH_ENTRA_AUTHORITY` (`https://login.microsoftonline.us`,
`https://login.partner.microsoftonline.cn`); whether it serves the oauth21 authority is not verified.

**Refresh tokens and sign-out.** Refresh tokens last 90 days and rotate, the old one staying valid,
so replicas never race. Entra ID has no revocation endpoint: a sign-out ends the session at Entra ID,
which may show an account picker, and revokes nothing, so a copy of the session cookie renews on a
replica that did not take the sign-out for the session's hours: keep `MCP_WEB_SESSION_HOURS` short.
The session cookie holds about 11 KB sealed; with group claims a token outgrows it, and the sign-in
ends on the signed-out page, its log naming the token's size and the claim, never a group's id.

## ADFS

ADFS 2019 and later, through the generic provider: `MCP_OAUTH_OIDC_ISSUER=https://<fs>/adfs`, and
no `MCP_WEB_SCOPES`. An application group with three parts:

| Part               | What to set up                                                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server application | The web client: a secret and the redirect URIs `<MCP_URL>/app/auth/callback` and `<MCP_URL>/app/signed-out`, matched exactly                                                                                                                                                                                                      |
| Web API            | The identifier `<MCP_URL>/mcp`, an access control policy, the `openid` permission for the server application and an issuance transform rule that emits `sub` from `objectGUID`, since ADFS's access tokens carry none (or `MCP_OAUTH_OIDC_SUBJECT_CLAIM` names the immutable claim your rule emits, never `upn` or `unique_name`) |
| Native application | One per MCP client, with its redirect URIs: ADFS registers no client by itself                                                                                                                                                                                                                                                    |

The server reads the key set and the issuer its access tokens carry, `access_token_issuer` (often
`http://<fs>/adfs/services/trust`), from ADFS's discovery at the first token; `/mcp` answers 503
until it answers. The generic provider's sign-in asks `openid` by default, as ADFS needs: it has no
`profile` or `email` scope, stops at a scope it does not grant and issues refresh tokens without
`offline_access`. It names the Web API as `resource` at the authorization request, the code exchange
and every refresh: without it ADFS renews a token for its userinfo endpoint. A refresh token lasts
as long as the ADFS session (8 hours by default, 24 with Keep me signed in, up to 90 days on a
registered device), never rotates and comes with `refresh_token_expires_in`. ADFS has no revocation
endpoint; a sign-out goes to `/adfs/oauth2/logout`, the post-logout URI among the server
application's redirect URIs. ADFS's metadata names no `code_challenge_methods_supported`, so a
strict MCP client refuses it unless the client overrides discovery (Claude Code's
`oauth.authServerMetadataUrl`). A Web API of Pulse's own whose identifier is no URI (the wizard
proposes the client's id) gets access tokens for `microsoft:identityserver:<identifier>`: name
that in `MCP_OAUTH_OIDC_AUDIENCE`, with no scope, since no other app's token and no ID token
(whose `aud` is the client's id bare) carries it. The web sign-in then asks for the identifier at
every grant.

## Okta, authentik, Zitadel and PingOne

The generic provider: `MCP_OAUTH_OIDC_ISSUER` exactly as the provider's discovery names it
(authentik's ends in a slash).

| Provider  | `/mcp`                                                                                                                                                                                                      | `/app` (`MCP_WEB_SCOPES`)                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Okta      | A custom authorization server with the Audience `<MCP_URL>/mcp` (the org authorization server's tokens are Okta's own); `MCP_OAUTH_OIDC_SUBJECT_CLAIM=uid`, since `sub` is the login                        | `openid profile offline_access`; turn rotation off                               |
| authentik | A signing key on the provider (without one its tokens are `HS256`); `aud` is the provider's client id: name it in `MCP_OAUTH_OIDC_AUDIENCE` and a scope only Pulse's clients get in `MCP_OAUTH_OIDC_SCOPES` | `openid profile offline_access`; it rotates refresh tokens by default            |
| Zitadel   | The app's access token type JWT (its default is opaque); `aud` is the project id: name it with a scope only Pulse's clients get                                                                             | `openid profile offline_access`; it rotates refresh tokens at every renewal      |
| PingOne   | A resource with the audience `<MCP_URL>/mcp`                                                                                                                                                                | What PingOne, and Okta, do with the `resource` the sign-in sends is not verified |

Where the audience is an id or one every app shares (`api://default` of Okta's default authorization
server), the boot asks for a scope only Pulse's clients are granted (`MCP_OAUTH_OIDC_SCOPES`), and
another app granted it still passes: name Pulse's clients in `MCP_OAUTH_OIDC_CLIENT_IDS` too, which
admits only them, and on Okta grant the scope to them alone with an access policy rule, since the
default policy grants a custom scope to any client that asks. Auth0 (`MCP_OAUTH_AUTH0_DOMAIN`) needs
an API with the identifier `<MCP_URL>/mcp`, which the sign-in names as `audience`, and Allow Offline
Access.

## What a renewal catches

With `MCP_WEB_SESSION_CHECK_MINUTES` (off by default) each web session renews its token at the
provider at least that often, and a refusal ends the session within that interval and 30 s
([The check](../web/sign-in.md#the-check)). Unset, a session renews only when its access token is
due, so the provider's access-token lifetime decides how fast a refusal takes effect. What a refusal
catches differs per provider, as its documentation says; none of it is verified on a real tenant yet
([checklist](#real-tenant-checklist)):

| Provider        | Refuses the renewal after                                                                                                                                                                                                             | Keeps renewing after                                                                            | Access tokens                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Keycloak        | An SSO logout, a session an admin removed, a disabled user, a not-before policy                                                                                                                                                       | None of these                                                                                   | 5 minutes by default (Access Token Lifespan)                          |
| Entra ID        | A disabled user, Revoke sessions, a password reset in the Entra or Microsoft 365 admin center, a Conditional Access block, MFA or sign-in frequency, a removed assignment, consent or app, each after a few minutes of Entra ID's own | Single sign-out, the user's own password change, a reset in the Azure portal or by self-service | 60 to 90 minutes; a token lifetime policy on the API, from 10 minutes |
| ADFS            | Not documented for a disabled account or a new password                                                                                                                                                                               | A sign-out (ADFS's FAQ)                                                                         | As ADFS sets them                                                     |
| Okta, authentik | Not documented here                                                                                                                                                                                                                   | A sign-out (Okta's `/logout`, the end of an authentik session)                                  | As the provider sets them                                             |

A session whose refresh token expired ends at the check without asking the provider (Keycloak's SSO
Session Idle or Max, ADFS's `refresh_token_expires_in`). On Entra ID, Revoke sessions or disabling a
user reaches a Pulse session; a sign-out at Microsoft does not. The check covers the web app's
sessions alone: an MCP client's token holds until it expires, so keep those short (Keycloak 5
minutes, an Entra ID token lifetime policy of 10 minutes on the API's service principal).

Turn refresh-token rotation off for the web client (Keycloak's Revoke Refresh Token, Auth0's Refresh
Token Rotation, Okta's rotation): where tokens rotate, a renewal whose answer never reaches the
browser ends the session ([Sessions](../web/sign-in.md#sessions)), and Auth0's and Okta's reuse
detection revokes the whole sign-in. Entra ID keeps the old token valid and ADFS rotates none; on
Zitadel, which always rotates, such a lost answer ends that session.

The check costs a renewal per active session every interval (1,000 sessions at 5 minutes: 200 a
minute, far below Entra ID's loop detection). The per-caller caches key on the caller and the token,
so each renewal starts new entries: on providers with long tokens (Entra ID, Auth0, ADFS, Okta) the
process flow's throughput, read once an hour per caller and token otherwise, is read up to every
interval per web session, and the diagram cache refills likewise; one statistics read at a time per
engine bounds the load ([Engine load](operations.md#engine-load)).

## MCP clients

Keycloak, Auth0, WorkOS, Better Auth and Convex let a client register itself, anonymously, so
anyone may register one. Entra ID, ADFS, Okta (whose registration needs an API token) and most
others need a client registered per MCP client. Register one per MCP client wherever the provider
allows it, as each client documents it:

| Client                              | What to register                                                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude (claude.ai, Desktop, mobile) | A client with the redirect URI `https://claude.ai/api/mcp/auth_callback`, its id (and secret) in the custom connector                                                                                                                   |
| Claude Code                         | `claude mcp add --transport http --client-id <id> --callback-port <port> pulse <MCP_URL>/mcp`, the redirect URI `http://localhost:<port>/callback` (Entra ID ignores the port); `oauth.authServerMetadataUrl` overrides discovery       |
| VS Code                             | On Entra ID its built-in Microsoft sign-in: pre-authorize its client id `aebc6443-996d-45c2-90f0-388ff96faa56` on the API's scope. Elsewhere a client with the redirect URIs `http://127.0.0.1:33418` and `https://vscode.dev/redirect` |
| Cursor                              | `auth.CLIENT_ID` (and `auth.CLIENT_SECRET`), the redirect URIs `https://www.cursor.com/agents/mcp/oauth/callback` and `http://localhost:8787/callback`; `offline_access` in `auth.scopes` where the provider needs it                   |
| MCP Inspector                       | `--client-id`, the redirect URIs `http://127.0.0.1:6274/oauth/callback` (its web page) and `http://127.0.0.1:6276/oauth/callback` (its CLI)                                                                                             |

## What the server cannot serve

- Opaque access tokens (Zitadel's default, Okta's org authorization server, PingFederate's reference
  tokens): the server introspects no token. Nor tokens signed with a shared secret or not at all.
- Entra ID v1 tokens, tokens for Microsoft Graph, several tenants, a certificate in place of the web
  client's secret, a claims-mapping policy's own signing keys and Continuous Access Evaluation.
- ADFS 2016, which has no PKCE; Keycloak's lightweight access tokens, which carry no `sub`.
- A caller claim whose value can change: `email`, `upn`, `unique_name`, `preferred_username`, `name`.
- A Pulse session that ends at a sign-out where the provider keeps renewing: no back-channel logout.
- Passthrough (`ENGINE_AUTH_TYPE=passthrough`) of a token whose audience is Pulse (Entra ID, ADFS):
  MCP forbids passing it on, so keep passthrough to a trusted single-audience setup.

## What was checked, and when

- 2026-11-18, Keycloak 26.8.2 with the playground's realm and a realm set up as above: a service
  account's token, from either registration endpoint, with a session or without, and a password
  grant's get 401; a registered client's code flow, its renewal and an offline token's pass.
- The server's and the web app's tests run against `@miragon/pulse-widget-shell/testing/oidc`, which
  plays Keycloak, an ADFS farm and an Entra ID tenant as their documentation describes them.
- Not yet on a real Entra ID tenant, ADFS farm, Okta or PingOne tenant: every step below is marked
  until a run is recorded here.

## Real-tenant checklist

Neither CI nor a developer's machine reaches a real tenant, so this list shows where one differs from
the documentation. Run it against a server reachable over https at its `MCP_URL` (a named tunnel in
front of `pnpm dev` works), with `MCP_OAUTH_DEBUG=1` and `MCP_WEB_SESSION_CHECK_MINUTES=5`. Decode a
token on your own machine, never on a website; the web sign-in keeps its tokens sealed, so read them
at the provider or through an MCP client. Record per step the date, the cloud or ADFS version, the
Pulse version and pass or fail, never a secret, a token or a user's id, and go on after a failed step.

**Entra ID**, set up as [above](#microsoft-entra-id) with a second user left unassigned. At startup
the server logs `OAuth: tokens must carry iss …/<tenant>/v2.0 or …/<tenant>/oauth21/2026-08, aud <API client id> or api://<API client id>, ver 2.0, the scope api://<API client id>/user_impersonation and an oid or sub claim.`

| Step | Do                                                                                                                                              | Pass                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| E1   | Open `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`, both authorities' discovery documents and key sets | Pulse names the oauth21 authority and the full scope, the second answers 404; the oauth21 document names `S256` and no revocation, the v2.0 one an `end_session_endpoint`; each `jwks_uri` is `…/discovery/v2.0/keys` or `…/oauth21/2026-08/keys`; each key's `issuer` names its authority; record the oauth21 tag and whether both sets hold the same keys; in another cloud, where a tenant is at hand, its oauth21 document answers | Not yet verified |
| E2   | Sign in to `/app` as the assigned user                                                                                                          | The request asks `openid profile offline_access api://<API client id>/user_impersonation`, no `resource`; the cockpit names the user; the token's `iss` is v2.0, `aud` the API's client id, `ver` 2.0, `scp` `user_impersonation`, `azp` the web client, with `oid`, `tid` and `RS256`; record whether `sub` differs per client                                                                                                        | Not yet verified |
| E3   | Exchange a code of the web client without `scope`                                                                                               | A refusal with `AADSTS28003`; record its `error`. A token instead is no defect: record it                                                                                                                                                                                                                                                                                                                                              | Not yet verified |
| E4   | Two replicas without sticky sessions; press Refresh each minute for 12 minutes                                                                  | A refresh at least every 5 minutes with the scopes and no `resource`; the session stays; record whether the refresh token rotates and the old one still renews                                                                                                                                                                                                                                                                         | Not yet verified |
| E5a  | Disable the user (each E5 case with a fresh sign-in, pressing Refresh each minute)                                                              | The page says the session ended within about 10 minutes; record the time                                                                                                                                                                                                                                                                                                                                                               | Not yet verified |
| E5b  | Revoke sessions                                                                                                                                 | As E5a                                                                                                                                                                                                                                                                                                                                                                                                                                 | Not yet verified |
| E5c  | A Conditional Access policy that blocks the user for the web client                                                                             | As E5a                                                                                                                                                                                                                                                                                                                                                                                                                                 | Not yet verified |
| E5d  | Reset the password in the Entra or Microsoft 365 admin center                                                                                   | As E5a                                                                                                                                                                                                                                                                                                                                                                                                                                 | Not yet verified |
| E5e  | Remove the user's assignment from the API                                                                                                       | As E5a                                                                                                                                                                                                                                                                                                                                                                                                                                 | Not yet verified |
| E5f  | Sign out at `https://myaccount.microsoft.com`                                                                                                   | The session stays; one that ends is no defect: record it                                                                                                                                                                                                                                                                                                                                                                               | Not yet verified |
| E5g  | The user changes their own password                                                                                                             | As E5f                                                                                                                                                                                                                                                                                                                                                                                                                                 | Not yet verified |
| E5h  | Reset the password in the Azure portal or by self-service                                                                                       | As E5f                                                                                                                                                                                                                                                                                                                                                                                                                                 | Not yet verified |
| E6   | Sign out in the cockpit                                                                                                                         | Entra ID's sign-out page, then `/app/signed-out`; record whether it took `client_id` and the post-logout URI and showed an account picker                                                                                                                                                                                                                                                                                              | Not yet verified |
| E7   | Connect VS Code, Claude, Claude Code and the Inspector as [registered above](#mcp-clients), list the tools, call `engine_list_engines`          | The request names `resource=<MCP_URL>/mcp` at the oauth21 authority; the call answers; `ver` is 2.0; record per client `iss`, `aud`, `oid` and `tid`; with `aud` `<MCP_URL>/mcp`, run once with and once without it in `MCP_OAUTH_ENTRA_APP_ID_URI`; `AADSTS9010010` means that App ID URI is missing or ends in a slash                                                                                                               | Not yet verified |
| E8a  | Set `requestedAccessTokenVersion` back to 1 and connect a client                                                                                | 401 saying to set it to 2                                                                                                                                                                                                                                                                                                                                                                                                              | Not yet verified |
| E8b  | Send a Microsoft Graph token (`openid profile User.Read`) to `/mcp`                                                                             | 401 "Token audience does not include the protected resource", never the v1 hint; the token's `aud` is `00000003-0000-0000-c000-000000000000`; record its `ver` and `iss`                                                                                                                                                                                                                                                               | Not yet verified |
| E8c  | An app-only token: client credentials with an app role, `scope=api://<API client id>/.default`                                                  | 401 "Token carries no scp"                                                                                                                                                                                                                                                                                                                                                                                                             | Not yet verified |
| E8d  | Send the web client's ID token                                                                                                                  | 401                                                                                                                                                                                                                                                                                                                                                                                                                                    | Not yet verified |
| E8e  | Sign in as the unassigned user                                                                                                                  | Entra ID refuses with `AADSTS50105`                                                                                                                                                                                                                                                                                                                                                                                                    | Not yet verified |
| E8f  | Name one client in `MCP_OAUTH_ENTRA_CLIENT_IDS` and connect another                                                                             | 401 "Token was issued to a client this server does not accept"; the web sign-in still works                                                                                                                                                                                                                                                                                                                                            | Not yet verified |
| E8g  | A token of another tenant                                                                                                                       | 401                                                                                                                                                                                                                                                                                                                                                                                                                                    | Not yet verified |
| E8h  | A client that asks only a second scope of the API                                                                                               | 403 `insufficient_scope` naming the API's scope                                                                                                                                                                                                                                                                                                                                                                                        | Not yet verified |
| E9   | The App ID URI `<MCP_URL>/mcp` on a domain the tenant has not verified                                                                          | Saved with `requestedAccessTokenVersion` 2, and E7's clients sign in                                                                                                                                                                                                                                                                                                                                                                   | Not yet verified |
| E10  | Group claims on, for a user in many groups                                                                                                      | The sign-in works, or ends on the signed-out page with the size in the log and no group's id                                                                                                                                                                                                                                                                                                                                           | Not yet verified |

**ADFS 2019 or 2022**, set up as [above](#adfs), and **Keycloak** and **Okta and PingOne** where a
tenant is at hand:

| Step | Do                                                                                                                                              | Pass                                                                                                                                             | Status           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| A1   | Open ADFS's discovery and sign in to `/app`                                                                                                     | PKCE S256 works; the token's `iss` is `access_token_issuer`, `aud` `<MCP_URL>/mcp`, `sub` set by the rule; record whether the header names `kid` | Not yet verified |
| A2   | Press Refresh each minute for 12 minutes                                                                                                        | Every refresh names `resource=<MCP_URL>/mcp`, each new token's `aud` is the Web API, the session stays; record `refresh_token_expires_in`        | Not yet verified |
| A3   | With a fresh sign-in each: disable the AD account; change its password; sign out of ADFS in another tab                                         | Record whether the next check ends the session (the sign-out is expected to leave it)                                                            | Not yet verified |
| A4   | Sign out; connect Claude Code with the native application's id, a fixed `--callback-port` and `oauth.authServerMetadataUrl` at ADFS's discovery | Back on `/app/signed-out`; Claude Code lists the tools                                                                                           | Not yet verified |
| K1   | `pnpm play --web`, sign in as demo / demo, sign out in Keycloak's account console                                                               | The Pulse session ends within 5 minutes                                                                                                          | Not yet verified |
| O1   | An Okta custom authorization server as [above](#okta-authentik-zitadel-and-pingone), sign in to `/app`; the same with a PingOne resource        | The sign-in works and the token's `aud` is `<MCP_URL>/mcp`; record what each does with `resource`                                                | Not yet verified |
