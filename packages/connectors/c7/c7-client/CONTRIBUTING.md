# Developing @miragon/pulse-c7-client

The TypeScript client for the Camunda 7 REST API (CIB seven, Operaton, Camunda 7) inside the
[Pulse](../../../../README.md) monorepo, the SDK of the dialect family c7: an SDK generated with
[`@hey-api/openapi-ts`](https://heyapi.dev/), a client factory over the `fetch` it is handed, and
the reads whose REST contract the SDK defaults miss. It is a leaf: it has no runtime dependency
and does not import [`@miragon/pulse-c7-core`](../c7-core). Setup and the repository's bar:
[CONTRIBUTING.md](../../../../CONTRIBUTING.md).

## Client behavior, internally

SDK functions return the response payload directly (`responseStyle: "data"`)
and reject on HTTP error responses (`throwOnError: true`). Both options are
declared once in the generator config (`openapi-ts.config.ts`) and applied at
runtime through `createClientConfig` (`src/hey-api.ts`), which the generated
default client and `createEngineClient` share, so generated types and runtime
behavior always agree. The wire (credentials, deadline, redirects, size cap, failures) is the
`fetch`'s: the Pulse MCP server hands it the `asFetch` of
[`@miragon/pulse-http`](../../../core/http/README.md).

The SDK-bound reads live in `src/sdk-reads/`. The variable reads restate
c7-core's `RAW_VARIABLES`, and the engine connector holds the copy equal
(its `src/sdk-reads.test.ts`). The MCP tools' input schemas live in
`@miragon/pulse-engine-connector` next to its tools, so this package carries no zod.

## OpenAPI spec: origin & refresh

The SDK is generated from the one Camunda 7 REST spec of the c7 family,
`packages/connectors/c7/c7-core/spec/api.json` (Operaton's REST API, the same operations
CIB seven and Camunda 7 serve), with the RFC 6902 patches of
`packages/connectors/c7/c7-core/spec/patches.json` applied: c7-core's `generate` writes that
patched spec, which c7-core's route table and the CLI's catalog read too, and this package's
`generate` (turbo runs it after c7-core's, before every build) reads it as a file. A task's form
reference is named both ways: `TaskDto` and `FormDto` carry `camundaFormRef` (CIB seven,
Camunda 7) and `operatonFormRef` (Operaton), both of type `OperatonFormRef`. Where the spec comes
from and how its patches work: [c7-core's CONTRIBUTING.md](../c7-core/CONTRIBUTING.md).

To refresh, replace the spec in c7-core and regenerate:

```bash
pnpm generate                 # c7-core's patched spec and route tables, then the SDK here
git diff                      # review spec + SDK changes, run the repo verification suite
```

Commit the spec and the regenerated output together: `src/generated/` is
checked in, and CI's TypeScript job fails when the build rewrites it.

If generated SDK files look wrong (e.g. `client.gen.ts` importing `./src/hey-api.js` instead of
`../hey-api.js`), the shared turbo cache replayed a poisoned `generate` output; the root
[`CLAUDE.md`](../../../../CLAUDE.md) names the fix.
