# @miragon/pulse-widget-shell

[![npm](https://img.shields.io/npm/v/@miragon/pulse-widget-shell)](https://www.npmjs.com/package/@miragon/pulse-widget-shell)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

The server boot and the view runtime your own MCP server, its modules and its widgets build on,
as the Pulse connectors and the [pulse-starter](https://github.com/Miragon/pulse-starter) do. A
page outside a chat reads through it as well, a Claude artifact included.
Below 1.0: pin the exact version and update all `@miragon/pulse-*` packages together.

## Install

```sh
npm install @miragon/pulse-widget-shell zod
npm install react react-dom @miragon/pulse-ui lucide-react@1.79.0 @tanstack/react-query
```

The second line is for the view bundle (a view that draws a BPMN diagram adds `bpmn-js@18.31.1`
for pulse-ui's `./bpmn` entry); the official MCP TypeScript SDK comes with this package
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
`tailwindcss`, `@source`s pulse-ui's `dist` (but not its browser bundle, `dist/browser`) and this
package's `dist`, and overrides role variables only; the widgets follow the host's theme, then the
OS.

## What it provides

| Part            | Entry               | What you get                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server boot     | `./server`          | `createComposedServer` and `runComposedServer`: module selection (`MCP_ACTIVE_MODULES`, `module:toolset`), OAuth from `MCP_OAUTH_*`, the web app under `/app` (`MCP_WEB_*`), the Host/Origin guard, `/mcp`, `/health/*`, `/metrics`, the served fonts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Module port     | `./server`          | `ComposableModule`, `ModulePlugin`, `ModuleEntry`, `ModuleServer` (the official SDK's `registerTool`/`registerPrompt`/`registerResource`), `createToolsetVocabulary` for toolsets that fail closed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tool authoring  | `./server`          | The registrar (`createToolRegistrar`, `withToolErrors`), `showToolBinding`, `OwnViewBinding`, `AppResourceCsp`, `appOnly`, `forViews`, `strictToolInput`, `buildViewResult`, `buildDataFeedResult`, `decodeToolResult`, `createTranslator`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Server helpers  | `./server`          | The BPMN-name readers (`readBpmnNames`, `parseBpmnNames`), the per-caller request info (`callerCacheKey`, `getMcpRequestInfo`, `runWithMcpRequestInfo`), `composedEnvVars`, `viewResourceUri`, `viewPrelude`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Bundle build    | `./server`          | `VIEW_BUNDLE_DEDUPE`, `viewBundleWatchPlugin`, and the served fonts (`installFontAssets`, `fontAssetsCsp`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| View runtime    | `./widgets`         | `mountViews`, `mountApp`, `PageView` and `mountPage` for a page outside a chat, the view host (`useViewHost`, `HostModelContext`), the query hooks (`useToolQuery`, `useToolQueries`, `useToolMutation`, `useViewData`), `TestViewHost` for tests, a page's reads (`useSectionRead`, `usePageReads`, `PageGate`, `describePageFailure`, `createPageReader`) and its recordings (`playRecording`, `recordToolCalls`)                                                                                                                                                                                                                                                                                                                           |
| Host-bound UI   | `./widgets`         | `WidgetShell` and `ListTable` (each with `fill`: on a page's screen it takes the height its flex column leaves it and scrolls in its own region; a chat's view never fills), `PagedRows` with `ListRow` (a row that opens on a click or Enter and copies its id, or what `copyLabel` names, which `ListTable`'s `copyHint` tells a screen reader; on a page a link to what it opens, `href`, a new tab with Ctrl or Cmd or a middle click), `IdCell`/`IdText`, `TextBlock` (engine text to scroll by keyboard and copy whole), `describeError`, `useActionFeedback`, `ConfirmDialog`, the hand-offs (`HAND_OFF_ACTIONS`, `AskAiButton` for one it does not list) and `useDiagramMaxHeight` (a chat card's budget for pulse-ui's BPMN diagram) |
| Claude artifact | `./claude-artifact` | `mountClaudeArtifact` for a page in claude.ai, its caller over the artifact runtime (`claudeToolCaller`, `CLAUDE_RUNTIME_CODES`) and its words of what to do there (`ARTIFACT_PAGE_HINTS`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Browser bundle  | `dist/browser/`     | `claude-artifact.js`: a page's reads and the Claude artifact's entry as one ES module for a page without a build, on pulse-ui's browser bundle beside it on a CDN (below, Use in a page without a build)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Module tests    | `./testing`         | `recordingModuleServer` and `testServerContext` for a module's tools, prompts and resources                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Sign-in tests   | `./testing/oidc`    | `startFakeOidc`: a fake OpenID Connect provider with Keycloak's paths, ADFS's (`flavor: "adfs"`) or an Entra ID tenant's (`flavor: "entra"`), on a loopback port (discovery, its signing key, a login page per user, the code grant with PKCE, refresh, revocation, the end of a session), for a server's sign-in tests; Node only                                                                                                                                                                                                                                                                                                                                                                                                            |

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
[Security](https://miragon.github.io/pulse/mcp/operations#security), and what to set up at
Keycloak, Microsoft Entra ID, ADFS, Okta and the other identity providers under
[Identity providers](https://miragon.github.io/pulse/mcp/identity-providers).

| OAuth provider | Variables                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The table      | Keycloak (`MCP_OAUTH_KEYCLOAK_SERVER_URL`, `MCP_OAUTH_KEYCLOAK_REALM`), Auth0 (`MCP_OAUTH_AUTH0_DOMAIN`), WorkOS (`MCP_OAUTH_WORKOS_SUBDOMAIN`), Better Auth (`MCP_OAUTH_BETTER_AUTH_URL`), Convex (`MCP_OAUTH_CONVEX_AUTH_URL`)                                                               |
| OpenID Connect | Any other provider that issues JWT access tokens (ADFS, Okta, authentik, Zitadel, PingOne): `MCP_OAUTH_OIDC_ISSUER` exactly as its discovery names it, and optionally `_AUDIENCE`, `_SCOPES` (required), `_SUBJECT_CLAIM` (default `sub`), `_ALGORITHMS`, `_CLIENT_IDS` and `_REQUIRED_CLAIMS` |
| Entra ID       | Microsoft Entra ID, one tenant: `MCP_OAUTH_ENTRA_TENANT_ID` (a GUID) and `_API_CLIENT_ID` (the API registration's), and optionally `_SCOPE` (default `user_impersonation`), `_APP_ID_URI` (App ID URIs, default `api://<API client id>`), `_AUTHORITY` (the cloud) and `_CLIENT_IDS`           |

The Keycloak provider takes only a signed-in user's token: one without `sid` or `auth_time` (a
service account's, by client credentials, which anyone may get where clients register themselves,
with a `sid` where its client keeps a session for it; a password grant's) gets 401.
The generic provider reads its key set and its access tokens' issuer (ADFS's `access_token_issuer`)
from the provider's discovery at the first token, so `/mcp` answers 503 until the discovery
answers (a failed read held 5 s, a document it cannot use a minute), and keeps what it found when a
later read fails, for a day after its last good read. The boot refuses a caller claim whose
value can change (`email`, `upn`, `unique_name`, `preferred_username`, `name`), an `HS*` or `none`
algorithm, an audience that is no https URL (a client's or a project's id, Okta's `api://default`)
without a required scope beyond OpenID Connect's own, since an ID token or another app's token
carries such an audience (ADFS's `microsoft:identityserver:<identifier>` of a Web API needs none,
only that Web API's access tokens carry it), and a variable under `MCP_OAUTH_OIDC_` it does not read;
`MCP_WEB_CLIENT_ID` joins a client allowlist, and `_REQUIRED_CLAIMS` names claims every token must
carry (Keycloak's `sid` and `auth_time`). Its metadata names the issuer alone: the protected resource metadata
names it, and `/.well-known/oauth-authorization-server` answers 404.

The Entra ID provider takes the tenant's v2 access tokens of its v2.0 and its `oauth21/2026-08`
authority, each verified with the keys of its own key set tagged for it, whose `aud` names the
API's client id or an App ID URI `_APP_ID_URI` names (the resource only where it names it) and whose
short `scp` holds the scope, read as `<first App ID URI>/<scope>`; the caller is `oid`, else `sub`,
and `roles` are the permissions. It refuses a v1 token for the API (saying to set
`requestedAccessTokenVersion` 2) and one for another API, Microsoft Graph's, by its `aud`, a `tid`
of another tenant and a token without `scp` (an app-only token, an ID token), and at
boot `common`, `organizations`, `consumers`, the personal accounts' tenant id, Microsoft's services'
tenant id, a domain name in place of the tenant's id and a variable under `MCP_OAUTH_ENTRA_` it does
not read. The protected resource metadata names the oauth21
authority and the full scope, and there is no copy of the server's metadata; the web sign-in goes
through the v2.0 authority without a resource, its scopes at every grant.

## A view on a page outside a chat

`mountPage(views, options)` mounts one view on a plain page, a web app's say, without the MCP Apps
runtime: the page hands in a caller for the server's tools (a fetch to its `/mcp` endpoint) and the
view calls its own view tool with `args`, then runs under the same providers as in a chat, so every
widget works unchanged. The page's theme follows a `data-cd-theme` it sets on `<html>`, else the OS;
its language the `locale` option, else the document's `lang`, else the browser's. It owns its
viewport, so it shows fullscreen with no switch, and nothing reaches a model. A page posts into no
chat, so a hand-off shows only where the page asks for it to be copied (`followUp: "copy"`); a
widget asks the host's `followUp` with `useHostFollowUp()`, so a menu, a column or a section that
holds hand-offs alone shows not at all where they are hidden, and the view's frame and the kit's
failure words say what to do on the page where a chat's would say to ask in the chat. A page's
`startPage` (its start page's URL) is where the state of a start the server refuses for good links
to (a board it does not show, arguments no tool takes, data it does not offer; `StartPageLink` is
that link for a page that words such a refusal itself), and a call that finds the page's session
gone (`isSessionEnded`) is the page frame's to say: a view's state then shows a quiet line, no error
box, notice or footer alert. A page writes to no engine: `useHostWrites()` answers false there (true
in a chat and in `TestViewHost`), so a widget that asks it before it shows a write control offers
none. A page whose address follows the view hands `PageView` (or `mountPage`) its `location` (a
`ViewLocation`): the view reports each place as its view tool's arguments with a memo of its own, a
move as a new entry of the page's history, and goes where Back and Forward lead, never to a place
the page shows itself (its `claims`: the view reports such a place and renders nothing there, the
page shows a screen of its own, and its `nameOf` gives the page's word for it, which a crumb that
leads there takes); a widget reads it
with `useHostLocation()`, which a chat never offers, and the page's start page with
`useStartPage()`. A page that brings its own chrome hands it in as `frame`, a component that gets
the view as its `children` and renders under the same providers (the view's locale, theme, icon
stroke and toasts); the frame then lays out the page and the view takes its content's height. With a
frame and no `view`, the frame renders alone, needs no `callTool` and calls nothing (a page that
needs no tool, such as a signed-out page). A view that says a failed start in its own place takes
`failedStart`, which gives its data for the error, or null to leave it to the frame: the web app
keeps the cockpit over a route whose engine does not answer (`cockpitAfterFailedStart` of the
engine connector's `/widgets`). A page that navigates itself hands its view `chrome` (a
`HostChrome`: its menu button), which a widget reads with `useHostChrome()` and a chat never offers:
the cockpit then leaves its head (its sections, its engine switch, the way across engines) to the
page's navigation and shows the menu first in every view bar (pulse-ui's `ViewBarSlots`). A page with an app of its own (a router, a frame that stays while
its views change) mounts it with `mountApp(App, options)`, which takes the same options without
`view`, `args`, `frame`, `location` and `failedStart`, calls no tool itself and gives the whole page
one query client, and shows each view where the app puts it with `PageView` (`views`, `view`,
`args`, `location`, `chrome`, `failedStart`): it calls its view tool once per start, another view or other
arguments start it anew (as does another React `key`), and it gives the view its own address.
`mountPage` is one `PageView` in a `frame` on `mountApp`. Pulse's web app (`apps/web`) is such an
app.

A page elsewhere (an artifact in claude.ai, say) brings what its place needs through the same
options. `pageHints` are its words of what to do after a failure (default `PAGE_HINTS`, which lead
to Pulse's start page), with `connectionPlace`, where its viewer manages the page's connection.
`timeZone` is the zone its dates and days are in (default, and for a zone the browser does not
know: the browser's). `documentTheme: true` is for a document that states its theme itself on
`<html>`'s `data-theme`, as claude.ai stamps it for an explicit choice and leaves it off to follow
the system: the view reads it and writes no theme onto the document, so the kit's stylesheet
follows that attribute, else the OS. `now` is the page's clock where its numbers are not read now
(a recording's `asOf`), which a widget reads as `useViewHost().now`. `mountApp` and `mountPage`
also take `client`, the page's one query client, where a test hands in `createTestQueryClient()`
so a failing call fails at once. A view's call hands the page's caller a third argument where it
names one (`ToolCallOptions`): `refresh` asks past every cache under the caller, `connector` names
another connection than the caller's own. A caller that reaches one server refuses a call that
names another, as `webToolCaller` does, so a page never reads the wrong server unseen.

```ts
import { mountPage } from "@miragon/pulse-widget-shell/widgets"
import { engineViews } from "@miragon/pulse-engine-connector/widgets"

mountPage(engineViews, {
  view: "engine_open_cockpit",
  args: { engine: "prod" },
  // Your page's call of a server tool, resolving with its raw result (an `isError` one too).
  callTool: (name, args) => callServerTool(name, args),
  followUp: "copy",
  startPage: "/",
})
```

The MCP bundle never carries them: tree-shaking leaves `mountApp`, `PageView` and `mountPage` out
of a bundle that mounts with `mountViews`.

## A page's reads

A page of its own outside a chat (a dashboard as an artifact, say) reads its sections through the
page reads of `./widgets` under `mountApp`, so each section loads, shows and fails on its own and
the page holds the same rules as a view. `useSectionRead(key, read)` is one section's read: `read`
makes its calls through a `PageReader` (`reader.call(tool, args)`, `reader.timeZone`,
`reader.now()`) and its result goes straight to pulse-ui's `SectionState` (`state`, `retry` as its
`onRetry`). `key` names everything `read` depends on besides the reader, since sections with the
same key share one read. `usePageReads()` gives the bar its `refresh`, its `readAt` (pulse-ui's
`FreshnessStamp`), `reading` and the page's clock `now`. `PageGate` around the sections is the
page's ONE state while a refusal of a connection as a whole stands (no sign-in, no connection, no
approval): none of its sections mounts, and its Try again is the page's Refresh.

```tsx
import {
  Button,
  FreshnessStamp,
  SectionState,
  SectionStateGroup,
  WidgetHeader,
} from "@miragon/pulse-ui"
import {
  mountApp,
  PageGate,
  usePageReads,
  useSectionRead,
} from "@miragon/pulse-widget-shell/widgets"

function Running({ processKey }: { processKey: string }) {
  const section = useSectionRead(["stats", processKey], (reader) =>
    reader.call<{ now: { running: number } }>("engine_process_stats", {
      processDefinitionKey: processKey,
      bucket: "day",
      timeZone: reader.timeZone,
    }),
  )
  return (
    <SectionState state={section.state} onRetry={section.retry}>
      {(stats) => <p>{stats.now.running}</p>}
    </SectionState>
  )
}

function App() {
  const { readAt, refresh, reading } = usePageReads()
  const action = (
    <Button
      variant="toolbar"
      size="sm"
      aria-disabled={reading || undefined}
      onClick={reading ? undefined : refresh}
    >
      Refresh
    </Button>
  )
  return (
    <>
      <WidgetHeader
        title="Orders"
        actions={action}
        freshness={readAt && <FreshnessStamp at={readAt} />}
      />
      <main>
        <PageGate>
          <SectionStateGroup>
            <Running processKey="orders" />
          </SectionStateGroup>
        </PageGate>
      </main>
    </>
  )
}

mountApp(App, { callTool: (name, args, options) => callServerTool(name, args, options) })
```

The rules the reads hold, in the page's one query client:

- A call is kept 30 s by connection, tool and arguments (their keys in any order) and shared while
  it runs, so sections that need the same answer make one call; a failure is never kept. A call
  asks past every cache under the caller (`refresh`) once the page was refreshed, or where the
  same call settled before (Try again after a failure, an answer older than 30 s): only a key's
  first read may come from a cache of the caller's own.
- A section retries a transient failure as every view's read does (a connection that does not
  answer, an engine 503), never a refusal and never a permanent error; a call is never retried
  inside it. A later read that fails keeps the data on screen with the failure beside it.
- Refresh asks every call fresh from then on, cancels a read that runs, so none joins a call sent
  without `refresh`, opens a refused gate and reads every section on screen again.
- `readAt` is the oldest `asOf` of the answers the mounted sections show (a section whose refresh
  failed keeps its older read; one whose answers name none counts from when it finished, by the
  page's clock), never of a read its connection refuses as a whole: none while a page's one
  connection refuses, the time of the numbers still on screen while one of several does.
- A refusal is a `PageCallError` the page's caller rejects with (its `code` one of pulse-ui's
  `PageErrorCode`, its `connector` the connection that refused), worded by `describePageFailure`:
  the refusals by pulse-ui's `describePageError` with the connection's name and the page's
  `connectionPlace`, a server's errors by `describeError` with the page's `pageHints`, the raw text
  under "Details" only. A refusal of one tool (`not_allowed`) stays in its sections, said once
  under a `SectionStateGroup`, with no Try again.
- A read that calls a second connection names it (`reader.call(tool, args, { connector })`), and a
  page of several connections puts one `<PageGate connector="…">` around each connection's
  sections; a refusal of a connection no gate covers stays in its sections.

`createPageReader(callTool, options)` is the same reader without React, for a recorder or a test in
Node. `recordToolCalls(callTool)` records the calls a run answers, kept small (a `ToolRecording`
holds them with its `asOf` and zone), and `playRecording(recording, options)` replays one: spread
it into `mountApp`'s options (its caller, its clock and its zone), where `fail` fails a tool
(`engine_process_stats`), refuses every call with a code (`needs_reauth`) or one tool with one
(`engine_process_stats:unavailable`), `tools` refuses an undeclared tool `not_allowed` and `delayMs`
shows the skeletons. A call it holds no answer for answers a tool error that names it.

## A Claude artifact

`@miragon/pulse-widget-shell/claude-artifact` mounts a page of its own as a Claude artifact, a page
in claude.ai that reads an MCP server through the viewer's own connector to it.
`mountClaudeArtifact(App, { connector })` is `mountApp` with the artifact runtime's caller on the
connector the runtime knows by that name (`claudeToolCaller`), the theme claude.ai stamps on the
document read and never written (`documentTheme`), no hand-off, the artifact's words of what to do
(`ARTIFACT_PAGE_HINTS`, with claude.ai's settings as the place of a connector) and the browser's
language, since the artifact's frame names none of the viewer's. Every other option of `mountApp`
passes through (`locale`, `timeZone`, `pageHints`, `now`, `client`, `container`), and `callTool`
replaces the runtime's caller where a dev build or a test replays a recording (`playRecording`).

```tsx
import { mountClaudeArtifact } from "@miragon/pulse-widget-shell/claude-artifact"

// App: the page's sections on useSectionRead, behind its PageGate (A page's reads).
mountClaudeArtifact(App, { connector: "Pulse" })
```

The artifact publishes with the `mcp` capability, one entry per connector it calls with exactly the
tools it calls, `{ "mcp": { "servers": [{ "server": "Pulse", "tools": [<tools>] }] } }`; the
runtime refuses a call to a tool it does not name. The caller follows the runtime's contract as a
probe artifact verified it on 2026-11-25 (contract 0.2.99,
`packages/core/widget-shell/src/ui/claude-artifact/claude-tool-caller.ts`):
`window.claude.use("mcp")` gives the capability, read at the first call, and its
`callTool(server, tool, args, { cache })` takes positional arguments and resolves the tool's
result with `payload`, its JSON, which the caller resolves as the result's data. A call keeps its
answer in the runtime's cache 30 seconds and asks past it (`{ cache: { refresh: true } }`) where
the page asks fresh. Every other outcome rejects with a plain object `{ code, message, server }`:
a tool's own error (`tool_error`) the caller resolves as the `isError` answer it is, so
`describeError` words the server's text as in a chat, and a refusal of the runtime rejects as a
`PageCallError` in pulse-ui's codes, its raw code and message under "Details":

| The runtime's code                     | The page's code      | What the viewer is told                                            |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `needs_reauth`                         | `needs_reauth`       | Reconnect the connector in claude.ai, in Settings under Connectors |
| `server_not_connected`                 | `not_connected`      | Set up the connector in claude.ai, in Settings under Connectors    |
| `selection_required`                   | `selection_required` | Choose the connection the page uses when claude.ai asks            |
| `not_in_manifest`, `blocked_by_policy` | `not_allowed`        | Ask whoever published the page: it may not call the tool           |
| `approval_required`                    | `approval_required`  | Allow the page to use the connector when claude.ai asks            |
| `server_unavailable`                   | `unavailable`        | Try again: the connector does not answer                           |
| any other code, or none                | `tool_error`         | The message, worded by `describeError` as a server's text          |

A page outside an artifact (no `window.claude`) and a refused `use("mcp")` are `not_connected`; a
page published without the `mcp` capability (`use("mcp")` gives none) is `not_declared`, whose
words send the viewer to whoever published the page, with no Try again. Each of these, and
`needs_reauth`, `selection_required` and `approval_required`, refuses the connector as a whole
(`PageGate`); which runtime codes do rests on the probe of 2026-11-25, so probe the runtime again
before a code changes sides. A refusal forgets the capability, so the next try asks the runtime
anew and a connector set up meanwhile answers it.

A server's refusal no retry changes is said at once, with no Try again, its hint for whoever
published the page (`ARTIFACT_PAGE_HINTS`): arguments the tool does not take, a read that names
no engine on a Pulse server of several without a default (`ENGINE_NOT_SELECTED`), one that names
an engine the server does not have (`UNKNOWN_ENGINE`), and a process key no version of which is
deployed on the engine read. A page that reads a second connector
declares it beside the first and names it in its reads,
`reader.call(tool, args, { connector: "Acme CRM" })`, which the caller passes on as the runtime's
`server`; each refusal names the connector that refused, and one `<PageGate connector="…">` around
each connector's sections says it once.

## Use in a page without a build

A page with no bundler (a Claude artifact written as one HTML page, say) loads the page reads and
the Claude artifact's entry as one ES module from the package's `dist/browser/`, beside
pulse-ui's browser bundle and its stylesheet on the same CDN at the same version, and ships no
file of its own:

```html
<div id="root"></div>
<script type="module">
  import * as ui from "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@<version>/dist/browser/pulse-ui.js"
  import "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@<version>/dist/browser/pulse-ui-css.js"
  import {
    mountClaudeArtifact,
    PageGate,
    usePageReads,
    useSectionRead,
  } from "https://cdn.jsdelivr.net/npm/@miragon/pulse-widget-shell@<version>/dist/browser/claude-artifact.js"

  const h = ui.createElement
  const stats = (reader) =>
    reader.call("engine_process_stats", {
      processDefinitionKey: "orders",
      bucket: "day",
      timeZone: reader.timeZone,
    })

  function Running() {
    const section = useSectionRead(["stats", "orders"], stats)
    return h(ui.SectionState, { state: section.state, onRetry: section.retry }, (data) =>
      h(ui.KpiGrid, { cells: [{ label: "Running", value: ui.formatCount(data.now.running) }] }),
    )
  }

  function App() {
    const { readAt, refresh, reading } = usePageReads()
    const busy = { "aria-disabled": reading || undefined, onClick: reading ? undefined : refresh }
    const action = h(ui.Button, { variant: "toolbar", size: "sm", ...busy }, "Refresh")
    const freshness = readAt && h(ui.FreshnessStamp, { at: readAt })
    return h(
      "div",
      { className: "bg-background text-foreground" },
      h(ui.WidgetHeader, { title: "Orders", actions: action, freshness }),
      h(
        "main",
        { className: "flex flex-col gap-section p-gutter" },
        h(PageGate, null, h(ui.SectionStateGroup, null, h(Running))),
      ),
    )
  }

  mountClaudeArtifact(App, { connector: "Pulse" })
</script>
```

- **`claude-artifact.js`** holds the page reads (`useSectionRead`, `usePageReads`, `PageGate`,
  `PageCallError`, `describePageFailure`, `createPageReader`) and the Claude artifact's entry
  (`mountClaudeArtifact`, `claudeToolCaller`, `CLAUDE_RUNTIME_CODES`, `ARTIFACT_PAGE_HINTS`), with
  TanStack Query and the part of the view runtime `mountApp` mounts. It holds no React, no kit and
  no icon context: it imports them from pulse-ui's `pulse-ui.js` of the same version beside it on
  the CDN (`../../../pulse-ui@<version>/dist/browser/pulse-ui.js`), so the page and the module run
  on one React and one copy of the kit's contexts (its locale, its toasts, `SectionStateGroup`),
  and the stroke the view root sets (`ICON_STROKE`) reaches the kit's icons and the page's own
  from pulse-ui's `lucide.js`. Load
  all three modules from one CDN, jsDelivr or unpkg, at one version, pinned as every
  `@miragon/pulse-*` package below 1.0, and take React and the kit from that `pulse-ui.js` only:
  a second React from another URL breaks every hook. Without a build there is no JSX;
  `createElement`, as `h` here, writes the same tree.
- **The stylesheet** is pulse-ui's `pulse-ui.css`, which pulse-ui's `pulse-ui-css.js` holds and
  puts into the page as one `<style>` at the end of `<head>` when the page imports it (pulse-ui's
  README, "Use in a page without a build"). So the page is one HTML document with no file of its
  own, in a chat, whose content security policy loads no stylesheet from a CDN, and published
  alike. Its classes are the only ones the page's own elements can use, and a style of the page's
  own (a brand's override of the roles, say) stands in its `<body>`, after the kit's: in `<head>`
  the kit's rules win over it.
- **The rest** is a Claude artifact's (above): the page declares the `mcp` capability with the
  tools it calls, reads nothing but through `window.claude` (no fetch, XHR or WebSocket, which the
  artifact's content security policy refuses anyway), follows claude.ai's theme and speaks the
  browser's language. `packages/core/widget-shell/test/browser-page.test.ts` renders this example
  in Chromium, in a chat's frame and in a published artifact's sandboxed frame, each under its
  content security policy.

## The web app

Beside an OAuth provider, `MCP_WEB_CLIENT_ID` turns on a web app under `/app` with its sign-in,
behind the Host/Origin guard: people sign in through the server's own provider as a confidential
client (the code flow with PKCE S256, the state and RFC 9207's `iss` checked before the provider is
asked anything), and the access token must pass the gate in front of `/mcp` before the session
keeps it. The session lives in a sealed `__Host-pulse-session` cookie (HttpOnly, Secure, SameSite=Lax,
at most three chunks), never on the server, so every replica built with the same keys serves it.
A sign-out ends it on the server all the same: the replica that takes it keeps the session's id
until its seal expires (in memory, at most 100,000), so no copy of the cookie opens the session
there again, and the browser gets a sealed `__Host-pulse-ended` cookie naming it until then, so
no replica opens the session cookie a call under way sets again in that browser; the replica that
refuses such a cookie revokes its refresh token behind its answer, once per token, since a call on
another replica may have renewed it after the sign-out. Another replica learns nothing of a copy:
there it holds until its access token runs out, since the sign-out revoked the refresh token where
the provider offers revocation, which is why a short access-token lifetime suits the web client.

| Route                                    | What it does                                                                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /app/auth/login`                    | Starts a sign-in (`?return=` a page under `/app` to come back to) with the provider's web scopes and the gate's resource (RFC 8707) unless its web client names none                                           |
| `GET /app/auth/callback`                 | Checks the callback, exchanges the code, starts a new session (a new id and CSRF secret), returns to the page; a failure goes to `/app/signed-out?reason=<reason>`                                             |
| `POST /app/auth/logout`                  | Takes the page's CSRF token, ends the session (this replica, the ended cookie), revokes the refresh token, clears the cookies and names where to go: the provider's end of the session, else `/app/signed-out` |
| `GET /app/api/session`                   | The signed-in name, the CSRF token and the session's end, an expired token renewed first as a call's; `401` with `signed_out` without one, for a signed-out one and for one whose expired token nothing renews |
| `POST /app/api/call`                     | A page's call of a server tool (`{ name, arguments }`, JSON, at most 64 KiB, with the CSRF token), forwarded to `/mcp` with the session's token; `{ result }`; a page that leaves cancels it (499)             |
| `GET /app` and each page of `pages.json` | The build's page (below), `no-store`; without a session a 302 to `/app/auth/login` with the page and its query to return to                                                                                    |
| `GET /app/signed-out`                    | The build's page without a session, `no-store`                                                                                                                                                                 |
| `GET /app/assets/*`                      | The build's assets at the path a browser requests for each name, immutable for a year; a text asset over 1 KiB in brotli or gzip where `Accept-Encoding` takes it                                              |

A provider, `MCP_URL` (https, or http on localhost), `MCP_WEB_CLIENT_SECRET`,
`MCP_WEB_SESSION_KEYS` (comma-separated base64url keys of at least 32 bytes; the first seals,
every one opens, so a new key goes last on every replica before it goes first) and a web build
(below) are required beside the client id;
`MCP_WEB_SESSION_HOURS` is optional (8 by default, at most 24), and so is
`MCP_WEB_SESSION_CHECK_MINUTES` (1 to 60, unset by default), which has each session's token renewed
at the provider at least that often, whatever its lifetime. The secret, the keys, the hours or the
check without the client id fail the boot too, so the web app is never off unseen; `MCP_WEB_DIR`
may stand alone. The sign-in asks each provider for its
own scopes: Keycloak `openid profile` (no offline token), Auth0 also `offline_access` and the
resource as `audience`, WorkOS, Better Auth and Convex `openid profile email offline_access`, the
generic OpenID Connect provider and a provider of a root's own `openid` unless its `web` names
others; `MCP_WEB_SCOPES` (separated by spaces or commas, only beside the client id) replaces them
(Okta, authentik and Zitadel `openid profile offline_access`; ADFS needs the generic provider's
`openid`), and the sign-in asks for a
provider's `requiredScopes` besides, since the gate checks the session's token for them. It reads
the generic provider's metadata from the discovery its gate reads. Every grant of the sign-in names
the gate's resource and only the authorization request the scopes, unless the provider's web client
says otherwise, as Entra ID needs: `discoveryIssuer` names the issuer the sign-in discovers itself
and goes through (a callback's `iss` must name it), beside the one the protected resource metadata
names, `resource: false` sends no resource anywhere, a string sends that one in place of the gate's
(the generic provider's Web API identifier for an ADFS audience) and `grantScopes: true` names the
scopes at the code exchange and every refresh too. `/mcp` answers a request that carries the session cookie with
the gate's 401 and its Bearer challenge, and every route under `/app` answers 400 to one that
carries an Authorization header. `@miragon/pulse-widget-shell/testing/oidc` is the identity
provider a server's own sign-in tests run against.

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
gets 403 `WEB_NOT_FOR_PAGES` or `WEB_READ_ONLY` before it runs. A due access token (due by its
expiry, or by the check, which the receipt sealed in the cookie lets every replica read) is renewed
first with the refresh token, one refresh per pair of tokens and replica at a time within 10 s (the
session route renews through the same), and sealed back into the cookie, unless the session was
signed out at this replica while the call ran (401, no cookie set). The provider's first refusal of
a pair at a replica may be a race with another replica's renewal, so a token that has not expired
still goes out; its second refusal there, or a refusal once the token expired, ends the session
(401 `signed_out`, its cookies left to a call beside it that may have renewed them). A provider
that does not answer ends no session: the token goes out while it holds (with the check, for two
intervals after its receipt at most), then 503. A provider should not rotate the web client's
refresh tokens: where it does, a renewal whose answer never reaches the browser (or comes after the
10 s) leaves it the spent token (the server keeps the new one 30 s), whose second refusal ends the
session, on one replica too. A sign-in without a refresh token works, its session ending with its
access token, and the log says so; with the check, a session whose refresh token expired ends at
its check without asking the provider. No answer ever holds a token.
A page reads its session with `readWebSession()` and hands `mountApp` (or `mountPage`) the caller
`webToolCaller(session)` from `./widgets`, which posts each call with the CSRF token and tells
`onSignedOut` when the session is gone.

## Peers and the SDK

`@miragon/pulse-ui`, `react`/`react-dom`, `zod` and `@tanstack/react-query` are ranged peers
(`react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`, `@miragon/pulse-ui` `^<this release>`), so they
resolve to one instance with your app's copy. **A view bundle needs a 1.x `lucide-react` that
exports `LucideProvider`** (Pulse pins 1.79.0): a deduped 0.x copy fails the bundle build with a
missing export. The BPMN viewer is pulse-ui's (`@miragon/pulse-ui/bpmn`), whose optional peer
`bpmn-js` (`^18.31.1`) a view that draws a diagram installs.

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
