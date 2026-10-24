# 1. Engines as adapters, the API as its own folder

## Context

Operaton, CIB seven and Camunda 7 speak the same REST API today. Nothing guarantees that this
stays so: the forks release on their own schedules and have started to rename things
(`operatonFormRef`, `camundaFormRef`). operate drives its commands from a catalog generated from one
OpenAPI spec, and its workflow commands call that catalog directly. A difference in one engine
would have had to be handled with checks of the engine name across the code base.

## Decision

**Three questions, three folders.**

- `src/engine-port`: what operate needs from an engine. `EnginePort` (call, find, list, text,
  preview, route) and `EngineAdapter` (name, catalog, port). Types only.
- `src/engines/<name>/adapter.ts`: who speaks to the engine. One adapter per engine.
- `src/api/<api>`: which language. `camunda7-rest` builds the catalog and the port for every
  engine that speaks the Camunda 7 REST API.

**Today every adapter passes through.** `cibseven` is `createCamunda7RestClient('cibseven', …)`. A
divergence is either a patch in `spec/engines/<name>.patches.json`, which changes only that engine's
catalog, or a wrapper around the port in its adapter.

**The engine is chosen before anything is registered.** `platform` (profile, `OPERATE_PLATFORM`,
`--platform`, default `camunda7`) selects the adapter in `run.ts`; commands, help and `describe` then
come from its catalog.

**The rules are checked.** dependency-cruiser fails the build when `workflow` imports an adapter or
an API, when anything but an adapter imports an API, when adapters or APIs import each other, when
`engine-port` imports more than types, or when an adapter reads another engine's catalog.

The overview is in [Architecture](../architecture.md), the engine list in [Engines](../engines.md).

## Consequences

- A difference of one engine changes one patch file or one adapter. The other engines do not move.
- The workflow commands are written once, against the port.
- Three generated catalogs are committed. They are identical while the engine patches are empty,
  and a test keeps them so. They make the package and the standalone executable about three times
  as large in catalog data.
- Existing profiles keep working: without `platform` operate behaves as before. Older versions of
  operate reject a config file that contains `platform`.
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
