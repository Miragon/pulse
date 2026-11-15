# Camunda 8 adapter

- Status: accepted
- Last reviewed: 2026-11-15 (the wire on `@miragon/pulse-http` and its OAuth client, the REST
  client with checked views, the wording of its failures and the version floor; the package
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
words and the version floor.

## Decision

`packages/connectors/c8/c8-adapter` (`@miragon/pulse-c8-adapter`, private, bundled by the editor
hosts) is the c8 family's adapter of the runtime view. In this step it holds the wire, the REST
client, the wording of failures and the version floor, composed per connection by
`CamundaClients`, which holds the one `ClientCredentialsSources` of its process; the readers, the
runtime and the plug of the ports join the same package in the commits after this one.

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
  transport: one source per token endpoint, client ID, secret, audience and scopes (in any order),
  in memory. The editor hosts build their connections anew on every reload, so a connection built
  anew takes the source that is there and keeps its token and its hold: a wrong secret costs one
  token request a minute, not one per read, and a changed secret gets a source of its own. The
  client authenticates with `client_secret_post`, as the Camunda login services expect, and the
  form names an audience and scopes only when the connection does.
- **The REST client (`src/rest`).** `RestCamundaClient` has one method per call of `/v2` the reads
  need; `CamundaViews` turns each answer into a checked view, field by field, so an answer of
  another shape fails as `unexpectedResponse`. A search pages by its cursor up to 10,000 rows and
  says when it cut, a statistics read by offset, and a search over keys asks for at most 1,000 at a
  time. A lookup by key reads a 404 with the title `NOT_FOUND` as none (an 8.10 endpoint on 8.9
  answers `Not Found`, which fails), and a key the transport refuses before sending (`.`, `..`) as
  none too. `CamundaRequestError` is built from the wire's reasons; only the wire imports the
  transport.
- **Failures (`src/errors`).** `ErrorTranslation` maps a request error onto the contract's
  failures: 401 `unauthorized`, 403 `forbidden`, a redirect and a 404 `misconfigured`, any other
  status `engineFailure`, no answer `unreachable`. A 404 that names no missing resource gets the
  hint that the profile's url must be the cluster's REST root and end in `/v2`, and a 403 that names
  missing secondary storage says that the cluster has nothing to read. `TokenTexts` words a token
  failure with its way out (031dc1f4 of #543): a refused client by its code, a refused audience or
  scope with the profile's settings to check, a 403 with what the client may get a token for, a
  redirect or another status with the `tokenEndpoint` to check; it never shows the secret, the
  description or the body.
- **Version floor (`src/reading/version-floor.ts`).** The cluster's `gatewayVersion` is read once
  per client; below 8.9 a read fails as `misconfigured` with the version it found. 8.8 has no
  `businessId` and no statistics endpoints. A version that does not parse is left to the cluster,
  and a failed read is tried again.
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
  asks at once.
- The adapter is proven on a fake REST API in this step; the conformance kit on a local cluster
  and the error-path goldens come with the runtime. CI runs no Camunda 8 image until the licence
  question of #531 has an answer: the images fall under Camunda's Self-Managed non-production
  terms.

## Decision log

- 2026-11-05: read-only first, on the floor 8.9 (#543, Thomas Heinrichs).
- 2026-11-15: the wire on `@miragon/pulse-http` and its OAuth client instead of #543's own HTTP
  seam and grant; the adapter is a package of the c8 family (#617).
