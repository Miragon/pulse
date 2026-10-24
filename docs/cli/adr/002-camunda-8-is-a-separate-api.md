# 2. Camunda 8 is a separate API

## Context

Users ask whether pulse-cli works with Camunda 8. Camunda 8 is not a fork of Camunda 7: it has its
own REST API (the Orchestration Cluster API), other resources (process instances by key, jobs
without external tasks, no history endpoints in the same form) and other authentication. The catalog
of pulse-cli is generated from the Camunda 7 REST API spec, and the workflow commands use its
operations by id.

## Decision

**Camunda 8 would be a new API, not a fourth engine.** It would get its own folder
`src/api/camunda8-rest` with its own spec, catalog and port, and an adapter `src/engines/camunda8`
on top of it. It would not be a patch file in `spec/engines/`.

**The port grows only when a second API exists.** Today `EnginePort` calls catalog operations by
their Camunda 7 operation id. A second API would need ports that describe tasks of the workflow
commands (find an instance, list its incidents) instead. They are written when the second API is,
not before.

**Until then pulse-cli does not support Camunda 8.** The docs say so ([Engines](../engines.md)).

## Consequences

- The Camunda 7 engines are not slowed down by abstractions for an API that is not there.
- Adding Camunda 8 is a larger step: a spec, a generator run, an adapter and new ports for the
  workflow commands.
- The folder layout and the dependency rules already have room for it: `api/<a>` may not import
  `api/<b>`, so the two APIs stay apart.

## Rejected alternatives

- **Camunda 8 as patches on the Camunda 7 spec.** The differences are not renamed fields but
  another resource model. The patches would replace most of the spec.
- **A generic engine port now.** Every operation of the workflow commands would need a neutral
  name and shape, designed without a second API to test it against.
