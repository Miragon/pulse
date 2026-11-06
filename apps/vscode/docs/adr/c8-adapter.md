# Camunda 8 adapter

- Status: accepted
- Last reviewed: 2026-11-05

## Context

Issue #531 asks for read-only Camunda 8 support on SaaS and Self-Managed. Camunda 8 is another
engine with another API, so it gets an adapter of its own, next to the C7 family's
([c7-adapter.md](c7-adapter.md)), behind the same contract ([runtime-contract.md](runtime-contract.md)).
Adapters import only the contract, so the two share no code.

Every claim below comes from real engines: 8.9.27 and 8.10.8, each on H2 and on Elasticsearch,
each without security, with basic authentication and with OIDC, twelve rows in all. The spike's
answers:

| Question                                                                                                | Answer                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Are `active` and `incidents` of the element statistics disjoint?                                        | Yes                                                                                                                     |
| Does a child's incident flag the parent, and does the call activity count it?                           | Yes: `hasIncident` on the parent, the call activity reads `active 0, incidents 1`, without an `incidentKey`             |
| Does an embedded sub-process count the incident of an element inside it? (8.10.8, H2, basic)            | Yes, like a call activity: `active 0, incidents 1` on the sub-process, `hasIncident` without an `incidentKey`           |
| Do `variables` filters match element-scope variables?                                                   | Yes, on both storages                                                                                                   |
| What does `$gt` on a variable value do?                                                                 | It answers 400 ("cannot be parsed"), and so does `$lt`                                                                  |
| What does a client without read permission get?                                                         | `topology` 200, searches 200 with empty lists, single GETs 403                                                          |
| Do statistics list idle processes?                                                                      | No. They work on H2. `isLatestVersion` sorts only by process id and tenant                                              |
| Does the element search return a `PROCESS` row? Does a 1,000-element `$in` work on the instance search? | No row. Yes. A non-numeric key is a 400. Start times tie within a millisecond, so sort by key                           |
| How long is the export lag?                                                                             | 50 to 110 ms on H2 with a flush of PT0S, about 3 s for a first load on Elasticsearch                                    |
| Where does a count stop?                                                                                | `totalItems` stops at 10,000 with `hasMoreTotalItems: true` on Elasticsearch; statistics stay exact                     |
| What differs between 8.9 and 8.10?                                                                      | Only `suspendedDate`. An 8.10 endpoint on 8.9 is a 404 with the title `Not Found`; a missing resource has `NOT_FOUND`   |
| What do two tenants with the same process look like? (8.10.8, H2, basic)                                | Statistics and searches span every tenant the login may read. Each tenant has its own versions, so `v1` can exist twice |
| Does a definition's XML arrive with its instances?                                                      | Not always: on Elasticsearch an instance's elements can be readable before its definition's XML is                      |

## Decision

**No client library, no CLI.** `@camunda8/orchestration-cluster-api` brings 1.5 MB of JavaScript
and zod, which the closed-world rules forbid, reads its settings from the environment, which breaks
"the engine shown is the engine queried", and retries on its own. `c8ctl` would mean a process per
call. Tests use it as an independent check, by `npx`, never as a dependency.

**The adapter brings what the host and the model adapter need to know.** `C8Adapter` names its
flavor and credential types, its setups for _Add Engine_ live in
`apps/vscode/src/adapters/c8/setup`, and `C8BpmnDialect` (`c8-bpmn-dialect.ts`) gives the model
adapter the zeebe descriptor, the job type of `zeebe:taskDefinition`, `zeebe:ioMapping` and the
marks of a job worker ([local-sources.md](local-sources.md)).

**One HTTP seam.** `rest/camunda-http.ts` follows `EngineHttp`'s rules: `redirect: manual`, a
60 s deadline, a 64 MiB cap. The cap lives in `rest/capped-text.ts`, which token requests share
with 1 MiB and a 30 s deadline. `rest/rest-camunda-client.ts` has one method per call, and
`rest/camunda-views.ts` turns each answer into a checked view, so another shape fails as
`unexpectedResponse`.

**Client credentials live in `auth/`.** `C8Adapter` holds a `TokenSources`, one source per client
and secret, because connections rebuild on every reload. A token is fetched in a single flight,
read with a 1 MiB cap, and refreshed at `obtainedAt + lifetime - min(60 s, lifetime / 10)`; a
lifetime that is not positive counts as the default. The answer decides the failure. A 401 is
rejected credentials whatever its code, because RFC 6749 gives it only to failed client
authentication (Auth0, the SaaS login, answers a wrong secret with `access_denied`). A 400 is
rejected credentials for `invalid_client` and `unauthorized_client` and a wrong audience or scopes
for any other code. A 403 means the client may not get a token for that audience and those scopes,
any other 4xx a wrong token endpoint, and a 5xx, 408 or 425 an unreachable login service. A token
outside the Bearer token syntax counts as unexpected and never reaches a header or a message, and
a message shows the token endpoint without its query. A refused request holds for 60 s, a 429 for its `Retry-After` (seconds or an
HTTP date) or 60 s, an unreachable login service for 5 s, and new credentials end a hold. Clock
steps back end a hold and a token too. After a 401 the API gets one retry with a fresh token, but a
token younger than 30 s stays and the read fails as `unauthorized`: a wrong audience would
otherwise cost a token request per read, and the SaaS login service blocks an IP that keeps
asking.

**Mappings the laws forced.**

- Running is `endDate: { $exists: false }`, the order is `startDate` descending, then
  `processInstanceKey`, because start times tie within a millisecond.
- A variable's `equals` is `$eq`, its `notEquals` is `$notIn` with one value: on H2 `$neq` with a
  numeric value skips text values.
- `like` goes out as `$like` with the JSON quotes around the pattern and `?` and `\` escaped.
- A key is a decimal Java long: an optional minus and 1 to 19 digits within its range; the cluster
  answers 400 beyond it. Anything else is unknown and costs no call, which "Go to instance" and the
  id laws rely on.
- A container's own incidents (a call activity, an embedded or event sub-process, an ad-hoc
  sub-process, a transaction) come from one `incidents` search per such element with an
  incident. The rest of its count belongs to the elements inside it and counts as active; on a
  call activity it is also `incidentsInCalledInstances`. When that search stops counting (above
  10,000 on Elasticsearch), the row keeps the cluster's counts.
- `calledFromElementId` comes from `parentElementInstanceKey`, a called process from
  `zeebe:calledElement`. `mapping/bpmn-text.ts` reads the diagram as text, as the C7 family's
  reader does, but like an XML parser where it matters: self-closing elements, both quote styles,
  comments, CDATA and entities.
- An instance is read first, because an ended read stops live updates. Its details follow, over the
  whole called tree with at most 50 instances, and `truncated` says when it holds only part of it.
  The wait states come from the active elements and their open jobs of any kind, so a long history
  can't push them out. A listener job of the process itself is a wait at the BPMN process id, a
  container waits only on an open job or an incident of its own, and a message subscription
  belongs to an element by key and element id, so a boundary event's message is not its host's
  wait. A local variable of a run past the cut keeps its element through one
  `GET /element-instances/{key}`, looked up once per runtime. The path keeps the newest 10,000 runs, and a cut sets `truncated`; the
  active elements, user tasks and subscriptions of an instance share that cap, far above what an
  instance holds at once.
- Counts come from the search. A capped search falls back to the exact statistics for a plain
  running count of the engine, a process or a version; everything else is
  `{ count: 10000, atLeast: true }`.

**Version floor.** `reading/version-floor.ts` checks `gatewayVersion` once per runtime. Below 8.9,
and for a `url` that isn't the REST root, the read fails as `misconfigured` with a text that names
the fix. 8.8 has no `businessId` and no statistics endpoints. A 403 that names missing secondary
storage gets a problem of its own.

**Read-only by absence.** `commands()` returns `undefined`, `proposeMigration` and `checkMigration`
don't exist, `getBulkOperation` answers `undefined`, and `refusedVariableConditions()` names
`ordering` and `date`. `ConnectionBuilder` asks the composition root whether an adapter can write
and shows "Read-only. Pulse cannot change data on this engine yet." instead of `pulse.writes` advice.

## Consequences

- All 48 read laws hold on every row of the matrix; writes need the command laws and a
  `ProcessCommands`. The wait state test polls until no wait reads `other`, because a definition's
  XML can arrive after its instances.
- `apps/vscode/test/adapters/c8/c8-conformance.engine.test.ts` selects itself with
  `describe.skipIf` on `PULSE_ENGINE_IMAGE`, and the C7 suite does the opposite, because
  `apps/vscode/test/architecture/ci-configs.test.ts` pins one project and one glob. `PULSE_C8_SECURITY`
  and `PULSE_C8_STORAGE` pick the row. With security on, the adapter runs as a read-only principal, so
  a pass also proves the permissions the docs list.
- `apps/vscode/test/adapters/c8/support/cluster-settings.json` holds the container settings, for the
  suite, `c8:up` and the sandbox alike. The suite and `c8:up` start the cluster without its web apps.
- The Camunda 8 sandbox (`apps/vscode/sandbox-c8`, `sandbox:c8:up`) runs the shop of the Camunda 7
  sandbox on two clusters with the image's default profiles, so Operate runs for comparison;
  `apps/vscode/test/architecture/sandbox-c8.test.ts` holds its charter, workers and element ids to
  its scenario catalogue and models.
- CI has the job `engines-camunda8`, switched off behind the repository variable `PULSE_C8_ENGINES`
  until the licence question of #531 has an answer: the images fall under Camunda's Self-Managed
  Non-Production Terms.
- A saved client secret is bound to the origins of both `url` and `tokenEndpoint`
  (`host/connections/credential-store.ts`), so a change to the project file can't redirect it.
- `apps/cli` accepts `flavor: camunda8` and `tokenEndpoint` alone in a project file and refuses such
  a profile, by name, whenever it is selected to reach an engine, also with `--flavor` or
  `PULSE_CLI_FLAVOR`: the engine commands, `config show` and the auth commands. Help, guide and the
  other config commands keep working with such a default, and `config set` prints no
  `pulse auth login` step for it. Neither `config set` nor `config unset` edits a single setting
  of an auth type the CLI does not know; `config unset <profile> auth` removes it whole. The CLI
  never writes a file it would refuse, and `--flavor camunda8` stays unknown.

## Decision log

- 2026-11-05: read-only first, on the floor 8.9, in one pull request (#531).
