# @miragon/pulse-widget-shell

[![npm](https://img.shields.io/npm/v/@miragon/pulse-widget-shell)](https://www.npmjs.com/package/@miragon/pulse-widget-shell)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

The server boot and the view runtime your own MCP server, its modules and its widgets build on,
as the Pulse connectors and the [pulse-starter](https://github.com/Miragon/pulse-starter) do.
Below 1.0: pin the exact version and update all `@miragon/pulse-*` packages together.

## Install

```sh
npm install @miragon/pulse-widget-shell zod bpmn-js@18.31.1
npm install react react-dom @miragon/pulse-ui lucide-react@1.70.0 @tanstack/react-query
```

The second line is for the view bundle; the official MCP TypeScript SDK comes with this package
(`@modelcontextprotocol/server` 2.4, `@modelcontextprotocol/node` 2.1,
`@modelcontextprotocol/ext-apps` 2.0). The fastest start is the
[pulse-starter](https://github.com/Miragon/pulse-starter), which wires all of the below:
[Build your own server](https://miragon.github.io/pulse/mcp/build-your-own).

## Minimal use

A server composes its modules in one boot. `runComposedServer` serves it, drains on SIGTERM and
SIGINT, and prints a refused setting as one line before it exits 1:

```ts
import { createComposedServer, runComposedServer } from "@miragon/pulse-widget-shell/server"
import { engineModule } from "@miragon/pulse-engine-connector"

await runComposedServer(() =>
  createComposedServer({
    info: { name: "acme-mcp", title: "Acme MCP", version: "0.1.0" },
    modules: [engineModule],
    bundle: { jsPath: "dist/mcp-app.js", cssPath: "dist/mcp-app.css" },
  }),
)
```

The view bundle is one Vite build whose entry mounts every view by its tool's name:

```ts
import { mountViews } from "@miragon/pulse-widget-shell/widgets"
import { engineViews } from "@miragon/pulse-engine-connector/widgets"

mountViews({ views: { ...engineViews } })
```

Its `vite.config.ts` spreads `VIEW_BUNDLE_DEDUPE` (`./server`) into `resolve.dedupe`
(`dedupe: [...VIEW_BUNDLE_DEDUPE]`) and never trims it: it names every package that must exist
once (this one included), or the React contexts diverge and every in-widget query hangs. Under
`vite build --watch` next to `tsx watch`, add `viewBundleWatchPlugin()` to the plugins, so the
server restarts only for a new bundle. The stylesheet imports `@miragon/pulse-ui/theme.css` after
`tailwindcss`, `@source`s pulse-ui's `dist` and this package's `dist`, and overrides role
variables only; the widgets follow the host's theme, then the OS.

## What it provides

| Part           | Entry            | What you get                                                                                                                                                                                                                                               |
| -------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server boot    | `./server`       | `createComposedServer` and `runComposedServer`: module selection (`MCP_ACTIVE_MODULES`, `module:toolset`), OAuth from `MCP_OAUTH_*`, the web app under `/app` (`MCP_WEB_*`), the Host/Origin guard, `/mcp`, `/health/*`, `/metrics`, the served fonts      |
| Module port    | `./server`       | `ComposableModule`, `ModulePlugin`, `ModuleEntry`, `ModuleServer` (the official SDK's `registerTool`/`registerPrompt`/`registerResource`), `createToolsetVocabulary` for toolsets that fail closed                                                         |
| Tool authoring | `./server`       | The registrar (`createToolRegistrar`, `withToolErrors`), `showToolBinding`, `OwnViewBinding`, `AppResourceCsp`, `appOnly`, `forViews`, `strictToolInput`, `buildViewResult`, `buildDataFeedResult`, `decodeToolResult`, `createTranslator`                 |
| Server helpers | `./server`       | The BPMN-name readers (`readBpmnNames`, `parseBpmnNames`), the per-caller request info (`callerCacheKey`, `getMcpRequestInfo`, `runWithMcpRequestInfo`), `composedEnvVars`, `viewResourceUri`, `viewPrelude`                                               |
| Bundle build   | `./server`       | `VIEW_BUNDLE_DEDUPE`, `viewBundleWatchPlugin`, and the served fonts (`installFontAssets`, `fontAssetsCsp`)                                                                                                                                                 |
| View runtime   | `./widgets`      | `mountViews`, `mountPage` for a page outside a chat, the view host (`useViewHost`, `HostModelContext`), the query hooks (`useToolQuery`, `useToolQueries`, `useToolMutation`, `useViewData`), `TestViewHost` for tests                                     |
| Host-bound UI  | `./widgets`      | `WidgetShell`, `ListTable` + `PagedRows`, `IdCell`/`IdText`, `describeError`, `useActionFeedback`, `ConfirmDialog`, the hand-offs (`HAND_OFF_ACTIONS`, `AskAiButton` for one it does not list) and the BPMN viewer                                         |
| Module tests   | `./testing`      | `recordingModuleServer` and `testServerContext` for a module's tools, prompts and resources                                                                                                                                                                |
| Sign-in tests  | `./testing/oidc` | `startFakeOidc`: a fake OpenID Connect provider with Keycloak's paths on a loopback port (discovery, its signing key, a login page per user, the code grant with PKCE, refresh, revocation, the end of a session), for a server's sign-in tests; Node only |

`WidgetShell` is a view's card and pads nothing itself: its `header` (the kit's `WidgetHeader`,
the `StatusStrip`s under it and a list's filter `Toolbar` right under the bar) runs from edge to
edge, and its children sit in the gutter of the density roles, 12 px above and below, their
sections the section gap apart; a bar further down, inside the content, reaches the card's edges
with `-mx-gutter`. A shell whose children are views of their own (a cockpit's routes, each a
shell with its bar) is `flush`. `useDetailView`'s `notice` is a `StatusStrip` for the header: a
failed refresh in the kit's words, the engine's raw text under its Details. A hand-off in a table
row is `size="xs"` (`HandOffButton`, `AskAiButton`), the 24 px button the kit's row actions take,
so the row keeps its 28 px.

Views render in German for a host locale whose language is `de` and in English otherwise; the
design kit itself (primitives, tones, formatters) comes from `@miragon/pulse-ui`, and so do the
brand gates and the product glossary every widget package checks its catalogs against
(`@miragon/pulse-ui/testing`). No module renders another's widget, and the view root keeps no map
for one. Without an OAuth provider the boot runs unauthenticated with one warning, and a module
with toolsets runs its read-only floor; the providers and what fails the boot are under
[Security](https://miragon.github.io/pulse/mcp/operations#security).

## A view on a page outside a chat

`mountPage(views, options)` mounts one view on a plain page, a web app's say, without the MCP
Apps runtime: the page hands in a caller for the server's tools (a fetch to its `/mcp` endpoint)
and the view calls its own view tool with `args`, then runs under the same providers as in a
chat, so every widget works unchanged. The page's theme follows a `data-cd-theme` it sets on
`<html>`, else the OS; its language the `locale` option, else the document's `lang`, else the
browser's. It owns its viewport, so it shows fullscreen with no switch, and nothing reaches a
model. A page posts into no chat, so a hand-off shows only where the page asks for it to be
copied (`followUp: "copy"`); a widget asks the host's `followUp` with `useHostFollowUp()`, so a
menu, a column or a section that holds hand-offs alone shows not at all where they are hidden, and
the view's frame says to reload the page where a chat's would say to ask in the chat. A page writes
to no engine: `useHostWrites()` answers false there (true in a chat and in `TestViewHost`), so a
widget that asks it before it shows a write control offers none. A page that brings its own chrome
hands it in as `frame`, a component that gets the view as its `children` and renders under the same
providers (the view's locale, theme, icon stroke and toasts); the frame then lays out the page and
the view takes its content's height. With a frame and no `view`, the frame renders alone and nothing
is called (a page that needs no tool, such as a signed-out page). Pulse's web app (`apps/web`) is
such a page.

```ts
import { mountPage } from "@miragon/pulse-widget-shell/widgets"
import { engineViews } from "@miragon/pulse-engine-connector/widgets"

mountPage(engineViews, {
  view: "engine_open_cockpit",
  args: { engine: "prod" },
  // Your page's call of a server tool, resolving with its raw result (an `isError` one too).
  callTool: (name, args) => callServerTool(name, args),
  followUp: "copy",
})
```

The MCP bundle never carries it: tree-shaking leaves `mountPage` out of a bundle that mounts
with `mountViews`.

## The web app

Beside an OAuth provider, `MCP_WEB_CLIENT_ID` turns on a web app under `/app` with its sign-in,
behind the Host/Origin guard: people sign in through the server's own provider as a confidential
client (the code flow with PKCE S256, the state and RFC 9207's `iss` checked before the provider is
asked anything), and the access token must pass the gate in front of `/mcp` before the session
keeps it. The session lives in a sealed `__Host-pulse-session` cookie (HttpOnly, Secure, SameSite=Lax,
at most three chunks), never on the server, so every replica built with the same keys serves it.

| Route                                    | What it does                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /app/auth/login`                    | Starts a sign-in (`?return=` a page under `/app` to come back to) with the provider's web scopes and the gate's resource (RFC 8707)                                                                |
| `GET /app/auth/callback`                 | Checks the callback, exchanges the code, starts a new session (a new id and CSRF secret), returns to the page; a failure goes to `/app/signed-out?reason=<reason>`                                 |
| `POST /app/auth/logout`                  | Takes the page's CSRF token, revokes the refresh token, clears the cookies and names where to go: the provider's end of the session, else `/app/signed-out`                                        |
| `GET /app/api/session`                   | The signed-in name, the CSRF token and the session's end; `401` with `signed_out` without one                                                                                                      |
| `POST /app/api/call`                     | A page's call of a server tool (`{ name, arguments }`, JSON, at most 64 KiB, with the CSRF token), forwarded to `/mcp` with the session's token; `{ result }`; a page that leaves cancels it (499) |
| `GET /app` and each page of `pages.json` | The build's page (below), `no-store`; without a session a 302 to `/app/auth/login` with the page and its query to return to                                                                        |
| `GET /app/signed-out`                    | The build's page without a session, `no-store`                                                                                                                                                     |
| `GET /app/assets/*`                      | The build's assets at the path a browser requests for each name, immutable for a year; a text asset over 1 KiB in brotli or gzip where `Accept-Encoding` takes it                                  |

A provider, `MCP_URL` (https, or http on localhost), `MCP_WEB_CLIENT_SECRET`,
`MCP_WEB_SESSION_KEYS` (comma-separated base64url keys of at least 32 bytes; the first seals,
every one opens) and a web build (below) are required beside the client id;
`MCP_WEB_SESSION_HOURS` is optional (8 by default, at most 24). The secret, the keys or the hours
without the client id fail the boot too, so the web app is never off unseen; `MCP_WEB_DIR` may
stand alone. The sign-in asks each provider for its
own scopes: Keycloak `openid profile` (no offline token), Auth0 also `offline_access` and the
resource as `audience`, WorkOS, Better Auth and Convex `openid profile email offline_access`, and a
provider of a root's own `openid` unless its `web` names others; it asks for a provider's
`requiredScopes` besides, since the gate checks the session's token for them. `/mcp` answers a
request that carries the session cookie with the gate's 401 and its Bearer challenge, and every
route under `/app` answers 400 to one that carries an Authorization header. `@miragon/pulse-widget-shell/testing/oidc` is the identity provider a
server's own sign-in tests run against.

The web app's pages come from its build, which the root names with `createComposedServer`'s
`web: { dir }` (`MCP_WEB_DIR` overrides it) and the boot reads once, so no request touches the file
system: `index.html`, the page; `pages.json`, `{ "pages": [...] }`, the routes that show it as
router patterns (`/app` itself, then lowercase words and `:params`, never under a route of the
server's own in `WEB_PATHS`: `/app/auth`, `/app/api`, `/app/assets`, `/app/signed-out`), so
widget-shell knows no app's routes; and `assets/`, served under `/app/assets/` at the path a
browser requests for each name. A link out of the folder, a build without `index.html`,
`pages.json` or a page `/app` fails the boot. The table above names what each route of the build
answers; anything else under `/app` is 404. Every answer under `/app` carries the page's Content
Security Policy (`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src
'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none';
base-uri 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, the
same-origin `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`, and on an https
`MCP_URL` `Strict-Transport-Security` for a year, without `includeSubDomains`.

A page's call goes in-process to `/mcp` as one `tools/call` with the session's bearer token and
exactly the headers an MCP client sends, so the edge guard, the OAuth gate, the caller's identity,
the per-caller caches, passthrough, toolsets and read-only engines decide as for any client. It
takes only a tool a view calls (the view tool, an app-only feed, or a model tool marked `forViews`:
`openai/widgetAccessible` in the boot's record) that only reads (`readOnlyHint`); anything else
gets 403 `WEB_NOT_FOR_PAGES` or `WEB_READ_ONLY` before it runs. A due access token is renewed first
with the refresh token, one refresh per refresh token and replica at a time, and sealed back into
the cookie; a refused refresh ends the session (401 `signed_out`), and no answer ever holds a
token. A page reads its session with `readWebSession()` and hands `mountPage` the caller
`webToolCaller(session)` from `./widgets`, which posts each call with the CSRF token and tells
`onSignedOut` when the session is gone.

## Peers and the SDK

`@miragon/pulse-ui`, `react`/`react-dom`, `zod` and `@tanstack/react-query` are ranged peers
(`react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`, `@miragon/pulse-ui` `^<this release>`), so they
resolve to one instance with your app's copy. **A view bundle needs a 1.x `lucide-react` that
exports `LucideProvider`** (Pulse pins 1.70.0): a deduped 0.x copy fails the bundle build with a
missing export. `bpmn-js` is a peer (`^18.31.1`), since `./widgets` exports the BPMN viewer.

A module of your own peers this package (`^<this release>`), so your server's copy is the only
one. A module that imports one of the SDK packages itself, such as ext-apps' `registerAppTool`,
declares it as a ranged peer whose caret range admits the version this package pins; a server
that installs such a module from npm pins that SDK package at this package's version.

## A view your module brings itself

A module shipped on npm can bring a finished HTML document instead of a widget in the bundle:
register it with `registerAppResource(server, name, "ui://<module>/<view>.html", config, read)`
and bind the tool with `showToolBinding(name, title, { resourceUri, csp })`. It shares no bundle
code, gets none of this package's view host, query hooks or recovery, and its CSP and fonts are
its own. A widget in the bundle is the right choice unless you need that independence.

## Help and feedback

- **Documentation:** composing a server, writing a module and running it are explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How the parts work in detail and how to change them is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH
