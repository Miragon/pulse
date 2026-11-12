# C7 adapter

The C7 adapter of Pulse's runtime view (`packages/core/runtime-view`): Operaton, CIB seven and
Camunda 7 behind the engine contract of `@miragon/pulse-engine-core`, the neutral core of the
engine family. Its REST client (`src/engine-rest`) runs the c7 dialect's workflow domain
(`@miragon/pulse-c7-core`) over the engine, its mapping (`src/mapping`, `src/writing`) turns the
answers into the contract's read models and commands, and `C7Adapter` is the plug of the runtime
view's ports (`@miragon/pulse-runtime-view/ports`), the web UI and the command of the CLI that
triggers an event (`src/cli`) included. Private: the editor hosts (`apps/vscode`,
`apps/orca`) bundle it through their composition roots. It is the adapter of the c7 family,
whose dialect it implements (`adapters-own-their-family` in the repository's
`.dependency-cruiser.cjs`). It takes these C7 REST rules from c7-core, never as a copy: the
inspection of an instance, which incident types the engine raises itself
(`BUILT_IN_INCIDENT_TYPES`), which job or external task an incident names, for its retry and in
the incident list (`incidentRecovery`), which request holds an incident's cause
(`CAUSE_OPERATIONS`), and how a written variable is typed (`autoTypedValue`, `toEngineVariable`).
It sends every request through `@miragon/pulse-http`, the transport the CLI and the MCP server
send through, from its wire alone (`src/engine-rest/http`: `EngineHttp`, 60 s and 64 MiB, over
the global `fetch` of its host's runtime), and its inspection goes out as routes of c7-core's
`CORE_ROUTES`.

The conformance kit of the contract (`@miragon/pulse-engine-core/testing`) proves it on a real
engine (`test/c7-conformance.engine.test.ts`, `test:engines`, in Testcontainers; the CI's
`Engines (<flavor>)` legs). Its error-path goldens (`test/__golden__/error-paths/`, the same cases
the CLI and the MCP server pin) change only through
`pnpm --fail-if-no-match --filter @miragon/pulse-c7-adapter golden:update`. Its wire passes the transport's
conformance cases it can express (`test/engine-rest/transport-cases.test.ts`). Its closed-world
dependency rules are `.dependency-cruiser.cjs` (`pnpm lint:architecture:c7-adapter`; only the
wire imports the transport, by its main entry); the decisions behind it are
`apps/vscode/docs/adr/c7-adapter.md`.

```sh
pnpm --filter @miragon/pulse-c7-adapter test               # against a recorded REST API, coverage floors
pnpm --filter @miragon/pulse-c7-adapter run test:engines   # on a real engine; needs podman/docker
```
