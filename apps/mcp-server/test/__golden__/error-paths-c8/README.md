# Error-path goldens of the MCP server on Camunda 8

What the server reports when a Camunda 8 cluster's call fails, pinned byte for byte. The test is
`apps/mcp-server/test/engine-goldens/error-paths-c8.golden.test.ts`; it boots the real app
(`createApp`) over one `camunda8` profile and a board that names it alone
(`ENGINE_BOARDS_DIR`), against a loopback engine
(`apps/mcp-server/test/engine-goldens/fake-c8-cluster.ts`) that is the cluster and, at Keycloak's
path on the same origin, its token endpoint, under a clock the test holds (`Date`, which the token
source's hold and renewal and the board's floor read). The server reads a Camunda 8 engine on
boards only, so each case opens that board (`engine_open_cockpit` view `board`) unless it names its
own probes. The cases and the answers that make them are
`apps/mcp-server/test/engine-goldens/error-cases-c8.ts`, a copy of the C8 adapter's
(`packages/connectors/c8/c8-adapter/test/goldens/error-cases.ts`), and the world they build on is
`apps/mcp-server/test/engine-goldens/c8-cluster-world.ts`, a copy of the adapter's world; the
adapter's README (`packages/connectors/c8/c8-adapter/test/__golden__/error-paths/README.md`)
explains each answer. The world answers the searches of the process definitions and their
statistics empty, so a board that reads the cluster shows its engine ready with totals of 0. The
engine list over a Camunda 8 engine beside a Camunda 7 one is an output golden
(`apps/mcp-server/test/__golden__/outputs/engine_list_engines-c8.json`).

A golden holds the case, the profile and the secret variables it boots with, and per probe the
tool and its arguments, `atSecond` where a case moves the clock (seconds after the first call), the
adapter's call it `matches`, its `failure`, what the model reads and the requests the engine saw
(`sent`, with the Authorization they carried; a token request with its form). For a board that is
its facts (`facts`, the model's text, whose engine names only its failure code) and the board the
view renders (`board`, whose failed engine carries the message with its hint). The requests go out
one after another up to the last read of the cluster's version (a token, the version, a renewed
token, the version again) and stand in that order; the board's reads after it run in parallel and
stand sorted. Ports read `127.0.0.1:<port>`. The golden file sorts every object's keys.

The same failure per case: `matches` names the C8 adapter's call (`describeEngine`, or
`getInstanceDetail` with its key) at the same second, and `scripts/error-path-goldens.test.mjs`
holds the probe's `failure` (the board's engine's failure code, else none) to that call's failure
in the adapter's golden of the same case, for every case both surfaces pin. A board's engine
fails at its first read, the cluster's version, as `describeEngine` does, and so does the
diagram's XML feed, whose tool error leads with the failure's code. Where the adapter asks for an
instance alone, the board's version read passes as the adapter's does, and neither fails; the
server reads no Camunda 8 instance by its key. A cluster without secondary storage passes the
version read and fails the board's engine at its definitions, as the adapter's instance read
fails.

Never edit a golden by hand. An intended change runs
`pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update` (refused in CI) and
commits the diff. The words are the server's own
(`packages/connectors/engine/engine-connector/src/lib/engine/c8-errors.ts`); only
the failure codes are held to the adapter's. A fixed bearer token on a `camunda8` profile is no
case: the boot refuses that profile, which the test pins beside the table.

The network codes (ECONNREFUSED, ENOTFOUND, DEPTH_ZERO_SELF_SIGNED_CERT) come from Node, not from
the server; they are checked with Node 22.23.4 (CI runs the newest Node 22) and 24.15.0.
`dns-failure` needs a resolver that answers `.invalid` with NXDOMAIN.

The steps are those of the Camunda 8 plan of #617 for the server (8.1 to 8.10); step 8.7 pinned
these goldens. A later step that changes one names itself in its row's last column.

| Case | Status | What the golden shows, or why there is none | Changes in step |
| ---- | ------ | ------------------------------------------- | --------------- |
| `redirect` | pinned | a 302 to a login page on a host of its own: the board's engine fails `misconfigured`, its target without the query and the hint that the url must be the REST root ending in `/v2`, nothing followed; a target on the cluster's or the token endpoint's host is named by whose host it is, never by its URL (`apps/mcp-server/test/c8-profile-urls.e2e.test.ts`) | none planned |
| `unauthorized-none` | pinned | a cluster with Basic security asked without credentials: `unauthorized` with the cluster's detail and the hint to set auth in the engine's profile, its secret in an `ENGINE_SECRET_*` variable | none planned |
| `unauthorized-basic` | pinned | the same to Basic `demo`/`demo-secret` (`passwordEnv`), the header as sent: the configured credentials were rejected | none planned |
| `unauthorized-bearer` | pinned | client credentials: the token endpoint issues a token, the cluster refuses it with a 401 without a body: `unauthorized` with the hint to check the client's rights and `auth.audience`, a changed client ID or secret in the profile or its variable; the token is younger than 30 s, so one request goes out | none planned |
| `unauthorized-passthrough` | not reachable | the server forwards no caller's token to a Camunda 8 cluster: a `camunda8` profile signs in with none, Basic or client credentials | |
| `wrong-rest-root` | pinned | the url lacks `/v2`, and the cluster answers `/topology` with its own 404: `misconfigured` with the `/v2` hint alone, never the Camunda 7 root hint; the diagram's XML feed fails alike, its tool error `[misconfigured]` with the hint after the message | 8.11: the XML feed's probe |
| `missing-resource` | pinned | the cluster knows no instance `9007199254740993`, which the server never asks for: the board is ready, and a server of Camunda 8 engines alone lists no tool that reads an instance by key (`tools-c8-*.json`), so none can ask | none planned |
| `engine-text-echoes-secret-basic` | pinned | a 500 whose detail echoes the Basic value, the password, a token and a client secret: `engineFailure`, the configured password and Basic value read `***`, the rest stays, the message on one line and cut after 500 characters | none planned |
| `engine-text-echoes-secret-bearer` | pinned | the same 500 to the token the endpoint issued: the token and the client secret read `***`, though the secret went to the token endpoint alone | none planned |
| `deadline-exceeded` | pinned | a cluster that never answers, the profile's `timeout` 300 ms: `unreachable`, the deadline named | none planned |
| `unreachable` | pinned | a closed loopback port: `unreachable`, ECONNREFUSED | none planned |
| `tls-failure` | pinned | a self-signed certificate: `unreachable`, the handshake failed, so nothing was sent | none planned |
| `dns-failure` | pinned | a host under `.invalid`: `unreachable`, ENOTFOUND | none planned |
| `too-large-response` | pinned | a Content-Length above 64 MiB: `unexpectedResponse` before the body is read | none planned |
| `basic-password-euro` | pinned | Basic as UTF-8: the board reads the cluster, the header as sent | none planned |
| `path-value-dot` | pinned | "." and ".." are no key: the diagram's XML feed (`engine_bpmn_xml_data`) answers no XML after the version read and asks nothing more | none planned |
| `double-slash-root` | pinned | a url ending in `//`: the slashes are trimmed, the board reads the cluster | none planned |
| `token-line-break-inside` | pinned | the token endpoint issues a token with a line break inside: no Bearer token (RFC 6750), so `unexpectedResponse`, and nothing goes to the cluster | none planned |
| `token-line-break-trailing` | pinned | a token that ends in a line break is refused alike: the server takes a token as the endpoint issues it | none planned |
| `integer-beyond-2-53` | pinned | the board reads instances by search, so this case adds the world's instance to every instance search: its key `9007199254740993` keeps its digits in the tile | none planned |

The cases of Camunda 8 alone, the second table of the C8 adapter's README: a token endpoint that
refuses or holds, the renewal of a refused token, the version floor, the `/v2` hint for Operate's
address, and a cluster without secondary storage.

| Case | Status | What the golden shows, or why there is none | Changes in step |
| ---- | ------ | ------------------------------------------- | --------------- |
| `token-endpoint-refusal` | pinned | Keycloak's 401 `unauthorized_client`: `unauthorized` with the hint to check `auth.clientId` and the secret's variable, and that the server asks again a minute after the last answer; at 59 s the refusal holds and nothing is sent, at 61 s the endpoint is asked again | none planned |
| `token-endpoint-rate-limit` | pinned | a 429 with `Retry-After: 30`: `engineFailure`, asked again 30 seconds after the last answer; at 29 s nothing is sent, at 31 s a token and the board's reads | none planned |
| `unauthorized-renewed` | pinned | the cluster takes the second token only: the first board fails after one request with the hint of `unauthorized-bearer`; at 31 s the old token earns the one renewal, and the board reads the cluster | none planned |
| `unauthorized-after-the-one-retry` | pinned | the cluster takes no token: at 31 s the attempt with the renewed token fails too, and no third token is asked for | none planned |
| `version-below-the-floor` | pinned | a cluster on 8.8.12: `misconfigured`, "Pulse reads Camunda 8.9 or newer", the engine named at its end as in every other failure | 8.11: the engine named |
| `url-of-operate` | pinned | the profile's url is Operate's address (`/operate`): the cluster's 404 and the `/v2` hint alone | none planned |
| `no-secondary-storage` | pinned | the cluster answers its version and every other read with a 403: the board's engine fails `misconfigured` at its definitions with the secondary storage hint, never a ready engine with empty tiles, and its tiles read nothing | 8.11: the engine failed |
