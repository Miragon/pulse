# Camunda 8

Pulse reads Camunda 8 through its Orchestration Cluster REST API: definitions, instances,
incidents, variables and wait states, with badges on the deployed diagram. It works on SaaS and
Self-Managed, from Camunda 8.9 on. A cluster below 8.9 gets a problem that names the version.

::: warning Read-only, tested on Self-Managed
Pulse cannot change data on a Camunda 8 cluster yet: no retries, no variable changes, no
migrations. The conformance suites run on Self-Managed 8.9 and 8.10 with H2 and Elasticsearch,
without security, with basic authentication and with OIDC. On SaaS, _Add Engine_ and the shop
sandbox's charter ran against an 8.9 cluster; no suite has run there yet.
:::

## SaaS

Run _Pulse: Add Engine…_ and choose Camunda 8 SaaS. It asks for the region and the cluster ID, then
for the ID, the secret and the audience of an API client of the cluster, as Camunda Hub shows them
in the client's connection information (`CAMUNDA_CLUSTER_REGION`, `CAMUNDA_CLUSTER_ID`, …), and for
a name and whether the cluster is test or production. Pulse adds the profile to `.pulse-cli.json`,
keeps the ID and the secret in VS Code's secret storage, never in the file, and reads the cluster
once to check it:

```json
{
  "url": "https://bru-2.api.camunda.io/<cluster id>/v2",
  "cockpitUrl": "https://bru-2.api.camunda.io/<cluster id>/operate",
  "flavor": "camunda8",
  "auth": {
    "type": "clientCredentials",
    "tokenEndpoint": "https://login.cloud.camunda.io/oauth/token",
    "audience": "zeebe.camunda.io"
  }
}
```

With authorizations on, the API client needs the [read permissions](#what-the-login-may-read). A
cluster left unclassified is read again only when you refresh; Test turns live updates on
([Configuration](./configuration.md#settings)).

## Self-Managed

_Pulse: Add Engine…_ with Camunda 8 Self-Managed asks for the REST address, the Operate address and
the login. In the profile, the `url` ends in `/v2`, and `cockpitUrl`, when you set it, in `/operate`.

| The cluster's API                | `auth` in the profile                                                    | What you enter in _Set Credentials…_ |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| Unprotected                      | none                                                                     | nothing, Pulse sends no credentials  |
| Basic authentication             | `{ "type": "basic" }`                                                    | username and password                |
| OIDC (Keycloak, Entra ID, Okta…) | `{ "type": "clientCredentials", "tokenEndpoint": "…", "audience": "…" }` | client ID and client secret          |

`audience` and `scopes` (a list of distinct scopes) go to the token endpoint as you write them.
Entra ID, for example, needs `.default` scopes. A blank audience, or scopes that aren't a list of
distinct scopes, show up as a problem in the Engines view. Credentials travel only over https, unless the
host is `localhost`, `127.0.0.1` or `[::1]`; that holds for both `url` and `tokenEndpoint`.

## What the login may read

With authorizations on, Pulse needs these permissions on the resource `PROCESS_DEFINITION` with the
id `*`: `READ_PROCESS_DEFINITION`, `READ_PROCESS_INSTANCE` and `READ_USER_TASK`. Pulse never needs
more, so give it a principal of its own.

Without them the cluster answers searches with empty lists, not with an error, so Pulse can't tell
"nothing deployed" from "not allowed". It says both.

## How tokens are handled

Pulse keeps one token per client and secret in memory and asks for a new one shortly before it expires. A
refused token request stops for a minute unless the credentials change. A login service that
fails or times out (5xx, 408, 425) gets the next request after 5 seconds, and a rate limit waits as
long as `Retry-After` asks, in seconds or as a date: the SaaS login service blocks an IP that keeps
retrying. The problem says what to fix: the client ID or secret, or the token endpoint, audience
and scopes of the profile. A saved secret belongs to the origins of both `url` and
`tokenEndpoint`. When a change to the file moves either, Pulse sends nothing until you set the
credentials again, and the prompt names the host the secret goes to.

## What differs from Camunda 7

| In the views        | On Camunda 8                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Counts              | On Elasticsearch a count can stop at 10,000 and then shows as `10k+` or `10,000+`. Running counts of the engine, a process or a version stay exact                                                                                       |
| Variable conditions | No `>`, `<` or date conditions: the API refuses them on variable values                                                                                                                                                                  |
| Incidents           | The worker's error text, or the engine's error message, instead of a stack trace                                                                                                                                                         |
| Fresh data          | Searches read an export that lags behind the cluster by up to a few seconds, so an instance you just started can read as not found until the next refresh                                                                                |
| Long histories      | An instance with more than 10,000 element runs shows its newest 10,000 and says that the list is cut off; the wait states come from the active elements, so a long history doesn't push them out, and local variables keep their element |
| Wait states         | At an event-based gateway Pulse names only the message the instance waits for, not a signal or a timer next to it                                                                                                                        |
| Tenants             | Pulse reads every tenant your login may read, without a picker. A process in several tenants shows as one, and its version list shows each tenant's versions                                                                             |

## Try it in Docker

From a clone of the repository, with Docker running, one command builds Pulse, starts two seeded
clusters with Operate and opens a shop project in VS Code. Its test charter is in
`apps/vscode/sandbox-c8/README.md`:

```sh
pnpm --filter pulse-cockpit run sandbox:c8:open   # sandbox:c8:traffic adds live orders, sandbox:c8:down removes it
```

For one security mode at a time, as the end-to-end test runs it:

```sh
pnpm --filter pulse-cockpit run c8:up --security oidc    # none (default), basic or oidc
pnpm --filter pulse-cockpit run c8:down
```

`--storage elasticsearch` swaps the default H2 for Elasticsearch. The command seeds a small world
with incidents and prints which profile of `apps/vscode/dev/host/workspace-c8` to open and which
login to enter. Its cluster runs without Operate.
