# Camunda 8 adapter

- Status: accepted
- Last reviewed: 2026-11-15 (the wire on `@miragon/pulse-http` and its OAuth client, the REST
  client with checked views, the wording of its failures, the version floor and the reads onto
  the contract's read models; the runtime that answers the contract, the plug `C8Adapter` with
  its links into Operate and one token source per cluster and client; the package
  `@miragon/pulse-c8-adapter` in the c8 family, which no host composes in this step)

## Context

Issue #531 asks for read-only Camunda 8 support on SaaS and Self-Managed, which Thomas Heinrichs
built in #543 inside the extension. Camunda 8 is another engine with another API, the
Orchestration Cluster REST API (`/v2`), so it gets an adapter of its own, a dialect family `c8`
next to the c7 family's ([c7-adapter.md](c7-adapter.md)), behind the same engine contract
([runtime-contract.md](runtime-contract.md)). The two adapters share no code: what they share
lives in `@miragon/pulse-engine-core` (the contract), the runtime view (the ports) and
`@miragon/pulse-http` (the wire).

#543 came with its own HTTP seam (`camunda-http.ts`, a capped reader) and its own client
credentials grant (`auth/`, 424 lines). Since then the transport took both on: the deadline to
the last byte, no redirect, the 64 MiB cap, one retry after a 401 and the masking are
`@miragon/pulse-http`'s, and the client credentials grant with its single flight, early renewal,
holds and `Retry-After` is `clientCredentialsTokens` of `@miragon/pulse-http/oauth`. The adapter
re-lands on both and keeps what is its own: the cluster's REST calls, its views, its failures'
words, the version floor and the reads.

The reads rest on the answers of #543's spike on real engines, 8.9.27 and 8.10.8, each on H2 and
on Elasticsearch, each without security, with basic authentication and with OIDC:

| Question                                                                      | Answer                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Are `active` and `incidents` of the element statistics disjoint?              | Yes                                                                                                                     |
| Does a child's incident flag the parent, and does the call activity count it? | Yes: `hasIncident` on the parent, the call activity reads `active 0, incidents 1`, without an `incidentKey`             |
| Does an embedded sub-process count the incident of an element inside it?      | Yes, like a call activity: `active 0, incidents 1` on the sub-process, `hasIncident` without an `incidentKey`           |
| Do `variables` filters match element-scope variables?                         | Yes, on both storages                                                                                                   |
| What does `$gt` on a variable value do?                                       | It answers 400 ("cannot be parsed"), and so does `$lt`                                                                  |
| What does a client without read permission get?                               | `topology` 200, searches 200 with empty lists, single GETs 403                                                          |
| Do statistics list idle processes?                                            | No. They work on H2. `isLatestVersion` sorts only by process id and tenant                                              |
| Does the element search return a `PROCESS` row? Does a 1,000-key `$in` work?  | No row. Yes. A non-numeric key is a 400. Start times tie within a millisecond, so sort by key                           |
| Where does a count stop?                                                      | `totalItems` stops at 10,000 with `hasMoreTotalItems: true` on Elasticsearch; statistics stay exact                     |
| What do two tenants with the same process look like?                          | Statistics and searches span every tenant the login may read. Each tenant has its own versions, so `v1` can exist twice |
| Does a definition's XML arrive with its instances?                            | Not always: on Elasticsearch an instance's elements can be readable before its definition's XML is                      |

## Decision

`packages/connectors/c8/c8-adapter` (`@miragon/pulse-c8-adapter`, private, bundled by the editor
hosts) is the c8 family's adapter of the runtime view. It holds the wire, the REST client, the
wording of failures, the version floor, the readers with their mappings onto the contract's read
models, the runtime that answers the contract with them and the plug of the ports: `C8Adapter`,
the package's one export, holds one `CamundaClients`, which builds a client per connection and
holds the one `ClientCredentialsSources` of the adapter. A composition root builds the adapter
once per process; no host composes it in this step.

- **No client library, no CLI.** `@camunda8/orchestration-cluster-api` brings 1.5 MB of
  JavaScript and zod, which the closed world forbids, reads its settings from the environment,
  which breaks "the engine shown is the engine queried", and retries on its own. `c8ctl` would mean
  a process per call. The REST client and its views are written by hand: no client is generated
  from the cluster's spec, which is under the Camunda License 1.0.
- **The wire (`src/wire`).** `CamundaWire` builds one `Http` of the transport per connection: the
  connection's URL, 60 s to the last byte, 64 MiB and a read-only connection, which refuses a
  request its caller does not mark as a read before sending it. The REST client marks each of its
  requests, each `POST …/search` included, as a read. The credential is the transport's: none,
  Basic as UTF-8, or a bearer credential over the token source of the connection's client
  credentials. A URL or credentials the transport cannot use (a user name with a colon) fail each
  call as `misconfigured`, sending nothing. The wire turns every failure into an adapter-local
  reason, data that names no type of the transport: `HttpFailure` by its reason (`HttpReasons`, the
  hints to the host name, the certificate, the network path and the REST root after a redirect),
  an error answer by its status, the problem's text cut to one line and its `title`
  (`AnswerReasons`), and `TokenFailure` by its kind, status, code and hold (`TokenReasons`, the
  endpoint without its query). A `POST` search reads JSON losslessly (`WireJson`): an integer
  beyond 2^53 keeps its digits, so a view refuses it as no number instead of rounding it.
- **Token sources (`ClientCredentialsSources`).** The idea of #543's `TokenSources`, on the
  transport: one source per cluster and client (the connection's URL, the token endpoint and the
  client ID), in memory. The editor hosts build their connections anew on every reload, so a
  connection built anew with the same secret, audience and scopes (in any order) takes the source
  that is there and keeps its token and its hold: a wrong secret costs one token request a minute,
  not one per read. A changed secret, audience or scopes replaces the source of that cluster's
  client and asks at once, so a corrected secret leaves no source behind that keeps the old one in
  memory, and two clusters that share a client keep a token each. The client authenticates with
  `client_secret_post`, as the Camunda login services expect, and the form names an audience and
  scopes only when the connection does.
- **The REST client (`src/rest`).** `RestCamundaClient` has one method per call of `/v2` the reads
  need; `CamundaViews` turns each answer into a checked view, field by field, so an answer of
  another shape fails as `unexpectedResponse`. A search pages by its cursor up to 10,000 rows, a
  statistics read by offset up to 10,000 rows, and a search over keys asks for at most 1,000 at a
  time. An instance's rows say when they cut (its detail's `truncated`); the definitions, their
  versions and their statistics stop at 10,000 rows without saying so, since the contract's lists
  of them carry no cut and no cluster the spike saw comes near. A lookup by key reads a 404 with
  the title `NOT_FOUND` as none (an 8.10 endpoint on 8.9 answers `Not Found`, which fails), and a
  key the transport refuses before sending (`.`, `..`) as none too. `CamundaRequestError` is
  built from the wire's reasons; only the wire imports the transport.
- **Failures (`src/errors`).** `ErrorTranslation` maps a request error onto the contract's
  failures: 401 `unauthorized`, 403 `forbidden`, a redirect and a 404 `misconfigured`, any other
  status `engineFailure`, no answer `unreachable`. A 404 that names no missing resource gets the
  hint that the profile's url must be the cluster's REST root and end in `/v2`, and a 403 that names
  missing secondary storage says that the cluster has nothing to read. `TokenTexts` words a token
  failure with its way out (031dc1f4 of #543): a refused client by its code, a refused audience or
  scope with the profile's settings to check, a 403 with what the client may get a token for, a
  redirect or another status with the `tokenEndpoint` to check, and a token answer above the cap
  with the cap the transport's OAuth client applied, which the wire takes from that failure alone
  (`packages/connectors/c8/c8-adapter/test/wire/token-reasons.test.ts`: a timeout's deadline is no
  cap); it never shows the secret, the description or the body.
- **Version floor (`src/reading/version-floor.ts`).** The cluster's `gatewayVersion` is read once
  per client; below 8.9 a read fails as `misconfigured` with the version it found. 8.8 has no
  `businessId` and no statistics endpoints. A version that does not parse is left to the cluster,
  and a failed read is tried again.
- **The reads (`src/reading`, `src/mapping`).** One reader per question of the contract, each a
  class over the REST client, and the mappings from the checked views onto engine-core's read
  models (#543, with bba04dea and 557a4ce7). What the laws forced:
  - A key is a decimal Java long: an optional minus and 1 to 19 digits within its range, since the
    cluster answers 400 beyond it. Anything else is unknown and costs no call (`Keys`), which "Go
    to instance" and the id laws rely on.
  - The definitions are the newest latest version of each process across tenants, a deleted one
    left out, an idle one with zero counts, and the statistics' counts summed over tenants; the
    versions come newest first with their row of the statistics by version.
  - Running is `endDate: { $exists: false }`, the order `startDate` descending, then
    `processInstanceKey`. A page cursor carries the rows seen and the cluster's cursor, and a
    search goes on past a capped total. A count comes from the search; a capped one falls back to
    the exact statistics for a plain running count of the engine, a process or a version, and is
    `{ count: 10000, atLeast: true }` otherwise.
  - A variable's `equals` is `$eq`, its `notEquals` `$notIn` with one value: on H2 `$neq` with a
    numeric value skips text values. `like` goes out as `$like` with the JSON quotes around the
    pattern and `?` and `\` escaped. Greater than, less than and a date fail as `unsupported`
    before anything is sent.
  - An incident names its version from one read per definition (`DefinitionRefsCache`, which
    reads a missing or failed one again), and a row whose definition is gone is left out. Its
    details are its error message with the root cause by engine-core's `RootCauses`, the rule
    every dialect shares, instead of #543's copy of it.
  - A container's own incidents (a call activity, an embedded or event sub-process, an ad-hoc
    sub-process, a transaction) come from one `incidents` search per such element with an
    incident. The rest of its count belongs to the elements inside it and counts as active; on a
    call activity it is also `incidentsInCalledInstances`. When that search stops counting (above
    10,000 on Elasticsearch), the row keeps the cluster's counts. engine-core gains no field for
    it.
  - `calledFromElementId` comes from `parentElementInstanceKey`, a called process from
    `zeebe:calledElement` by its binding (latest, or its version tag; a deployment binding names
    no definition, and a call whose process a FEEL expression decides is left out). `BpmnText`
    reads the diagram as text, as the C7 family's reader does, but like an XML parser where it
    matters: self-closing elements, both quote styles, entities, and comments and CDATA removed
    until none is left, so a comment that a removal puts together hides nothing (557a4ce7). A
    diagram is read once and a missing one is none.
  - An instance is read first, because an ended read stops live updates. Its details follow,
    over the whole called tree with at most 50 instances, eight members at a time, and
    `truncated` says when it holds only part of it. The wait states come from the active elements
    and their open jobs of any kind, so a long history can't push them out. A listener job of the
    process itself is a wait at the BPMN process id, a container waits only on an open job or an
    incident of its own, and a message subscription belongs to an element by key and element id,
    so a boundary event's message is not its host's wait (bba04dea). The path keeps the newest
    10,000 runs, and a cut sets `truncated`; a local variable of a run past the cut keeps its
    element through one `GET /element-instances/{key}`, looked up once per reader.
- **The runtime (`C8ProcessRuntime`).** It answers each question of `ProcessRuntime` with its
  reader, after the version floor, and turns every failure into a `RuntimeError` through
  `ErrorTranslation`. `describeEngine` names the product `Camunda 8` and the cluster's
  `gatewayVersion`. A count is a lower bound (`atLeast`) where the cluster stops counting and no
  statistics give the exact number. `refusedVariableConditions()` names `ordering` and `date`,
  which fail as `unsupported` before anything is sent. An incident's details are its whole error
  message with its root cause, none for a key that cannot exist or a missing incident. The runtime
  is read-only by absence (#543): `proposeMigration` and `checkMigration` do not exist, so the
  runtime view offers no migration, `getBulkOperation` answers `undefined` and `getBulkFailures`
  none, since no bulk operation starts.
- **The plug (`C8Adapter`).** `runtime(connection)` builds a `C8ProcessRuntime` over a client of
  its `CamundaClients`, so every runtime of the adapter shares its token sources. `commands` and
  `cli` answer `undefined`: the adapter writes nothing, and the `pulse` CLI reads no Camunda 8
  cluster. `webUi(webUiUrl)` gives `OperateWebUi`, the links into Operate, for a URL whose path
  ends in `/operate`: the overview its root, an instance `processes/<key>`, a version the process
  list filtered to that process and version, with the running instances and those with an
  incident. Any other URL gets no web UI, the cluster's root included.
- **Closed world.** `packages/connectors/c8/c8-adapter/.dependency-cruiser.cjs`
  (`pnpm lint:architecture:c8-adapter`): its own modules, engine-core's main entry, the runtime
  view's ports, and in `src/wire` alone the transport's main entry and `./oauth`
  (`http-only-in-the-wire`, `http-by-its-entries`); no Node built-in, no c7 package (the
  repository's `adapters-own-their-family`). The house rules of the editor trees hold here too,
  keyed on the role of the package (`packages/connectors/*/*-adapter` in `eslint.config.mjs`).
- **The C7 wire refuses client credentials.** `EngineCredentials` of the runtime view's ports gains
  `clientCredentials` (token endpoint, client ID, secret, audience, scopes). The C7 adapter's wire
  (`engine-wire.ts`) handles every kind by name and refuses this one as `misconfigured` before
  anything is sent; a credential of another kind no longer falls to none.

## Consequences

- The wire passes the transport's `TRANSPORT_CASES` it can express on their loopback engine
  (`packages/connectors/c8/c8-adapter/test/wire/transport-cases.test.ts`: Basic and a read-only
  connection, the deadline turned from the adapter's 60 s into the case's); it leaves out every
  write, since the adapter sends none, a fixed token and passthrough, since its tokens come from a
  token endpoint, a caller's abort and its fixed cap.
  `packages/connectors/c8/c8-adapter/test/wire/camunda-wire.test.ts` holds the read-only
  connection: a request marked as a write is refused, and nothing is sent.
- `packages/connectors/c8/c8-adapter/test/wire/client-credentials.test.ts` holds the token reuse:
  a connection built anew sends no second token request and keeps a refusal's hold, another secret
  asks at once. `packages/connectors/c8/c8-adapter/test/c8-adapter-tokens.test.ts` holds it for
  the runtimes of one adapter: a reload keeps the token and the hold, a corrected secret, audience
  or scopes replaces the source of that cluster's client, and two clusters keep a token each.
- `packages/connectors/c8/c8-adapter/test/c8-runtime.test.ts` holds the runtime to the contract on
  the fake REST API (the floor before every question, the failures, the refused conditions, what
  it does not answer, one question per reader), and
  `packages/connectors/c8/c8-adapter/test/c8-web-ui.test.ts` the links into Operate.
- The reads are proven on the fake REST API: each reader in
  `packages/connectors/c8/c8-adapter/test/reading`, the instance detail by topic in
  `packages/connectors/c8/c8-adapter/test/reading/instance-detail`, the mappings in
  `packages/connectors/c8/c8-adapter/test/mapping`.
- A container with more than 10,000 incidents of its own on Elasticsearch keeps the cluster's
  unsplit counts, so its row can count incidents inside it as its own. The conformance world never
  reaches that many.
- The adapter is proven on a fake REST API in this step; the conformance kit on a local cluster
  and the error-path goldens follow in their own commits. CI runs no Camunda 8 image until the
  licence question of #531 has an answer: the images fall under Camunda's Self-Managed
  non-production terms.
- Two profiles that name the same client of the same cluster with different secrets, audiences or
  scopes replace each other's token source, so each of their reads asks for a token.

## Decision log

- 2026-11-05: read-only first, on the floor 8.9 (#543, Thomas Heinrichs).
- 2026-11-15: the wire on `@miragon/pulse-http` and its OAuth client instead of #543's own HTTP
  seam and grant; the adapter is a package of the c8 family (#617).
- 2026-11-15: the reads of #543 as readers over the REST client, the root cause by engine-core's
  `RootCauses`; a capped search for a container's own incidents keeps the cluster's counts, with
  no new field in engine-core (#617).
- 2026-11-15: the runtime answers the contract read-only and `C8Adapter` is the package's plug,
  with links into Operate; a token source per cluster and client, which a changed secret, audience
  or scopes replaces (#617).
