# Developing @miragon/pulse-c7-core

The core of the Camunda 7 REST dialect family c7 inside the [Pulse](../../../../README.md)
monorepo: the workflow domain, the pure engine REST rules and the one OpenAPI spec of the
Camunda 7 REST API with its route table. Its one runtime dependency is the main entry of
[`@miragon/pulse-engine-core`](../../engine/engine-core), the engine family's core, whose
`RootCauses` it applies; it imports nothing else but its own modules. Setup and the repository's
bar: [CONTRIBUTING.md](../../../../CONTRIBUTING.md).

## The spec and the route table

`spec/api.json` is the one OpenAPI spec of the Camunda 7 REST API in Pulse, Operaton's (from
operaton-mcp's `operaton-rest-api.json`), vendored as it is. `spec/patches.json` corrects it with
RFC 6902 patches, each with a `test` guard and a `reason`: bodies and parameters the engines read
otherwise, and a task's form reference under both names. This package's `generate` (turbo runs it
before every build; `packages/connectors/c7/c7-core/scripts/generate-routes.ts`) applies them
(`packages/connectors/c7/c7-core/scripts/patches.ts`) and writes the patched spec (under
`spec/patched/`, ignored by git) and, from it, `src/generated/routes.json` and
`src/generated/core-routes.json`, with the effect rule in
`packages/connectors/c7/c7-core/scripts/effects.ts`.

Two more readers take the patched spec: [`@miragon/pulse-c7-client`](../c7-client/CONTRIBUTING.md)'s
`generate` (hey-api) writes its SDK from it, and the CLI's `catalog` its commands, each effect
taken from the route table.

To refresh, replace the spec or change a patch and regenerate:

```bash
pnpm generate                                                 # the route tables here, then c7-client's SDK
pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog   # the CLI's command catalogs
git diff                                                      # review, then run the repository's bar
```

Commit the spec, the route tables, the SDK and the catalogs together: all of them are checked in.

## Mutation testing

The package is mutation-tested every night (StrykerJS over its `src` without the tests,
`index.ts` and `testing/`, and the generator's rules under `scripts/`), never on a pull request.
Locally: `pnpm --fail-if-no-match --filter @miragon/pulse-c7-core exec stryker run`
(`--mutate <file>` narrows it), with `vitest.stryker.config.ts`: coverage off, since a threshold
failure would read as a killed mutant.
