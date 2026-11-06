# Camunda 8

Pulse reads Camunda 8 through its Orchestration Cluster REST API: definitions, instances,
incidents, variables and wait states, with badges on the deployed diagram. It works on SaaS and
Self-Managed, from Camunda 8.9 on. A cluster below 8.9 gets a problem that names the version.

::: warning Read-only, tested on Self-Managed
Pulse cannot change data on a Camunda 8 cluster yet: no retries, no variable changes, no
migrations. The conformance suites run on Self-Managed 8.9 and 8.10 with H2 and Elasticsearch,
without security, with basic authentication and with OIDC. SaaS speaks the same API, but no suite
has run on a SaaS cluster yet.
:::

## SaaS

Create an API client for the cluster in Camunda Hub. Its connection information names the REST
address, the token URL and the audience. Add a profile to `.pulse-cli.json`:

```json
{
  "profiles": {
    "c8-saas": {
      "url": "https://bru-2.api.camunda.io/<cluster id>/v2",
      "flavor": "camunda8",
      "cockpitUrl": "https://bru-2.api.camunda.io/<cluster id>/operate",
      "auth": {
        "type": "clientCredentials",
        "tokenEndpoint": "https://login.cloud.camunda.io/oauth/token",
        "audience": "<the audience of your API client>"
      }
    }
  }
}
```

Then run _Pulse: Set Credentials…_ and enter the client ID and the client secret. They live in
VS Code's secret storage, never in the file.

SaaS hosts count as unclassified, so open views don't read the cluster again on their own. Classify
the profile and turn live updates on in your user settings if you want them
([Configuration](./configuration.md#settings)).

## Self-Managed

The `url` ends in `/v2`, and `cockpitUrl`, when you set it, in `/operate`.

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
| Tenants             | Pulse reads every tenant your login may read, without a picker. A process in several tenants shows as one, and its version list shows each tenant's versions                                                                             |

## Try it in Docker

From a clone of the repository, with Docker running:

```sh
pnpm --filter pulse-cockpit run c8:up --security oidc    # none (default), basic or oidc
pnpm --filter pulse-cockpit run c8:down
```

`--storage elasticsearch` swaps the default H2 for Elasticsearch. The command seeds orders with
incidents and prints which profile of `apps/vscode/dev/host/workspace-c8` to open and which login
to enter. Operate's browser login doesn't work on the OIDC stack, because Keycloak's public name
there is `keycloak:8080`; the REST API Pulse reads works on every stack.
