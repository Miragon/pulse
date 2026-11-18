# @miragon/pulse-engine-connector

[![npm](https://img.shields.io/npm/v/@miragon/pulse-engine-connector)](https://www.npmjs.com/package/@miragon/pulse-engine-connector)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

The engine module of Pulse for your own MCP server: the `engine_*` tools that operate Camunda 7,
CIB seven and Operaton engines, and the cockpit view that shows incidents, instances and diagrams
right in the chat. Below 1.0: pin the exact version and update all `@miragon/pulse-*` packages
together.

## Install

```sh
npm install @miragon/pulse-engine-connector @miragon/pulse-widget-shell zod bpmn-js@18.31.1
npm install react react-dom @miragon/pulse-ui @miragon/pulse-blocks lucide-react@1.70.0
```

`zod`, `bpmn-js` and `@miragon/pulse-widget-shell` are required peers, the second line is for the
view bundle; the module needs no MCP SDK package of its own, widget-shell brings it. The
[pulse-starter](https://github.com/Miragon/pulse-starter) composes this module already:
[Build your own server](https://miragon.github.io/pulse/mcp/build-your-own).

## Minimal use

Hand `engineModule` to widget-shell's boot (`createComposedServer({ modules: [engineModule], … })`),
and its views to the view bundle:

```ts
import { mountViews } from "@miragon/pulse-widget-shell/widgets"
import { engineViews } from "@miragon/pulse-engine-connector/widgets"

mountViews({ views: { ...engineViews } })
```

Your stylesheet scans the module's widget sources, since it ships them as TypeScript:
`@source "../node_modules/@miragon/pulse-engine-connector/src";`, and the build of the board's
tiles its cockpit renders: `@source "../node_modules/@miragon/pulse-blocks/dist";`. Point it at an engine with
`ENGINE_BASE_URL` (default `http://localhost:8410/engine-rest`), or at several with a profile file
in `ENGINES_JSON` / `ENGINES_FILE`; every variable is in the
[configuration reference](https://miragon.github.io/pulse/mcp/reference#configuration).

## What it provides

- **Operations tools.** One tool per engine operation (process instances, tasks, incidents, jobs,
  history, …), plain JSON for the model.
- **Answers in one call.** `engine_inspect_process_instance` shows where one instance waits and why
  (running or ended, by id, business key or definition key); `engine_status` triages one engine
  into findings by severity, counts and a live verdict. Both cap long lists and name each cut in
  `truncated`.
- **The cockpit view.** `engine_open_cockpit` opens the operations cockpit on any of its views
  (overview, incidents, failure cluster, process, instances, instance, incident, jobs, history,
  board, and the landing: the engines and the server's boards to pick from), with two engines or
  more on the cross-engine overview (each engine's health, job backlog and processes, counts
  only), and returns that view's facts as compact JSON; app-only `*_data` feeds refresh and
  navigate inside it.
- **Boards.** With `ENGINE_BOARDS_DIR`, the module reads the board files of
  [`@miragon/pulse-board`](https://www.npmjs.com/package/@miragon/pulse-board), the format of Pulse
  for VS Code and Pulse for Orca, at boot: `engine_list_engines` names the boards, the cockpit's
  landing lists them, and its `board` view shows one across the engines it names, its numbers built
  by the format's builder in the app-only `engine_board_data` (a failure in its place, never 0, kept
  30 s per caller) and its tiles drawn by
  [`@miragon/pulse-blocks`](https://www.npmjs.com/package/@miragon/pulse-blocks), as in the editors.
- **Engines as profiles.** `ENGINES_FILE` or `ENGINES_JSON` hold a profile file of
  `@miragon/pulse-profile`, the format of the CLI and Pulse for VS Code; without one,
  `ENGINE_BASE_URL` and its siblings yield the profile of a single engine. A profile's name is the
  engine id, a secret only the name of an `ENGINE_SECRET_*` variable, and `readOnly` blocks every
  write to that engine: no write offers it, and one registers only beside an engine that takes it. A
  profile the server cannot use is refused on its own: the boot warns, `engine_list_engines` lists
  it under `refused`, a call to it fails with `ENGINE_PROFILE_REFUSED`.
- **Several engines, several vendors.** Every tool takes an optional `engine`, else routes to
  `ENGINE_DEFAULT`, else to the file's `defaultProfile` (each must name a profile, else the boot
  fails), else the only profile, else `ENGINE_NOT_SELECTED` lists the engines the tool serves; a
  refused target is never rerouted. Each engine carries a `flavor` (`cibseven` | `operaton` | `camunda7`, default
  `camunda7`; `ENGINE_FLAVOR` for the `ENGINE_BASE_URL` shorthand) that picks its cockpit links and
  branding. A `camunda8` profile (a profile of the file, never the shorthand) signs in with none,
  Basic or `clientCredentials`, its client secret in the `ENGINE_SECRET_*` variable
  `auth.clientSecretEnv` names, never over plain http beyond loopback. Boards read it (the board
  feed, the diagram XML feed), `engine_list_engines` lists it with `dialect` `c8`, and no other
  tool, feed or cockpit view offers it: each names the dialects it serves, registers only where a
  configured engine serves it and refuses another engine, a default without `engine` above all,
  with `ENGINE_DIALECT_NOT_SERVED` before anything is sent. A server of Camunda 8 engines alone
  lists the engine list, the cockpit (its board and landing) and the board and XML feeds
  ([Camunda 8](https://miragon.github.io/pulse/mcp/camunda8): the profile, the client, the tests).
- **The engine contract.** It depends on `@miragon/pulse-engine-core`, the contract Pulse for VS
  Code and Pulse for Orca read engines through, and builds a runtime of it on each call, over the
  client that call resolves: c7-core's `C7Runtime` over the module's own client, which a board
  reads through. For Camunda 8 it brings c8-core's `C8Runtime`
  ([`@miragon/pulse-c8-core`](https://www.npmjs.com/package/@miragon/pulse-c8-core)) over a wire
  of its own on `@miragon/pulse-http`: read-only, signed in with none, Basic or the client
  credentials grant (a token request under the engine's deadline, at most 30 s), its failures in
  its own words, which name the profile's keys and never a secret's variable, the token endpoint's
  URL or the cluster's url: a redirect to either host says whose host it is, and a cluster's text
  reaches the model with both URLs masked.
- **Toolsets that fail closed.** `read-only`, `operations` and `admin`: without an `engine:<toolset>`
  suffix the module runs `read-only` on an unauthenticated server and `operations` under OAuth, an
  empty or unknown suffix falls back to `read-only`, and widget action buttons render only for
  tools the toolset registers.

`admin` is never implied. It holds delete, modify, suspension, migrations and batch retries,
`engine_throw_signal`, the external-task worker protocol (`engine_fetch_and_lock`,
`engine_complete_external_task`, `engine_handle_external_task_failure`) and the reads that only
feed them (`engine_create_migration_plan`, `engine_get_batch`, `engine_get_activity_instance_tree`);
`engine_list_external_tasks` stays below it. `engine_create_deployment` registers only with
`ENGINE_ALLOW_DEPLOYMENTS=true` on top of `engine:admin`, since deploying BPMN or DMN is code
execution inside the engine JVM. The [toolsets reference](https://miragon.github.io/pulse/mcp/reference#toolsets)
lists every tool.

## Help and feedback

- **Documentation:** every tool, setting and deployment option is explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

Where the parts live and how to add a tool or a cockpit route is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH
