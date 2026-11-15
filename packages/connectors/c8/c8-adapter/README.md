# C8 adapter

The C8 adapter of Pulse's runtime view (`packages/core/runtime-view`): Camunda 8 from 8.9 on,
SaaS and Self-Managed, read through the Orchestration Cluster REST API (`/v2`), behind the engine
contract of `@miragon/pulse-engine-core`. It reads and never writes. Private: the editor hosts
(`apps/vscode`, `apps/orca`) bundle it through their composition roots. It is the adapter of the
c8 family (`adapters-own-their-family` in the repository's `.dependency-cruiser.cjs`) and shares
no code with the C7 adapter: what both need lives in engine-core, the runtime view's ports and the
transport.

Its one export is `C8Adapter`, the plug of the runtime view's ports: `runtime(connection)` gives a
`C8ProcessRuntime`, which answers the engine contract read-only (no writes, no migration planning,
ordering and date conditions refused, counts that may be a lower bound), `webUi(url)` the links
into Operate, and `commands` and `cli` nothing. It holds the wire (`src/wire`: `CamundaWire` over
`@miragon/pulse-http`, 60 s and 64 MiB on a read-only connection, none, Basic or a bearer token
from `clientCredentialsTokens` of `@miragon/pulse-http/oauth`, one token source per cluster and
client kept by `ClientCredentialsSources`), the REST client with its checked views (`src/rest`),
the wording of failures (`src/errors`), the readers and the version floor (`src/reading`) and the
mappings onto the read models of engine-core (`src/mapping`). `CamundaClients` builds a client per
connection over the adapter's one set of token sources, so a composition root builds the adapter
once per process. Thomas Heinrichs built the adapter in #543; this package re-lands it on the
shared transport.

Its wire passes the transport's conformance cases it can express
(`test/wire/transport-cases.test.ts`). Its closed-world dependency rules are
`.dependency-cruiser.cjs` (`pnpm lint:architecture:c8-adapter`; only the wire imports the
transport, by its main entry and `./oauth`); the decisions behind it are
`apps/vscode/docs/adr/c8-adapter.md`.

```sh
pnpm --filter @miragon/pulse-c8-adapter test   # against a fake REST API and the transport's loopback engine, coverage floors
```
