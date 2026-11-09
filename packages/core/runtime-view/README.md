# Runtime view

The engine-neutral runtime view of Pulse's editor hosts, Pulse for VS Code (`apps/vscode`) and
Pulse for Orca (`apps/orca`): what an engine runs, next to the BPMN models. Private: only the
editor hosts and a family's adapter import it, and esbuild bundles it into each host. Its engine
contract is the engine family's core, [`@miragon/pulse-engine-core`](../../connectors/engine/engine-core/README.md):
the ports, read models and failure kinds every dialect answers in, the conformance kit and the
fake (`./testing`), which its layers and the hosts import directly (owner decision 2026-11-09 on
#585: one home of the contract, no second copy here).

| Layer    | Path                | Entry                                               | Holds                                                                                              |
| -------- | ------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ports    | `src/ports`         | `@miragon/pulse-runtime-view/ports`                 | the ports only the editor hosts need: `EngineAdapter`, the local model and its code                |
| core     | `src/core`          | `@miragon/pulse-runtime-view/core`                  | panels, boards, refresh loops, view models                                                         |
| protocol | `src/core/protocol` | `@miragon/pulse-runtime-view/protocol`              | the JSON messages and view models between a host and the webview                                   |
| model    | `src/model`         | `@miragon/pulse-runtime-view/model`                 | the local `.bpmn` reader and the code locator, behind the local ports                              |
| webview  | `src/webview`       | `@miragon/pulse-runtime-view/webview-build-options` | the Preact webview each host bundles into its frames                                               |
| host kit | `src/host-kit`      | `@miragon/pulse-runtime-view/host-kit`              | the rules every editor host shares: targets from `.pulse.json`, write and live policies, the audit |

Each layer has its own `tsconfig.<layer>.json` with its runtime's globals only, and its own
closed-world dependency rules (`.dependency-cruiser.cjs`, `pnpm lint:architecture:runtime-view`):
the ports, the core, the model reader and the host kit import engine-core's main entry, the core
and the webview Pulse's UI foundation (`@miragon/pulse-ui/tones`, `@miragon/pulse-ui/format`), the
host kit's connections the profile format (`@miragon/pulse-profile`), and no layer a dialect's
core. That edge of `packages/core` into the engine family is the one the owner accepted
(`runtime-view-builds-on-the-engine-contract` in the repository's `.dependency-cruiser.cjs`).
The hosts read the types from the build (`dist`, declarations only) and bundle the sources.

The architecture decisions are the extension's (`apps/vscode/docs/adr/`), where the runtime view
grew up; the house rules are in `apps/vscode/CLAUDE.md`.

```sh
pnpm --filter @miragon/pulse-runtime-view test       # unit and webview (Chromium) tests, coverage floors
pnpm --filter @miragon/pulse-runtime-view run typecheck
pnpm lint:architecture:runtime-view
```
