# 1. Engines as adapters, the API as its own folder

## Context

Operaton, CIB seven and Camunda 7 speak the same REST API today. Nothing guarantees that this stays
so: the forks release on their own schedules and have started to rename things (`operatonFormRef`,
`camundaFormRef`). pulse-cli drives its commands from a catalog generated from one OpenAPI spec, and
its workflow commands call that catalog directly. A difference in one engine would have had to be
handled with checks of the engine name across the code base.

## Decision

**Three questions, three folders.**

- `src/engine-port`: what pulse-cli needs from an engine. `EnginePort` (call, find, list, text,
  preview, route) and `EngineAdapter` (name, catalog, port). Types only.
- `src/engines/<name>/adapter.ts`: who speaks to the engine. One adapter per engine.
- `src/api/<api>`: which language. `camunda7-rest` builds the catalog and the port for every
  engine that speaks the Camunda 7 REST API.

**Today every adapter passes through.** `cibseven` is `createCamunda7RestClient('cibseven', …)`. A
divergence is either a catalog of its own for that engine, generated with an extra spec patch, or a
wrapper around the port in its adapter.

**The engine is chosen before anything is registered.** `flavor` (profile, `PULSE_CLI_FLAVOR`,
`--flavor`, default `camunda7`; called `platform` before the move to Pulse) selects the adapter in
`run.ts`; commands, help and `describe`
then come from its catalog.

**The rules are checked.** dependency-cruiser fails the build when `workflow` imports an adapter or
an API, when anything but an adapter imports an API, when adapters or APIs import each other, or when
`engine-port` imports more than types.

The overview is in [Architecture](../architecture.md), the engine list in [Engines](../engines.md).

## Consequences

- A difference of one engine changes its catalog or its adapter. The other engines do not move.
- The workflow commands are written once, against the port.
- One generated catalog is committed and every adapter reads it while no engine diverges.
- Existing profiles keep working: without `flavor` pulse-cli behaves as before. Versions without the
  key reject a config file that contains it.
- `src/catalog`, `src/operation` and `src/http` still hold the Camunda 7 REST code. They move into
  `src/api/camunda7-rest` step by step, not in one move.
- No rule forbids `if (name === 'cibseven')` outside `src/engines/<name>`. Review does.

## Rejected alternatives

- **One adapter for all three engines.** Simple today, but the first divergence brings checks of
  the engine name back into shared code.
- **Three copied implementations.** Each engine would get the full client. Every fix would have to
  be made three times while the engines are still the same.
- **Detecting the engine from `GET /version`.** It costs a request before every command and fails
  without a reachable engine, yet help and `describe` must work offline. It may come later as a
  hint in `ping`.
- **Domain ports such as `ProcessInstances` or `Tasks` up front.** They only pay off with a second
  API and would be guesses until then.
