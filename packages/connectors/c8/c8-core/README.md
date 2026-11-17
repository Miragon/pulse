# @miragon/pulse-c8-core

The core of Pulse's Camunda 8 dialect family: the reads of a Camunda 8 cluster (8.9 and newer,
SaaS and Self-Managed) through the Orchestration Cluster REST API (`/v2`), mapped onto the read
models of `@miragon/pulse-engine-core`, the engine contract every dialect implements. It reads and
never writes. Private for now: the C8 adapter of the editor hosts
(`packages/connectors/c8/c8-adapter`) runs it, and the MCP server's engine module is its second
consumer to come. Below 1.0, pin the exact version and update all `@miragon/pulse-*` packages
together.

Thomas Heinrichs wrote these readers, the REST client and its query rules for Pulse for VS Code in
[#543 feat(vscode): read Camunda 8 on SaaS and Self-Managed](https://github.com/Miragon/pulse/pull/543);
they left the C8 adapter for this package so that every surface that reads Camunda 8 runs the same
reads.

## What it holds

- **The transport port (`src/port`).** `CamundaTransport` is what a surface hands the REST client:
  `get` and `post` resolve the JSON of an answer (read losslessly), `text` the text of one (a
  diagram's XML), and every request is a read. `failure(error)` reads a rejection of the transport
  as a `CamundaFailure`, fields only and no words: an error answer or a redirect
  (`answered`: its status, the problem's title and what it states, as the surface masked them),
  a request that got no answer or was never sent (`transport`: the reason and code of the
  transport's failure, a structural copy of `@miragon/pulse-http`'s `FailureReason`), or no token
  (`token`: the trouble, a structural copy of the OAuth client's `TokenFailureKind`, its status,
  code, problem, hold and cap; the token endpoint stays out). Each surface brings its own wire on
  `@miragon/pulse-http`, copies those fields and words its own failures; this package imports no
  transport.
- **The REST client (`src/rest`).** `RestCamundaClient` has one method per call of `/v2` the reads
  need, and `CamundaViews` checks each field of an answer, so an answer of another shape fails as
  an `UnexpectedAnswerError`. A search pages by its cursor up to 10,000 rows, a statistics read by
  offset up to 10,000 rows, and a search over keys asks for at most 1,000 at a time. A lookup by
  key reads a 404 with the title `NOT_FOUND` as none, and so a key the transport refuses as a path
  value before sending it (`.`, `..`, an empty segment); any other failure fails the read.
- **The readers (`src/reading`) and mappings (`src/mapping`).** One reader per question of the
  contract (definitions and versions, diagrams, element statistics, called processes, instances and
  their counts, an instance's detail and wait states, incidents, variable names) and the version
  floor (8.9), each a class over the REST client, and the mappings from the checked views onto
  engine-core's read models: keys that are Java longs, page cursors, the BPMN text a reader needs,
  and the root cause by engine-core's `RootCauses`.

## Rules

- A family core: its src imports its own modules and engine-core's main entry alone, no other
  workspace package, no npm package and no Node built-in (`family-core-is-a-leaf`,
  `engine-core-consumers` in the repository's `.dependency-cruiser.cjs`); it builds to `dist` with
  no DOM and no Node types.
- The house rules of Pulse for VS Code, as for engine-core: classes, no comments, complexity 10,
  300 lines per file (`eslint.config.mjs`).
- `test/` holds every reader, mapping and view to a fake of the transport port
  (`test/support/fake-transport.ts`, which answers by route, as a cluster would); the adapter's
  `test/rest/camunda-http.test.ts` holds its wire to the same port and the copied reasons and
  troubles equal to the transport's.

```sh
pnpm --filter @miragon/pulse-c8-core test   # the readers, the mappings and the views, coverage floors
pnpm --filter @miragon/pulse-c8-core build  # dist, which the C8 adapter's tests and bundles read
```
