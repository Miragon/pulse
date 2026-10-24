# Pulse for VS Code

[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> [!IMPORTANT]
> **Spike phase.** Pulse for VS Code is an early prototype that explores whether this is worth
> building. It is not on the Marketplace yet, see [Install](#install). Changes to engine data
> are off for every engine but a local one unless you turn them on (`pulse.writes`).

A VS Code extension that shows what your process engine is running, right next to your BPMN
models: definitions, instances, incidents and variables, with the badges on the deployed
diagram. Retry incidents and fix variables where you allow it. It works with
[Operaton](https://operaton.org), [CIB seven](https://cibseven.org) and Camunda 7. Other engines,
such as Camunda 8, plug in as an adapter of their own on the same contract.

![Pulse in VS Code: from the engine to its process and an instance with an incident, the expired card fixed in its variables and the retry that clears the incident](docs/demo.gif)

## Why

When a process instance gets stuck, a developer leaves the editor: opens the engine's web UI,
searches the instance, reads the stack trace, goes back to the code and the model. Pulse
brings that view to where the models and the code already are. What you get:

- **The runtime on the model.** Running instances and incidents as badges on the deployed
  diagram, per version, with the instances one click away.
- **The root cause, not the noise.** The incident's root cause from the full stack trace, with
  links from its frames to your sources.
- **Model and engine side by side.** An open `.bpmn` file tells you whether it matches a
  deployed version.
- **Safe on real engines.** Writes are allowed on local engines by default, elsewhere only when
  you say so, always with a confirmation that names the engine and an audit line.
- **One tool for every engine.** The engines come from the Pulse CLI's project file
  `.pulse-cli.json`; one adapter per engine family, the rest stays the same.

## What it does

- **Engines** view: the profiles of `.pulse-cli.json` (the project file of the
  [Pulse CLI](https://github.com/Miragon/pulse/tree/main/apps/cli), `npx @miragon/pulse-cli`),
  their deployed processes with running counts and incident markers. LOCAL is detected, PROD
  only by configuration and always red. A broken file shows up as an error item that opens it.
- **Engine overview**: a click on an engine (or _Open Engine Overview…_) lists its
  processes with latest version, running and with-incident counts, the ones in trouble
  first, with a search and a "With incident" scope; a row opens the process.
- **Definition** panel: the deployed diagram of one version with badges per element,
  the version picker with per-version counts, instances (running, with incident, ended),
  filter by element or business key.
- **Instance** panel: where it waits, incidents with the root cause from the full stack
  trace, incidents inside called instances, variables, a Markdown handover to copy.
- **Stack traces** as read-only documents with links from your frames to your sources and
  from class names to their declaration.
- **Model and code**: from an incident or any element, open the local `.bpmn` at the element
  and the worker or delegate that implements it.
- **Show Runtime Data for This Model** on a `.bpmn` file: tells you whether the file
  matches a deployed version, and shows that version.
- **Go to Process Instance…** by id or business key.
- **Retry incidents, change variables and move tokens**, guarded: on local engines by default, on
  others only when you allow it in your user settings, with a confirmation that names
  the exact target and an audit line per write ([docs/adr/writes.md](docs/adr/writes.md)).
- **Cancel or migrate many instances** as one batch: tick them in the definition panel,
  follow the progress and stop it. A migration shows both versions with the mapping the
  engine proposes, checks every change and flags elements where instances would get stuck
  before anything runs ([docs/adr/migrations.md](docs/adr/migrations.md)).

Screenshots of every use case: [docs/screenshots](docs/screenshots/README.md).

## Install

Pulse for VS Code is not on the Marketplace or Open VSX yet. Build the `.vsix` from source
(see [Try it from source](#try-it-from-source) for the setup) and install it:

```sh
pnpm --filter pulse-vscode run package               # writes apps/vscode/pulse-vscode-<version>.vsix
code --install-extension apps/vscode/pulse-vscode-*.vsix
```

Then tell Pulse which engines to show.

## Configure

Configure your own engines as profiles in `.pulse-cli.json`, the project file of the
[Pulse CLI](https://github.com/Miragon/pulse/tree/main/apps/cli), so the extension and
`npx @miragon/pulse-cli` see the same engines:

```json
{
  "profiles": {
    "dev": {
      "url": "https://dev.example.com/engine-rest",
      "flavor": "operaton",
      "auth": { "type": "basic" },
      "cockpitUrl": "https://dev.example.com/operaton/app/cockpit/default/"
    }
  }
}
```

Pulse reads `url`, `flavor` (`camunda7`, `cibseven` or `operaton`; `camunda7` when absent),
`auth.type` (`none`, `basic`), `cockpitUrl` and `readOnly` (no writes from Pulse either); a
profile it cannot serve yet shows up as a problem. Mark production in your settings:
`"pulse.environments": { "dev": "production" }`.
Credentials: _Pulse: Set Credentials…_ (stored in VS Code's secret storage).

Pulse also reads the CLI's former project file, `.operate.json`, in every folder without a
`.pulse-cli.json`, and marks it with a warning in the Engines view: rename it to
`.pulse-cli.json`. The former name is read until the first Pulse release after 2027-01-31.

Open views read the engine again on their own while they are visible and VS Code has focus:
every 5–30 s on local engines, 15–60 s on test engines. Production and unclassified engines
stay as they are until you turn them on, with the play button next to the time in a panel or
in your user settings: `"pulse.liveUpdates": { "production": "on" }`. Only your user settings
count, a workspace cannot turn them on. The pause button stops them for one panel.

`cockpitUrl` is optional. With it, the definition and instance panels get an _Open in
Cockpit_ button that opens the shown
version or instance in the engine's own web UI. Pulse never guesses this URL from the
endpoint: without `cockpitUrl` there is no button. It must be an `http` or `https` URL
without credentials:

| Engine                                   | `cockpitUrl`                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Camunda 7, Operaton, CIB seven (Cockpit) | the Cockpit of the engine, ending in `/app/cockpit/<engine name>/`, e.g. `…/operaton/app/cockpit/default/` |
| CIB seven webclient                      | the webclient, ending in `/webapp/`                                                                        |

A Camunda 7 family URL with another path gets no button.

## Try it from source

From the root of the Pulse repository:

```sh
pnpm install --frozen-lockfile
pnpm --filter pulse-vscode run engine:up   # Operaton 2.1.5 on :18080, seeded with demo instances (podman or docker)
pnpm --filter pulse-vscode run build
```

Then open `apps/vscode` in VS Code and press **F5** ("Run Pulse") to open the extension on
`apps/vscode/dev/host/workspace`, or run the UI in a browser against the same engine:

```sh
PULSE_DEV_ENGINE=http://localhost:18080/engine-rest pnpm --filter pulse-vscode run dev   # http://localhost:5180
```

For hands-on testing there is a shop sandbox: two real engines (Operaton and CIB seven
with login) with about 200 seeded instances, incidents with real stack traces, older versions,
a model that drifted, and optional live traffic. Its test charter is in
[sandbox/README.md](sandbox/README.md).

```sh
pnpm --filter pulse-vscode run sandbox:open     # builds Pulse, starts the engines, opens the sandbox in VS Code
pnpm --filter pulse-vscode run sandbox:traffic  # optional: live orders until Ctrl+C
```

## Architecture

The core never knows which engine it talks to: it asks the ports of a contract, and one adapter
per engine family answers. Who talks to whom, about what and how, in pictures:
[docs/architecture-overview.md](docs/architecture-overview.md). The extension is one package
with six layers under `src/`, each with its own globals and dependency rules, and each layer
explains its idea in its own README: [contract](src/contract/README.md),
[core](src/core/README.md), [webview](src/webview/README.md), [host](src/host/README.md),
[the C7 adapter](src/adapters/c7/README.md). A new engine is one more adapter folder under
`src/adapters/` and one entry in the composition root
([how](docs/architecture-overview.md#4-one-adapter-for-operaton-cib-seven-and-camunda-7)).
Decisions and their reasons: [docs/adr](docs/adr/README.md).

## Development

Run these from the repository root; the repository's bar (`pnpm build && pnpm typecheck &&
pnpm test && pnpm lint`) covers the extension too.

| Command                                           | What it does                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm --filter pulse-vscode test`                 | unit tests and the webview tests in Chromium, with the coverage floors and the bundle budget |
| `pnpm --filter pulse-vscode run typecheck`        | the whole app, then each layer with its runtime's globals only                               |
| `pnpm --filter pulse-vscode run lint`             | ESLint with the extension's house rules                                                      |
| `pnpm lint:architecture:vscode`                   | the closed-world dependency rules of the layers                                              |
| `pnpm --filter pulse-vscode run test:mutation`    | Stryker mutation testing of contract, core, the C7 adapter and the model adapter             |
| `pnpm --filter pulse-vscode run test:engines`     | conformance kit against a real engine (`PULSE_ENGINE_IMAGE`, testcontainers)                 |
| `pnpm --filter pulse-vscode run test:smoke`       | activation test in VS Code (`@vscode/test-cli`)                                              |
| `pnpm --filter pulse-vscode run test:e2e`         | Playwright drives VS Code against `engine:up`                                                |
| `pnpm --filter pulse-vscode run dev`              | browser dev host for the webview (fake engine or `PULSE_DEV_ENGINE`)                         |
| `pnpm --filter pulse-vscode run sandbox:up`       | shop sandbox for manual testing (`sandbox:traffic`, `sandbox:down`)                          |
| `pnpm --filter pulse-vscode run docs:screenshots` | one VS Code screenshot per use case into `apps/vscode/docs/screenshots` (sandbox running)    |
| `pnpm --filter pulse-vscode run package`          | the `.vsix`                                                                                  |

The webview tests need Chromium once: `pnpm --filter pulse-vscode exec playwright install chromium`.

The README's `apps/vscode/docs/demo.gif` comes from the `product-shots` skill in
[Miragon/corporate-identity](https://github.com/Miragon/corporate-identity), see
[CLAUDE.md](CLAUDE.md#commands).

Rules for contributors and coding agents: [CLAUDE.md](CLAUDE.md).

## Release

The extension rides Pulse's release train: release-please bumps `apps/vscode/package.json`
with every Pulse release (tag `v<version>`), and after the release approval
`.github/workflows/publish-vscode-extension.yml` packages the .vsix once. It leaves the run
only when the repository variable `VSCODE_PUBLISH` says so: `pre-release` publishes it as a
pre-release to the Visual Studio Marketplace and Open VSX and attaches it to the GitHub
release, `release` does the same as a release; unset (today) nothing is published. Every pull
request packages it too (CI job "VS Code package (vsce dry run)"); to check the release path by
hand, run the Release workflow with `dry_run`. The whole train:
[the repository's CLAUDE.md](../../CLAUDE.md#releases--toolkit-contributions).

## License

MIT
