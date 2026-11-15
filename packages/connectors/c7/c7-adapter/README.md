# C7 adapter

The C7 adapter of Pulse's runtime view (`packages/core/runtime-view`): Operaton, CIB seven and
Camunda 7 behind the engine contract of `@miragon/pulse-engine-core`, the neutral core of the
engine family. Its REST client (`src/engine-rest`) is the port the c7 dialect's workflow domain
(`@miragon/pulse-c7-core`) runs on, c7-core's `C7Runtime` answers every read of the contract over
it, its writes (`src/writing`) turn the contract's commands into requests, and `C7Adapter`
is the plug of the runtime view's ports (`@miragon/pulse-runtime-view/ports`), the web UI and the
command of the CLI that triggers an event (`src/cli`), the vocabulary of Camunda 7's BPMN files
(`C7BpmnDialect`, over `camunda-bpmn-moddle`) and the local engine a host falls back to included.
Private: the editor hosts (`apps/vscode`, `apps/orca`) bundle it through their composition roots.
It is the adapter of the c7 family, whose dialect it implements (`adapters-own-their-family` in
the repository's `.dependency-cruiser.cjs`). It takes these C7 REST rules from c7-core, never as a
copy: the reads of the engine, its processes, a version's diagram, the counts on it, the
processes it calls, the instances and their count, a version's variable names, an instance's
detail (with the inspection of the instance), the open incidents and an incident's details, a
bulk operation and its failures and a migration's plan and check (`C7Runtime` of `./runtime`,
over its port), which incident types the engine raises itself
(`BUILT_IN_INCIDENT_TYPES`), which job or external task an incident names, for its retry and in
the incident list (`incidentRecovery`), which request holds an incident's cause
(`CAUSE_OPERATIONS`), how a written variable is typed (`autoTypedValue`, `toEngineVariable`), and
what "with incident" is (an open incident the runtime holds now, `instancesWithIncident`,
`countWithIncident`, `withIncidentAmong`), on every history level. It sends every request through
`@miragon/pulse-http`, the transport the CLI and the MCP server send through, from its wire alone
(`src/engine-rest/http`: `EngineHttp`, 60 s and 64 MiB, over the global `fetch` of its host's
runtime), and c7-core's reads go out as routes of c7-core's `CORE_ROUTES`.

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
