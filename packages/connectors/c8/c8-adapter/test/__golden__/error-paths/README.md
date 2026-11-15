# Error-path goldens of the C8 adapter

What the C8 adapter of Pulse for VS Code and Pulse for Orca reports when a cluster call fails,
pinned byte for byte. The test is
`packages/connectors/c8/c8-adapter/test/goldens/error-paths.golden.test.ts`; it builds one
`C8Adapter` per case over the real `fetch` and a clock the test holds, against loopback engines
(`packages/connectors/c8/c8-adapter/test/goldens/loopback-engine.ts`), and asks
`describeEngine()` unless a case names its own calls. Each call goes to a runtime the case's
adapter builds for it, as a host builds one per connection: the runtime reads the cluster's
version before any question, and the adapter keeps its token sources, so a token and a refusal's
hold outlive the call.

The first table holds the cases the MCP server (`apps/mcp-server/test/__golden__/error-paths`),
the CLI (`apps/cli/test/__golden__/error-paths`) and the C7 adapter
(`packages/connectors/c7/c7-adapter/test/__golden__/error-paths`) pin, under the same names and
in the same order (`scripts/error-path-goldens.test.mjs`). The answers that make them are the C8
adapter's own, since a Camunda 8 cluster answers in problem details on `/v2`, and the second
table holds the cases of Camunda 8 alone. The answers a local cluster can give follow what
`camunda/camunda` 8.9.28 (H2 or no secondary storage; no security, Basic or OIDC) and Keycloak
26.8.2 sent on 2026-11-15; the 302, the 500, the 429 and the cluster on 8.8 take the same shapes.
The answers are
`packages/connectors/c8/c8-adapter/test/goldens/error-cases.ts` and the world they build on
`packages/connectors/c8/c8-adapter/test/goldens/cluster-world.ts`; those files may carry no
comment, so they are explained here:

- `clusterWorld`: the topology of a cluster on 8.9.28, and one instance (`9007199254740993`, a key
  of the fourth partition, beyond 2^53) of `pulse-order` waiting at the service task
  `Activity_ChargePayment` for a job, its variable `big` the Long 9223372036854775807 as the
  cluster writes it, a JSON text in a string; every other search finds nothing, an unknown path
  gets the cluster's 404;
- `redirectToLogin`: a gateway's 302 to a login page, whose query the message must drop;
- `unauthorizedWithoutLogin` and `unauthorizedBasic`: a cluster with Basic security, asked
  without credentials and with a wrong password;
- `refusingEveryToken` and `acceptingOnly`: an OIDC cluster's 401 for a token it does not take,
  without a body, its reason in `WWW-Authenticate`;
- `outsideV2` and `operateInsteadOfV2`: the cluster's 404 for a path outside `/v2`, at the root
  and under Operate's path;
- `missingInstance`: the cluster's 404 `NOT_FOUND` for an instance key it does not know;
- `echoesSecrets`: a token, then a 500 whose detail (over 500 characters, with line breaks)
  echoes the Basic value, the password, the bearer token and the client secret of the cases;
- `issuing`: a token endpoint at Keycloak's path that answers as Keycloak does (Bearer, 300 s)
  and hands out the listed tokens in turn, the last one again once they run out;
- `refusingTheClient`: Keycloak's 401 `unauthorized_client` for a wrong secret;
- `rateLimitedOnce`: a 429 with `Retry-After: 30` to the first token request, a token after;
- `belowTheFloor`: a cluster on 8.8.12;
- `withoutSecondaryStorage`: a cluster without secondary storage: its topology, and the 403 it
  answers to every other read.

A golden holds the case, the connection (endpoint and credentials), and per call its outcome (the
value, or the `RuntimeError`'s failure, message and hint), with `atSecond` where a case moves the
clock (seconds after the first call), and the requests the engine saw (`sent`, with the
Authorization they carried; a token request with its form, a search without its body): in arrival
order for `describeEngine`, whose requests go out one after another (a token, then the version),
sorted for `getInstanceDetail`, whose reads run in parallel. Ports read `127.0.0.1:<port>`. The
engines answer like the Tomcat a cluster runs in: a status line without a reason phrase.

Never edit a golden by hand. An intended change runs
`pnpm --fail-if-no-match --filter @miragon/pulse-c8-adapter golden:update` (refused in CI) and
commits the diff.

The network codes (ECONNREFUSED, ENOTFOUND, DEPTH_ZERO_SELF_SIGNED_CERT) come from Node, not from
the adapter; they are checked with Node 22.23.4 (CI runs the newest Node 22) and 24.15.0.
`dns-failure` needs a resolver that answers `.invalid` with NXDOMAIN: offline the lookup fails
with EAI_AGAIN, and a resolver that rewrites NXDOMAIN reaches a real host.

Steps are those of the Camunda 8 plan of #617 (3.1 to 3.9). Step 3.7 restated the echo goldens
when the cluster's texts began to mask the client secret, and step 3.8 settled the wordings that
were open for a token the cluster refuses and for the wait of the token endpoint's hold (the
owner's delegate decisions of 2026-11-15). Step 3.10 gave a 401 without a login the hint to add
one with Set credentials and dropped the cluster's internal detail from it, as every surface says
what to do there. Where the last column says open, the golden pins a
wording the owner has not settled; the fix that settles it rewrites the golden with
`golden:update`.

| Case | Status | What the golden shows, or why there is none | Changes in step |
| ---- | ------ | ------------------------------------------- | --------------- |
| `redirect` | pinned | a 302 to a login page: `misconfigured`, its target without the query and the hint to the REST root, which ends in `/v2`, nothing followed; `getInstanceDetail` fails at the version read alike | none planned |
| `unauthorized-none` | pinned | a cluster with Basic security asked without credentials: `unauthorized`, "HTTP 401 Unauthorized" without the cluster's internal detail, with the hint to add a login with Set credentials; the same for `getInstanceDetail` | 3.10 (the hint, no internal detail) |
| `unauthorized-basic` | pinned | the same to Basic `demo`/`demo-secret`, the header as sent | none planned |
| `unauthorized-bearer` | pinned | client credentials: the token endpoint issues a token, the cluster refuses it with a 401 without a body: `unauthorized` "HTTP 401 Unauthorized" with the hint to check the client's rights and the audience and to enter a changed client ID or secret with Set credentials. A token younger than 30 s is not renewed, so one request goes out | none planned |
| `unauthorized-passthrough` | not reachable | the editors have no caller whose token they could forward: passthrough is the MCP server's alone | |
| `wrong-rest-root` | pinned | the URL lacks `/v2`, and the cluster answers `/topology` with its own 404: `misconfigured` with the `/v2` hint; the same for `getInstanceDetail` | none planned |
| `missing-resource` | pinned | 404 `NOT_FOUND` for the instance: `getInstanceDetail` returns no detail, after the version read | none planned |
| `engine-text-echoes-secret-basic` | pinned | a 500 whose detail echoes the Basic value, the password, a token and a client secret: `engineFailure`, the configured password and Basic value read `***`, the other token and the client secret stay, the message on one line and cut after 500 characters | none planned |
| `engine-text-echoes-secret-bearer` | pinned | the same 500 to the token the endpoint issued: the token and the client secret read `***`, though the secret went to the token endpoint alone; the Basic value and the password are no credential of this connection and stay | none planned |
| `deadline-exceeded` | pinned | a cluster that never answers: `unreachable`. The test turns the transport's timer of 60000 ms into one of 300 ms, so the text names the adapter's own 60000 ms; the same for `getInstanceDetail` | none planned |
| `unreachable` | pinned | a closed loopback port: `unreachable`, ECONNREFUSED | none planned |
| `tls-failure` | pinned | a self-signed certificate: `unreachable`, the failed TLS handshake with its code and the certificate hint | none planned |
| `dns-failure` | pinned | a host under `.invalid`: `unreachable`, the host name that does not resolve with ENOTFOUND and the host name hint | none planned |
| `too-large-response` | pinned | a Content-Length above 64 MiB: `unexpectedResponse` before the body is read | none planned |
| `basic-password-euro` | pinned | Basic as UTF-8: the read succeeds, the header as sent | none planned |
| `path-value-dot` | pinned | "." and ".." are no key, so `getInstanceDetail` names no instance and sends nothing after the version read | none planned |
| `double-slash-root` | pinned | an endpoint ending in `//`: the slashes are trimmed, the read succeeds | none planned |
| `token-line-break-inside` | pinned | the token endpoint issues a token with a line break inside: no Bearer token (RFC 6750), so `unexpectedResponse`, and nothing goes to the cluster | none planned |
| `token-line-break-trailing` | pinned | a token that ends in a line break is refused alike: the adapter takes a token as the endpoint issues it and trims none, unlike a token a profile names on the other surfaces | none planned |
| `integer-beyond-2-53` | pinned | the instance `9007199254740993` and its Long variable 9223372036854775807 keep their digits, in the ids and in the variable's `valueJson` | none planned |

The cases of Camunda 8 alone: a token endpoint that refuses or holds, the renewal of a refused
token, the version floor, the `/v2` hint for Operate's address, and a cluster without secondary
storage.

| Case | Status | What the golden shows, or why there is none | Changes in step |
| ---- | ------ | ------------------------------------------- | --------------- |
| `token-endpoint-refusal` | pinned | Keycloak's 401 `unauthorized_client` for a wrong secret: `unauthorized` with the hint to check the client ID and the secret, and that Pulse asks the token endpoint again a minute after its last answer; at 59 s the refusal holds and nothing is sent, at 61 s the endpoint is asked again | none planned |
| `token-endpoint-rate-limit` | pinned | a 429 with `Retry-After: 30`: `engineFailure`, Pulse asks the token endpoint again 30 seconds after its last answer; at 29 s nothing is sent, at 31 s a token and the read | none planned |
| `unauthorized-renewed` | pinned | the cluster takes the second token only: the first call fails after one request with the hint of `unauthorized-bearer`, since the token is young; at 31 s the old token earns the one renewal, and the read succeeds | none planned |
| `unauthorized-after-the-one-retry` | pinned | the cluster takes no token: at 31 s the attempt with the renewed token fails too, with the hint of `unauthorized-bearer`, and no third token is asked for | none planned |
| `version-below-the-floor` | pinned | a cluster on 8.8.12: `misconfigured`, "Pulse reads Camunda 8.9 or newer"; `getInstanceDetail` is refused after the version read alike | none planned |
| `url-of-operate` | pinned | the profile's url is Operate's address (`/operate`, as the profile's cockpitUrl): the cluster's 404 and the `/v2` hint | none planned |
| `no-secondary-storage` | pinned | the cluster answers its version, so `describeEngine` succeeds, and every other read with a 403: `misconfigured` with the secondary storage hint, never `forbidden` | none planned |
