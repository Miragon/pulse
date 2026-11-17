# C8 adapter

The C8 adapter of Pulse's runtime view (`packages/core/runtime-view`): Camunda 8 from 8.9 on,
SaaS and Self-Managed, read through the Orchestration Cluster REST API (`/v2`), behind the engine
contract of `@miragon/pulse-engine-core`. It reads and never writes. Private: the editor hosts
(`apps/vscode`, `apps/orca`) bundle it through their composition roots. It is the adapter of the
c8 family (`adapters-own-their-family` in the repository's `.dependency-cruiser.cjs`) and shares
no code with the C7 adapter: what both need lives in engine-core, the runtime view's ports and the
transport. The reads themselves are its family's core, `@miragon/pulse-c8-core`
(`packages/connectors/c8/c8-core`): the runtime with the kind of each failure, the REST client
with its checked views, the readers and the mappings, over a transport port this adapter's wire
implements. The adapter is a plug: its wire, its words and its BPMN dialect.

Its one export is `C8Adapter`, the plug of the runtime view's ports: `runtime(connection)` gives
c8-core's `C8Runtime` over the connection's transport and the adapter's words, which answers the
engine contract read-only (no writes, no migration planning, ordering and date conditions
refused, counts that may be a lower bound), `webUi(url)` the links
into Operate, `bpmn` the vocabulary of Camunda 8's BPMN files (`C8BpmnDialect`, over
`zeebe-bpmn-moddle`) for the runtime view's model reader, and `commands` and `cli` nothing. It
holds the wire (`src/wire`: `CamundaWire` over `@miragon/pulse-http`, 60 s and 64 MiB on a
read-only connection, none, Basic or a bearer token from `clientCredentialsTokens` of
`@miragon/pulse-http/oauth`, one token source per cluster and client kept by
`ClientCredentialsSources`), the transport c8-core's REST client sends through (`src/rest`:
`CamundaHttp`, which implements c8-core's `CamundaTransport` and copies the fields of each
failure, and `CamundaRequestError`, the wire's error with its words) and the words of failures
whose kind c8-core decides (`src/errors`: `ErrorTranslation.wordsOf`, the runtime's `wordsOf`, and
`TokenTexts`). `CamundaTransports` builds the transport of a connection over the adapter's one set
of token sources, so a composition root builds the adapter once per process. Thomas Heinrichs
built the adapter in #543; this package re-lands it on the shared transport.

The conformance kit of the contract (`@miragon/pulse-engine-core/testing`) proves it on a local
Camunda 8 cluster in Testcontainers (`test/c8-conformance.engine.test.ts`, `test:engines`): the
read laws on the kit's world, deployed as the Zeebe diagrams of `test/world`, the wait states an
instance names and what each login reads. `test/support/cluster-settings.json` holds the stack:
`camunda/camunda` 8.9 and 8.10, H2 or Elasticsearch as secondary storage, no security, Basic or
OIDC with Keycloak (`test/support/keycloak-realm.json`). The suite skips unless
`PULSE_ENGINE_IMAGE` names `camunda/camunda`, and no CI job runs it: Camunda's images fall under
its Self-Managed non-production terms, and CI starts none until the licence question of #531 has
an answer. `pnpm test` still holds the suite in place (`test/architecture/engine-config.test.ts`):
at least one engine test, and an engines config that runs every one and switches none off.
`c8:up` starts the same stack by hand on fixed ports, seeds a small world and prints the engine as
a profile of `.pulse.json` with its login; `c8:down` removes it.

Its wire passes the transport's conformance cases it can express
(`test/wire/transport-cases.test.ts`), and its error-path goldens (`test/goldens/`) pin what it
reports for the failures the MCP server, the CLI and the C7 adapter pin, made with a Camunda 8
cluster's answers, and for those of Camunda 8 alone: a token endpoint's refusal and hold, the
renewal of a refused token, the version floor, the `/v2` hint and a cluster without secondary
storage (`test/__golden__/error-paths/README.md`; an intended change runs `golden:update`, never a
hand edit). Its closed-world dependency rules are
`.dependency-cruiser.cjs` (`pnpm lint:architecture:c8-adapter`; only the wire imports the
transport, by its main entry and `./oauth`); the decisions behind it are
`apps/vscode/docs/adr/c8-adapter.md`.

```sh
pnpm --filter @miragon/pulse-c8-adapter test   # the wire against a fake REST API and the transport's loopback engine, the goldens, coverage floors
pnpm --fail-if-no-match --filter @miragon/pulse-c8-adapter golden:update   # rewrite the error-path goldens (refused in CI)
pnpm exec turbo run build --filter=@miragon/pulse-c8-adapter...   # once, before the engine suite
PULSE_ENGINE_IMAGE=camunda/camunda:8.9.28 PULSE_C8_STORAGE=h2 PULSE_C8_SECURITY=oidc \
  pnpm --filter @miragon/pulse-c8-adapter run test:engines   # one leg; needs podman/docker
pnpm --filter @miragon/pulse-c8-adapter run c8:up -- --security oidc --storage elasticsearch
pnpm --filter @miragon/pulse-c8-adapter run c8:down
```

`PULSE_C8_STORAGE` is `h2` (the default) or `elasticsearch`, `PULSE_C8_SECURITY` `none` (the
default), `basic` or `oidc`; `c8:up` takes the same as `--storage` and `--security` and starts
the newest image of `cluster-settings.json` unless `PULSE_ENGINE_IMAGE` names another. Run one
leg at a time: an Elasticsearch leg needs about 3 GB more memory than an H2 leg. The legs cover
Self-Managed on H2 and Elasticsearch: no OpenSearch, no other relational database and no SaaS
cluster. The last run of all twelve is in `docs/vscode/camunda8.md`, which tells users what is
tested: a change to the stack or the suite runs them again and updates that table.
