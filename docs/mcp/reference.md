# Reference

Every tool, toolset and the most common settings of the Pulse MCP server. The full list of
environment variables is in [Operations](operations.md#environment-variables).

## Tools

Tool inputs are strict: an unknown or misnamed parameter is refused with the list of valid
ones, so a misspelled filter cannot widen the answer to the whole engine.

### Engine module (`engine_*`)

BPM operations across these domains (`category`): `engines`, `process-definitions`,
`process-instances`, `tasks`, `external-tasks`, `messages-signals`, `deployments`, `incidents`,
`jobs`, `history`, `migrations`, `batches`. Highlights:

- **Engines:** `list_engines`, `engine_status` (the triage of one engine: findings by severity,
  counts and the live verdict: the overview's incident thresholds `ENGINE_HEALTH_*` plus findings)
- **Process definitions:** `list_process_definitions`, `get_process_definition_xml`
- **Process instances:** `start`, `list`, `inspect_process_instance` (where one instance waits and
  why, running or ended, by id, business key or definition key), `delete`, `modify`,
  `set_*_suspension`, `get_activity_instance_tree` (admin, the ids `modify` takes), variables
- **User & external tasks:** `list/get/claim/unclaim/complete`, `list_external_tasks`,
  `set_external_task_retries`
- **Incidents & jobs:** `list_incidents`, `resolve_incident` (custom incidents; the engine's
  `failedJob`/`failedExternalTask` clear by a retry), `format_incident_issue`, `list_jobs`,
  `get_job_stacktrace`, `set_job_retries`
- **History, migrations & batches:** `query_historic_*` (ISO 8601 dates; incidents incl. resolved
  ones), migration tools; batch tools return a queued `batchId` that `get_batch` follows
- **Lists:** one page as `{ items, totalCount, hasMore, nextOffset? }`, `maxResults` ≤ 100;
  variable reads cut values over 2000 characters (`truncated: true`); the runtime reads'
  `variableName` returns one whole (history values stay cut); the server instructions state this
  paging contract, the shared filters and the variable shape once instead of on every tool
- **View:** `open_cockpit`, the operations cockpit and the module's one view: `view` opens it on
  the overview (default), the incidents, a failure cluster, a process, its instances, an
  instance, an incident, the jobs or an instance's history; the result carries that view's facts
  as compact JSON. A process's flow shows its open incidents or, as **Running**, what runs at
  each element now, every deployed version summed onto the latest diagram; as **Throughput ·
  30 days**, what the instances started in the last 30 days passed per element, from the
  engine's history (the app-only `engine_activity_statistics_data`, `source` `history`)

### Toolsets

A module with toolsets runs exactly one per boot, chosen by a suffix in `MCP_ACTIVE_MODULES`
(`engine:operations`) and stated in the boot log. Without a suffix the default
fails closed: the read-only toolset on an unauthenticated server, the standard one under
OAuth. `admin` is never implied (only naming it grants it), and an empty (`engine:`) or
unknown suffix warns and falls back to read-only, even under OAuth.

| Toolset             | Surface                                                                                                                                                                                                                                                                     | No-suffix default |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `engine:read-only`  | Queries only (`list_*`, `get_*` except `get_batch` and `get_activity_instance_tree`, `query_*`, `inspect_process_instance`, `engine_status`, incl. `engine_list_engines`): monitoring without writes                                                                        | without OAuth     |
| `engine:operations` | Read-only plus day-to-day writes: start instances, claim/assign/complete tasks, variables, job and external-task retries, resolve incidents, correlate messages                                                                                                             | with OAuth        |
| `engine:admin`      | Everything: adds delete/modify/suspend with `get_activity_instance_tree`, migrations, batch retries, `throw_signal` (engine-wide broadcast), the external-task worker protocol (`fetch_and_lock`, `complete_external_task`, `handle_external_task_failure`) and deployments | never             |

`engine_create_deployment` additionally needs `ENGINE_ALLOW_DEPLOYMENTS=true`: deploying a BPMN or
DMN runs code inside the engine JVM (JUEL expressions, scripts). The full surface is
`MCP_ACTIVE_MODULES=engine:admin` plus that flag, never on a server the network can
reach without authentication.
A gateway or reverse proxy that terminates auth in front of the server is invisible to it, so such
a deployment runs read-only until it names its toolsets.

The widgets follow the toolset: an action button whose tool the toolset drops (retry, resolve
incident, complete task, edit variable, suspend, cancel) is hidden, not disabled: the default
anonymous deployment shows no write buttons.

## Configuration

The most common variables. See [Operations](operations.md#environment-variables) for the full reference.

| Variable                                               | Default                             | Description                                                                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                 | `8400`                              | HTTP port the MCP server listens on                                                                                                                                                  |
| `MCP_ACTIVE_MODULES`                                   | all, read-only                      | Comma-separated modules (`engine`), each with an optional [toolset](#toolsets) suffix; no suffix = read-only, under OAuth the standard toolset                                       |
| `MCP_URL`                                              | —                                   | Public base URL: advertised URLs, the `Host`/`Origin` accepted (else localhost only), the origin the views load Geist from (`/fonts/…`); OAuth tokens carry `<MCP_URL>/mcp` in `aud` |
| `MCP_OAUTH_*`                                          | —                                   | One OAuth provider's variables protecting `/mcp`, the only caller identity (see [Operations](operations.md#security))                                                                |
| `ENGINE_ALLOW_DEPLOYMENTS`                             | `false`                             | `true` registers `engine_create_deployment` under `engine:admin`: code execution in the engine JVM; empty = unset, any value but `true`/`false` fails the boot                       |
| `ENGINE_BASE_URL`                                      | `http://localhost:8410/engine-rest` | Single-engine REST base URL                                                                                                                                                          |
| `ENGINE_ID`                                            | `default`                           | Id of that engine: the per-call `engine` selector and the name the cockpit shows                                                                                                     |
| `ENGINE_FLAVOR`                                        | `camunda7`                          | Vendor of that engine (`cibseven`, `operaton` or `camunda7`): picks its cockpit links and product name                                                                               |
| `ENGINES_JSON` / `ENGINES_FILE`                        | —                                   | Register multiple engines (see [Multi-engine](#multi-engine))                                                                                                                        |
| `ENGINE_DEFAULT`                                       | —                                   | Where a call without `engine` routes when several engines are configured; must name a configured engine, else the boot fails                                                         |
| `ENGINE_COCKPIT_URL`                                   | derived                             | Cockpit web base for jump-out links                                                                                                                                                  |
| `ENGINE_AUTH_TYPE`                                     | `none`                              | `basic`, `bearer`, `passthrough`, or `none`: fallback for engines without an `auth`                                                                                                  |
| `ENGINE_USERNAME` / `ENGINE_PASSWORD` / `ENGINE_TOKEN` | —                                   | Credentials for `basic`/`bearer`; `passthrough` forwards each caller's bearer token (trusted single-audience setups only: the engine could replay it against this server)            |
| `ENGINE_REQUEST_TIMEOUT_MS`                            | `30000`                             | Per-request deadline in ms for engine calls; a hung engine fails the tool call with a timeout error                                                                                  |

### Multi-engine

The server can route to several engines: CIB seven, Operaton and Camunda 7 mixed in one fleet.
Register them in the server (`ENGINES_JSON` / `ENGINES_FILE`), and the
host discovers them via `engine_list_engines` (read-only), which lists every configured engine.
Every operations tool also accepts a per-call `engine` override
(advertised as an enum of the configured ids). A call routes to its `engine` argument, else to
`ENGINE_DEFAULT`, else to the only configured engine, else fails with
`ENGINE_NOT_SELECTED` listing the engines; a default that names no configured engine fails the
boot. The server
`instructions` state the routing rule once for every tool. Each engine entry may carry its own `auth`
(`{type, username?, password?, token?}`); entries without one use the global `ENGINE_*` settings.
Entries may also declare their vendor via `flavor` (`cibseven` | `operaton` | `camunda7`, default
`camunda7`; the single-engine shorthand takes `ENGINE_FLAVOR`), which selects the engine's
cockpit-link routes and display name.

With several engines, the cockpit landing lists every engine with its live health in words (open
incidents, empty, unreachable, loading), read from the engine itself. Its dot, there and in the
cross-engine view, has the tone of the engine overview's verdict (ok, warning, critical), so one
open incident below the thresholds is a warning, not an alarm. With two engines or more the
cockpit offers the cross-engine view: each engine's health, its job backlog and which processes
run where, read from every engine itself, as counts, never a ranking of the engines.

Fleets that span several environments (each environment hosting some services with an engine)
group their engines per environment: the cockpit landing lists the engines under their
environment, the engine switcher and `engine_list_engines` group them by
environment, and every engine view names the environment as a chip ("PROD") next to the engine,
write confirmations included. Either write the
engines JSON as a map keyed by environment id, or tag entries individually:

```json
{
  "prod-eu": [{ "id": "prod-a", "baseUrl": "http://engine-a:8410/engine-rest" }],
  "prod-us": [{ "id": "prod-b", "baseUrl": "http://engine-b:8410/engine-rest" }]
}
```

Engine ids stay globally unique across environments: the id remains the per-call `engine`
selector; the environment is a grouping level only.
Full walkthrough in [Operations](operations.md).
