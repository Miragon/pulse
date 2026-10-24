# Pulse

[![CI](https://github.com/Miragon/pulse-vscode-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse-vscode-plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> [!IMPORTANT]
> **Spike phase.** Pulse is an early prototype that explores whether this is worth building.
> Releases are pre-releases only, see [Install](#install). Changes to engine data are off
> for every engine but a local one unless you turn them on (`pulse.writes`).

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
- **One tool for every engine.** The engines come from operate's project file
  `.operate.json`; one adapter per engine family, the rest stays the same.

## What it does

- **Engines** view: the profiles of `.operate.json` (the project file of the
  [operate](https://github.com/Miragon/operate) CLI), their deployed processes with running counts and
  incident markers. LOCAL is detected, PROD only by configuration and always red. A
  broken file shows up as an error item that opens it.
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

Install **Miragon Pulse** from the VS Code Marketplace or Open VSX; as long as only pre-releases
exist, the install button picks the latest one. Each release also attaches the `.vsix` to its
GitHub release (`code --install-extension pulse.vsix`). Then tell Pulse which engines to show.

## Configure

Configure your own engines as profiles in `.operate.json`, the project file of the
[operate](https://github.com/Miragon/operate) CLI, so Pulse and operate see the same engines:

```json
{
  "profiles": {
    "dev": {
      "url": "https://dev.example.com/engine-rest",
      "platform": "operaton",
      "auth": { "type": "basic" },
      "cockpitUrl": "https://dev.example.com/operaton/app/cockpit/default/"
    }
  }
}
```

Pulse reads `url`, `platform` (`operaton`, `cibseven` or `camunda7`), `auth.type` (`none`,
`basic`), `cockpitUrl` and `readOnly` (no writes from Pulse either); a profile it cannot serve
yet shows up as a problem. Mark production in your settings:
`"pulse.environments": { "dev": "production" }`.
Credentials: _Pulse: Set Credentials…_ (stored in VS Code's secret storage).

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

```sh
npm ci
npm run engine:up      # Operaton 2.1.5 on :18080, seeded with demo instances (podman or docker)
npm run build
```

Then press **F5** ("Run Pulse") to open the extension on `apps/vscode/dev/host/workspace`,
or run the UI in a browser against the same engine:

```sh
PULSE_DEV_ENGINE=http://localhost:18080/engine-rest npm run dev   # http://localhost:5180
```

For hands-on testing there is a shop sandbox: two real engines (Operaton and CIB seven
with login) with about 200 seeded instances, incidents with real stack traces, older versions,
a model that drifted, and optional live traffic. Its test charter is in
[sandbox/README.md](sandbox/README.md).

```sh
npm run sandbox:open     # builds Pulse, starts the engines, opens the sandbox in VS Code
npm run sandbox:traffic  # optional: live orders until Ctrl+C
```

## Architecture

The core never knows which engine it talks to: it asks the ports of a contract, and one adapter
per engine family answers. Who talks to whom, about what and how, in pictures:
[docs/architecture-overview.md](docs/architecture-overview.md). Each package explains its idea in
its own README: [contract](src/contract/README.md), [core](src/core/README.md),
[webview](src/webview/README.md), [extension](src/host/README.md),
[adapter-c7](src/adapters/c7/README.md). A new engine is one more adapter package and one
entry in the composition root ([how](docs/architecture-overview.md#4-one-adapter-for-operaton-cib-seven-and-camunda-7)).
Decisions and their reasons: [docs/adr](docs/adr/README.md).

## Development

| Command                    | What it does                                                                    |
| -------------------------- | ------------------------------------------------------------------------------- |
| `npm run verify`           | typecheck, lint, format, architecture rules, dead code, unit tests, in parallel |
| `npm run check`            | the same with browser tests, coverage thresholds and the bundle budget          |
| `npm run test:mutation`    | Stryker mutation testing of contract, core and the C7 adapter (incremental)     |
| `npm run test:browser`     | webview tests in Chromium                                                       |
| `npm run test:engine`      | conformance kit against a real engine (`PULSE_ENGINE_IMAGE`, testcontainers)    |
| `npm run test:smoke`       | activation test in VS Code (`@vscode/test-cli`)                                 |
| `npm run test:e2e`         | Playwright drives VS Code against `npm run engine:up`                           |
| `npm run dev`              | browser dev host for the webview (fake engine or `PULSE_DEV_ENGINE`)            |
| `npm run sandbox:up`       | shop sandbox for manual testing (`sandbox:traffic`, `sandbox:down`)             |
| `npm run docs:screenshots` | one VS Code screenshot per use case into `apps/vscode/docs/screenshots` (sandbox running)   |

The README's `apps/vscode/docs/demo.gif` comes from the `product-shots` skill in
[Miragon/corporate-identity](https://github.com/Miragon/corporate-identity), see [AGENTS.md](CLAUDE.md#commands).

Rules for contributors and coding agents: [AGENTS.md](CLAUDE.md); how a release is cut:
[CONTRIBUTING.md](CONTRIBUTING.md#releasing).

## License

MIT
