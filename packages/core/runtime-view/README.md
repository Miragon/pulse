# Runtime view

The engine-neutral runtime view of Pulse's editor hosts, Pulse for VS Code (`apps/vscode`) and
Pulse for Orca (`apps/orca`): what an engine runs, next to the BPMN models. Private: only the
editor hosts and a family's adapter of its contract import it, and esbuild bundles it into each
host.

| Layer    | Path                | Entry                                               | Holds                                                                                               |
| -------- | ------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| contract | `src/contract`      | `@miragon/pulse-runtime-view/contract`              | ports, read models, the conformance kit (`/contract/conformance`), a fake (`/contract/fake`)        |
| core     | `src/core`          | `@miragon/pulse-runtime-view/core`                  | panels, boards, refresh loops, view models                                                          |
| protocol | `src/core/protocol` | `@miragon/pulse-runtime-view/protocol`              | the JSON messages and view models between a host and the webview                                    |
| model    | `src/model`         | `@miragon/pulse-runtime-view/model`                 | the local `.bpmn` reader and the code locator, behind the contract's ports                          |
| webview  | `src/webview`       | `@miragon/pulse-runtime-view/webview-build-options` | the Preact webview each host bundles into its frames                                                |
| host kit | `src/host-kit`      | `@miragon/pulse-runtime-view/host-kit`              | the rules every editor host shares: targets, write and live policies, the write audit, panel titles |

Each layer has its own `tsconfig.<layer>.json` with its runtime's globals only, and its own
closed-world dependency rules (`.dependency-cruiser.cjs`, `pnpm lint:architecture:runtime-view`).
The hosts read the types from the build (`dist`, declarations only) and bundle the sources.

The architecture decisions are the extension's (`apps/vscode/docs/adr/`), where the runtime view
grew up; the house rules are in `apps/vscode/CLAUDE.md`.

```sh
pnpm --filter @miragon/pulse-runtime-view test       # unit and webview (Chromium) tests, coverage floors
pnpm --filter @miragon/pulse-runtime-view run typecheck
pnpm lint:architecture:runtime-view
```
