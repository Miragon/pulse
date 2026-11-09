# Developing @miragon/pulse-engine-client

The TypeScript client for the [CIB seven](https://cibseven.org/) REST API inside the
[Pulse](../../../../README.md) monorepo: an SDK generated with
[`@hey-api/openapi-ts`](https://heyapi.dev/), a client factory with deadlines and engine errors,
and the reads whose REST contract the SDK defaults miss. It is a leaf: it has no runtime
dependency and does not import [`@miragon/pulse-engine-core`](../engine-core). Setup and the
repository's bar: [CONTRIBUTING.md](../../../../CONTRIBUTING.md).

## Client behavior, internally

SDK functions return the response payload directly (`responseStyle: "data"`)
and reject on HTTP error responses (`throwOnError: true`). Both options are
declared once in the generator config (`openapi-ts.config.ts`) and applied at
runtime through `createClientConfig` (`src/hey-api.ts`), which the generated
default client and `createEngineClient` share, so generated types and runtime
behavior always agree.

The SDK-bound reads live in `src/engine-contract/`. The variable reads restate
engine-core's `RAW_VARIABLES`, and the engine connector holds the copy equal
(its `src/engine-contract.test.ts`). The MCP tools' input schemas live in
`@miragon/pulse-engine-connector` next to its tools, so this package carries no zod.

## OpenAPI spec: origin & refresh

The spec is checked in as `cibseven-open-api-doc.json` (currently reporting
`info.version` **2.1.2**). It originates from the engine's published OpenAPI
artifact `org.cibseven.bpm:cibseven-engine-rest-openapi` (a jar containing
`openapi.json`); Maven Central publishes the minor releases (2.1.0, 2.2.0, …).
The running engine does not serve its spec over HTTP, so the artifact is the
canonical source.

To refresh:

```bash
pnpm spec:refresh <version>   # downloads + extracts the spec, e.g. pnpm spec:refresh 2.2.0
pnpm generate                 # regenerate src/generated from the new spec
git diff                      # review spec + SDK changes, run the repo verification suite
```

Commit the spec and the regenerated output together: `src/generated/` is
checked in and CI assumes it matches the spec.

If generated SDK files look wrong (e.g. `client.gen.ts` importing `./src/hey-api.js` instead of
`../hey-api.js`), the shared turbo cache replayed a poisoned `generate` output; the root
[`CLAUDE.md`](../../../../CLAUDE.md) names the fix.
