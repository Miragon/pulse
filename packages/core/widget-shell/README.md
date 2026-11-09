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
npm install react react-dom @miragon/pulse-ui lucide-react@1.67.0 @tanstack/react-query
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

| Part             | Entry       | What you get                                                                                                                                                                                                                   |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server boot      | `./server`  | `createComposedServer` and `runComposedServer`: module selection with `module:toolset` suffixes in `MCP_ACTIVE_MODULES`, OAuth from `MCP_OAUTH_*`, the Host/Origin guard, `/mcp`, `/health/*`, `/metrics` and the served fonts |
| Module port      | `./server`  | `ComposableModule`, `ModulePlugin`, `ModuleEntry`, `ModuleServer` (the official SDK's `registerTool`/`registerPrompt`/`registerResource`), `createToolsetVocabulary` for toolsets that fail closed                             |
| Tool authoring   | `./server`  | The registrar (`createToolRegistrar`, `withToolErrors`), `showToolBinding`, `OwnViewBinding`, `AppResourceCsp`, `appOnly`, `strictToolInput`, `buildViewResult`, `buildDataFeedResult`, `decodeToolResult`, `createTranslator` |
| Server helpers   | `./server`  | The BPMN-name readers (`readBpmnNames`, `parseBpmnNames`), the per-caller request info (`callerCacheKey`, `getMcpRequestInfo`, `runWithMcpRequestInfo`), `composedEnvVars`, `viewResourceUri`, `viewPrelude`                   |
| Bundle build     | `./server`  | `VIEW_BUNDLE_DEDUPE`, `viewBundleWatchPlugin`, and the served fonts (`installFontAssets`, `fontAssetsCsp`)                                                                                                                     |
| View runtime     | `./widgets` | `mountViews`, the view host (`useViewHost`, `HostModelContext`), the query hooks (`useToolQuery`, `useToolMutation`, `useViewData`), host widgets by raw id (`useHostWidget`, `HostWidgetSlot`), `TestViewHost` for tests      |
| Host-bound UI    | `./widgets` | `WidgetShell`, `ListTable` + `PagedRows`, `IdCell`/`IdText`, `describeError`, `useActionFeedback`, `ConfirmDialog`, the hand-offs (`HAND_OFF_ACTIONS`, `AskAiButton` for one it does not list) and the BPMN viewer             |
| Module tests     | `./testing` | `recordingModuleServer` and `testServerContext` for a module's tools, prompts and resources                                                                                                                                    |
| Product glossary | `./testing` | `PRODUCT_GLOSSARY`, `glossaryFindings`, `blindGlossaryRules`, `unnamedGlossaryTerms`: one word per thing across the Pulse modules                                                                                              |

Views render in German for a host locale whose language is `de` and in English otherwise; the
design kit itself (primitives, tones, formatters) comes from `@miragon/pulse-ui`. Without an
OAuth provider the boot runs unauthenticated with one warning, and a module with toolsets runs
its read-only floor; the providers and what fails the boot are under
[Security](https://miragon.github.io/pulse/mcp/operations#security).

## Peers and the SDK

`@miragon/pulse-ui`, `react`/`react-dom`, `zod` and `@tanstack/react-query` are ranged peers
(`react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`, `@miragon/pulse-ui` `^<this release>`), so they
resolve to one instance with your app's copy. **A view bundle needs a 1.x `lucide-react` that
exports `LucideProvider`** (Pulse pins 1.67.0): a deduped 0.x copy fails the bundle build with a
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
