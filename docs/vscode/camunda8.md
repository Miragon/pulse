# Camunda 8

Pulse for VS Code and [Pulse for Orca](../orca/index.md) read Camunda 8 from 8.9 on, through the
cluster's Orchestration Cluster REST API (`/v2`): processes, instances, incidents, variables and
where an instance waits, with badges on the deployed diagram. They read and never write: on a
Camunda 8 cluster Pulse offers no retry, variable change, token move, cancellation or migration, and
its views say that the engine is read-only. A cluster below 8.9 shows a problem that names its
version. The MCP server's chat shows a cluster [on boards](../mcp/camunda8.md), its web app whole;
the CLI reads the Camunda 7 REST API only and refuses a `camunda8` profile on its own, up to 0.27
the whole file that holds one ([Configuration](./configuration.md#engines)).

## A profile

```json
{
  "profiles": {
    "c8-test": {
      "url": "https://camunda.example.com/v2",
      "cockpitUrl": "https://camunda.example.com/operate",
      "flavor": "camunda8",
      "auth": {
        "type": "clientCredentials",
        "tokenEndpoint": "https://login.example.com/realms/camunda/protocol/openid-connect/token",
        "clientId": "pulse",
        "audience": "camunda"
      }
    }
  }
}
```

`url` is the cluster's REST root and ends in `/v2`; another root, such as Operate's address, gets
a problem that says so. `cockpitUrl` adds _Open in Operate_ when it ends in `/operate` or names a
SaaS cluster's Operate (`https://<region>.operate.camunda.io/<cluster id>`).

| The cluster's API                  | `auth.type` in the profile                                                              | _Set Credentials_ asks for                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Unprotected                        | `none`, or no `auth`                                                                    | nothing, Pulse sends no credentials                                             |
| Basic authentication               | `basic`                                                                                 | a username and a password                                                       |
| OIDC (Keycloak, Entra ID, Okta, …) | `clientCredentials` with `tokenEndpoint`; `clientId`, `audience` and `scopes` as needed | the client ID and secret, or the secret alone when the profile names `clientId` |

`audience` and `scopes` (a list, each scope once) go to the token endpoint as you write them;
Entra ID, for example, needs a `.default` scope. A secret never sits in `.pulse.json`, and Pulse
reads none from your CLI config: _Set Credentials_ (in Orca the panel's login form) keeps it in
the editor's secret storage, bound to the origins of `url` and `tokenEndpoint`, and asks again when
either moves. Pulse sends it over `https` only, or to this machine (`localhost`, `127.0.0.0/8`,
`[::1]`), and refuses a token endpoint that is no `http` or `https` URL or carries credentials or
a fragment.

## What the login may read

With authorizations on, Pulse needs `READ_PROCESS_DEFINITION`, `READ_PROCESS_INSTANCE` and
`READ_USER_TASK` on the resource `PROCESS_DEFINITION` with the id `*`, and never more, so give it a
client or user of its own. Without them the cluster answers searches with empty lists, not an
error, so Pulse can't tell "nothing deployed" from "not allowed" and says both.

## Tokens

Pulse keeps one token per cluster and client in memory and renews it shortly before it expires. A
refused token request is not repeated for a minute unless the client, its secret, audience or
scopes change; a login service that fails or times out (5xx, 408, 425) is asked again after 5 s, a
rate limit after its `Retry-After`; a token request waits the profile's `timeout`, 30 s at most.
The problem says what to check (the client ID or secret, the token endpoint, audience or scopes)
and when Pulse asks again. A client secret or token a cluster quotes in an error shows as `***`.

## What differs from Camunda 7

| In the views        | On Camunda 8                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Counts              | On Elasticsearch a count can stop at 10,000 and then reads `≥ 10,000` or `10k+`; running counts of the engine, a process or a version stay exact |
| Variable conditions | No greater than, less than or date conditions: the API refuses them on variable values                                                           |
| Incidents           | The worker's error or the engine's error message, with its root cause, instead of a stack trace                                                  |
| Fresh data          | Searches read an export that lags the cluster by a few seconds, so a new instance can read as not found until the next refresh                   |
| Long histories      | An instance shows its newest 10,000 element runs and says that a list is cut off; where it waits comes from its active elements                  |
| Wait states         | At an event-based gateway Pulse names the message the instance waits for, not a signal or a timer beside it                                      |
| Tenants             | Every tenant the login may read, without a picker: a process in several tenants shows once, with each tenant's versions                          |

## What is tested

The conformance kit of the engine contract proves the adapter on a local cluster in Testcontainers
(`packages/connectors/c8/c8-adapter/test/c8-conformance.engine.test.ts`): its 52 read laws, the
recorded board's numbers over the kit's world, the message, timer and signal an instance waits for,
and what each login reads. On 2026-11-20 the leg 8.10.9, H2, none passed all 52 (56 of 56);
the 51 of 2026-11-17 passed on every leg, one at a time (the time includes starting the containers):

| Camunda | Secondary storage | Security | Passed   | Time |
| ------- | ----------------- | -------- | -------- | ---- |
| 8.9.28  | H2                | none     | 54 of 54 | 16 s |
| 8.9.28  | H2                | Basic    | 56 of 56 | 28 s |
| 8.9.28  | H2                | OIDC     | 59 of 59 | 47 s |
| 8.9.28  | Elasticsearch     | none     | 54 of 54 | 46 s |
| 8.9.28  | Elasticsearch     | Basic    | 56 of 56 | 61 s |
| 8.9.28  | Elasticsearch     | OIDC     | 59 of 59 | 58 s |
| 8.10.9  | H2                | none     | 54 of 54 | 17 s |
| 8.10.9  | H2                | Basic    | 56 of 56 | 28 s |
| 8.10.9  | H2                | OIDC     | 59 of 59 | 47 s |
| 8.10.9  | Elasticsearch     | none     | 54 of 54 | 48 s |
| 8.10.9  | Elasticsearch     | Basic    | 56 of 56 | 60 s |
| 8.10.9  | Elasticsearch     | OIDC     | 59 of 59 | 61 s |

A leg runs the read laws, the board and the wait states, plus one read without credentials on an
unprotected API, three checks with Basic (no login, a wrong password, a login without permissions)
or six with OIDC on Keycloak 26.8.2 (the same three with a client and its secret, one token across
rebuilt connections and parallel reads, no second token request after a refused secret, a
short-lived token renewed). Elasticsearch is 9.5.5 on a single node, H2 runs in memory. The MCP
server runs the laws and the board over its own Camunda 8 wire on four of these legs, 53 of 53
each (8.9.28 H2 OIDC and Basic, 8.10.9 H2 none, 8.10.9 Elasticsearch OIDC).

That is all the matrix covers: no OpenSearch, no other relational database and no SaaS cluster.
A SaaS cluster takes the same profile with the token endpoint and audience of its API client, and
no test has run on one. Camunda's images fall under its Self-Managed non-production terms, which
allow development and tests, so no CI job starts one until
[#531](https://github.com/Miragon/pulse/issues/531) settles the licence question: CI proves the
adapter on a fake REST API and the transport's loopback engine.

## Try it on a local cluster

From a clone of the repository, with Docker or Podman, one command starts the stack of the tests
on fixed ports, seeds a small world with incidents and prints its profile for `.pulse.json` and
the login to enter:

```sh
pnpm --filter @miragon/pulse-c8-adapter run c8:up -- --security oidc   # none, basic or oidc; --storage elasticsearch
pnpm --filter @miragon/pulse-c8-adapter run c8:down
```
