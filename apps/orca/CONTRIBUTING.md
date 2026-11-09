# Developing Pulse for Orca

How the plugin is built, tested and released. Using it is on the
[docs site](https://miragon.github.io/pulse/orca/). Rules for contributors and coding agents,
where code goes and how to try the plugin against the sandbox engines: [CLAUDE.md](CLAUDE.md).

## Architecture

The plugin is the second editor host of the runtime view (`packages/core/runtime-view`) and the
C7 adapter (`packages/connectors/engine/engine-adapter`), next to Pulse for VS Code. A trusted
worker (`src/worker`) composes both, the Pulse panel (`src/panel`) is built from Orca's
components, and the webview runs in isolated custom-editor frames (`src/editor`). What Orca does
not offer yet: [the architecture page](https://miragon.github.io/pulse/orca/architecture).

## Development

Run these from the repository root; the repository's bar (`pnpm build && pnpm typecheck &&
pnpm test && pnpm lint`) covers the plugin too.

| Command                                            | What it does                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm --filter @miragon/pulse-orca run build`      | the plugin folder `apps/orca/dist`, as Orca loads it                             |
| `pnpm --filter @miragon/pulse-orca test`           | the worker against a fake Orca, with the coverage floors                         |
| `pnpm --filter @miragon/pulse-orca run typecheck`  | the app, then the worker and the frames with their own globals                   |
| `pnpm --filter @miragon/pulse-orca run test:orca`  | the typings against this Orca, then `orca plugin validate` and `check` on `dist` |
| `pnpm --filter @miragon/pulse-orca run test:kit`   | the panel and the worker on Orca's own test kit (`orca/testing`)                 |
| `pnpm --filter @miragon/pulse-orca run test:smoke` | build, load into the running Orca, read the sandbox engines, open a view         |
| `pnpm lint:architecture:orca`                      | the closed-world dependency rules                                                |

`test:orca` and `test:kit` need an installed Orca, or `ORCA_RESOURCES` naming the resources
folder of a release (CI extracts the pinned `.deb`).

## Release

The plugin rides Pulse's release train: release-please bumps `apps/orca/package.json` and
`apps/orca/orca-plugin.json` with every Pulse release, and after the release approval
`.github/workflows/publish-orca-plugin.yml` builds and checks the plugin folder. Publishing it
into [Miragon/orca-modelers](https://github.com/Miragon/orca-modelers) is off for now
(`publish: false` in `.github/workflows/release-please.yml`), until that repository lists
`pulse-cockpit` in its `sources.json`. The whole train:
[the repository's CLAUDE.md](../../CLAUDE.md#releases).
