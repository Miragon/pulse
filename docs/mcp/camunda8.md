# Camunda 8

The server reads Camunda 8 clusters from 8.9 on, through the Orchestration Cluster REST API
(`/v2`), on [boards](boards.md): a board shows a cluster's counts, lists and diagram beside the
numbers of your Camunda 7, CIB seven and Operaton engines, in the chat and in the [web
app](../web/index.md). It reads and never writes. In the chat the engine list, the board and its
diagram read a cluster, and every other tool, feed and view of the cockpit reads the Camunda 7 REST
API. The web app reads a cluster whole on its screens (processes, instances, incidents), its
incidents and jobs views Camunda 7's alone, as the editors do ([in the
editors](../vscode/camunda8.md)).

## What a server offers

| Tool or feed                                                                                      | On a Camunda 8 cluster                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `engine_list_engines`                                                                             | Lists it with `dialect` `c8` and its `cockpitUrl`, and names the boards that read it                                                     |
| `engine_open_cockpit` with `view` `board`                                                         | A board over it and the other engines the board names, with the numbers the editors show                                                 |
| `engine_open_cockpit` with `view` `landing`                                                       | The engines and boards to pick from; a cluster reads "Camunda 8, on boards" (in the web app "Camunda 8"), no health read                 |
| `engine_board_data`, `engine_bpmn_xml_data`                                                       | The app-only feeds behind a board: its numbers, kept 30 s per caller, and its diagram                                                    |
| `engine_screen_processes_data`                                                                    | The app-only feed of the web app's engine screen: a cluster's processes, its Operate where the profile names `cockpitUrl`                |
| `engine_screen_process_data`, `engine_screen_instances_data`, `engine_screen_variable_names_data` | The app-only feeds of the web app's process screen: a version, its instances, its variable names; greater, less and a date refused       |
| `engine_screen_instance_data`, `engine_screen_incident_text_data`                                 | The app-only feeds of the web app's instance screen: an instance and an incident's text                                                  |
| `engine_screen_find_data`                                                                         | The app-only feed of the web app's search: the instance with a key, those with an exact business id (a called instance has its caller's) |

Each tool, feed and view of the cockpit names the dialects it serves, so the server decides at
startup what it offers: a tool registers only where a configured engine serves it (a write only
where that engine's profile is not `readOnly`), and its `engine` parameter offers only those
engines. Beside Camunda 7 engines every tool stays, the Camunda 7 tools offer those engines alone
and the cockpit every engine; a server of clusters alone lists the ten above in every toolset, with
no write and no prompt. The instructions tell the model which engines show on boards only.

A call without `engine` goes to the default engine. Where that is a cluster, a Camunda 7 tool
refuses it with `ENGINE_DIALECT_NOT_SERVED` before it sends anything, never on another engine, and
says that boards show the cluster; the server warns at startup about such a default. In the cockpit
a cluster has no Overview, Incidents or Jobs tab but one state: the boards that show it, or that
none does yet, and with `cockpitUrl` a link to Operate's start page, never to an instance in it. In
the chat a board's tiles of a cluster open nothing, the cross-engine view names the clusters it
leaves out, and a view of one engine refuses a cluster (`ENGINE_DIALECT_NOT_SERVED`). In the web app
`/app/engines/<cluster>` shows its processes (its incidents at their instances), a board's tiles
open its screens, and its incidents and jobs pages refuse it with a link to the start page.

## A profile

A cluster is a profile of `ENGINES_FILE` or `ENGINES_JSON`
([Reference](reference.md#multi-engine)); the single-engine variables describe a Camunda 7 engine,
and `ENGINE_FLAVOR=camunda8` stops the server at startup.

```json
{
  "profiles": {
    "orders-c8": {
      "url": "https://camunda.example.com/v2",
      "cockpitUrl": "https://camunda.example.com/operate",
      "flavor": "camunda8",
      "auth": {
        "type": "clientCredentials",
        "tokenEndpoint": "https://login.example.com/realms/camunda/protocol/openid-connect/token",
        "clientId": "pulse-server",
        "clientSecretEnv": "ENGINE_SECRET_ORDERS_C8",
        "audience": "camunda"
      }
    }
  }
}
```

`url` is the cluster's REST root and ends in `/v2`; `cockpitUrl` is Operate's address as you write
it, never derived from `url`. `auth.type` is `none`, `basic` (`username`, `passwordEnv`) or
`clientCredentials` (`tokenEndpoint`, `clientId`, `clientSecretEnv`; `audience` and `scopes` as
your login service needs them). A secret never sits in the file: `passwordEnv` and
`clientSecretEnv` name a variable that starts with `ENGINE_SECRET_`. A fixed bearer token, the
caller's own token (`passthrough`), a URL with credentials or a fragment and a credential sent over
plain `http` beyond this machine (`localhost`, `127.0.0.0/8` and `[::1]` may take it), to `url` or
the token endpoint, refuse the profile on its own: the server warns at startup, and
`engine_list_engines` lists it under `refused`. A Camunda 7 profile keeps its rules.

## One client per server

The server signs in to a cluster as itself, with one token source per engine, built at startup.
Everyone who asks in a chat or signs in to the web app reads what that client may read; no
caller's token reaches a cluster. Give the server a client of its own with read rights only: with
authorizations on, `READ_PROCESS_DEFINITION`, `READ_PROCESS_INSTANCE` and `READ_USER_TASK` on the
resource `PROCESS_DEFINITION` with the id `*`, as the tests grant. Without them the cluster answers
searches with empty lists, not an error. Where people may see different processes, run a server for
each group. Tokens renew and wait as in the editors ([Tokens](../vscode/camunda8.md#tokens)); a
token request waits the profile's `timeout`, else `ENGINE_REQUEST_TIMEOUT_MS`, 30 seconds at most.

## When a cluster fails

A board shows a cluster that fails in its place, with the reason and what to check, beside the other
engines. A cluster below 8.9 names its version, one without secondary storage says it has nothing to
read, and a 404 at the root says that `url` must end in `/v2`; the web app's screens say the first
two with their fix, a refused login (a token endpoint's too) as on Camunda 7. What the model reads
names the profile's keys and the `ENGINE_SECRET_*` family, never a variable's name, the token
endpoint's URL or the cluster's `url`: a cluster's text that quotes either shows it masked, and a
redirect says whose host it points to; each failure names its engine. A diagram over 4 Mi characters
(Zeebe's limit) keeps its badges but rolls nothing up into a collapsed subprocess, which a board
note says (on Camunda 7 too); a cluster's call activity or subprocess counts the incidents inside it
as its own. Its open incidents take a search per process with an instance with incident, eight at
once; one that fails fails the read of its processes, as a failed statistics read does.

## What is tested

The conformance kit of the engine contract proves the server's own Camunda 8 wire on a local cluster
in Testcontainers
(`packages/connectors/engine/engine-connector/src/lib/core-adapter/c8-runtime.engine.test.ts`): its
55 read laws, the recorded board's numbers over the kit's world, and that no tool or view of the
Camunda 7 REST API reaches the cluster; `packages/connectors/engine/engine-connector/CONTRIBUTING.md`
says how to run a leg. On 2026-11-21 the leg 8.10.9, H2, none passed all 55 (58 of 58); the
51 laws of 2026-11-17 passed on four legs, one at a time (the time includes starting the containers):

| Camunda | Secondary storage | Security | Passed   | Time |
| ------- | ----------------- | -------- | -------- | ---- |
| 8.9.28  | H2                | Basic    | 53 of 53 | 32 s |
| 8.9.28  | H2                | OIDC     | 53 of 53 | 49 s |
| 8.10.9  | H2                | none     | 53 of 53 | 21 s |
| 8.10.9  | Elasticsearch     | OIDC     | 53 of 53 | 82 s |

The editors' C8 adapter passed all twelve legs the same day
([What is tested](../vscode/camunda8.md#what-is-tested)). A SaaS cluster takes the same profile with
its API client's token endpoint and audience; no test has run on one. No CI job starts a Camunda 8
image until [#531](https://github.com/Miragon/pulse/issues/531) settles the licence question: CI
holds the server to a recorded board and recorded screens, a loopback cluster in `test:host` and
`test:web` (the board and the screens, a count at its lower bound), and the error-path goldens of
`apps/mcp-server/test/__golden__/error-paths-c8`.
