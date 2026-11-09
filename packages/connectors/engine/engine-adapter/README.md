# Engine adapter

The Camunda 7 REST API family's adapter of Pulse's runtime view (`packages/core/runtime-view`):
Operaton, CIB seven and Camunda 7 behind the runtime view's contract. Its REST client
(`src/engine-rest`) runs engine-core's workflow domain (`@miragon/pulse-engine-core`) over the
engine, its mapping (`src/mapping`, `src/writing`) turns the answers into the contract's read
models and commands. Private: the editor hosts (`apps/vscode`, `apps/orca`) bundle it through
their composition roots.

The conformance kit of the contract proves it on a real engine (`test/c7-conformance.engine.test.ts`,
`test:engines`, in Testcontainers; the CI's `Engines (<flavor>)` legs). Its closed-world
dependency rules are `.dependency-cruiser.cjs` (`pnpm lint:architecture:engine-adapter`); the
decisions behind it are `apps/vscode/docs/adr/c7-adapter.md`.

```sh
pnpm --filter @miragon/pulse-engine-adapter test               # against a recorded REST API, coverage floors
pnpm --filter @miragon/pulse-engine-adapter run test:engines   # on a real engine; needs podman/docker
```
