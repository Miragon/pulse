# Reference

Every tool, toolset and the most common settings of the Pulse MCP server. The full list of
environment variables is in [Operations](operations.md#environment-variables).

## Tools

Tool inputs are strict: an unknown or misnamed parameter is refused with the list of valid
ones instead of being ignored (which used to widen a "filtered" answer to the whole engine).

### Camunda 7 module (`camunda7_*`)

BPM operations across these domains (`category`): `engines`, `process-definitions`,
`process-instances`, `tasks`, `external-tasks`, `messages-signals`, `deployments`, `incidents`,
`jobs`, `history`, `migrations`, `batches`. Highlights:

- **Process definitions:** `list_process_definitions`, `get_process_definition_xml`
- **Process instances:** `start`, `list`, `get`, `delete`, `modify`, `set_*_suspension`,
  `get_activity_instance_tree`, variables
- **User & external tasks:** `list/get/claim/unclaim/complete`, `list_external_tasks`,
  `set_external_task_retries`
- **Incidents & jobs:** `list_incidents`, `resolve_incident` (custom incidents; the engine's
  `failedJob`/`failedExternalTask` clear by a retry), `format_incident_issue`, `list_jobs`,
  `get_job_stacktrace`, `set_job_retries`
- **History, migrations & batches:** `query_historic_*` (ISO 8601 dates; incidents incl. resolved
  ones), migration tools; batch tools return a queued `batchId` that `get_batch` follows
- **Lists:** one page as `{ items, totalCount, hasMore, nextOffset? }`, `maxResults` ≤ 100;
  variable reads cut values over 2000 characters (`truncated: true`); `variableName` reads one whole
- **Widgets:** `open_cockpit` (the cockpit app), `show_process_list`/`detail`, `show_incidents_dashboard`,
  `show_bpmn_viewer`, `show_history_timeline`, `show_job_panel`, …

### Analytics module (`analytics_*`)

Prometheus-backed analysis over PromQL: `analyze_process_performance`, `compare_execution_periods`,
`element_bottleneck`, `find_failed_instances`, `cluster_compare`, `version_compare`,
`engine_landscape` (the cross-engine overview: what runs where, load and job backlog per engine),
`engine_compare` (one process definition on two engines), and `engine_health` (a live WIP /
incidents / backlog / alerts snapshot). Widgets: `show_dashboard`, `show_failure_dashboard`,
`show_cluster_compare`, `show_version_compare`, `show_engine_landscape`, `show_engine_compare`,
`show_bpmn_heatmap`.

Across engines the tools report counts, never per-engine rates: engines host different process
definitions, so an aggregated failure rate or duration describes that engine's process mix rather
than the engine. `engine_compare` therefore requires a `processDefinitionKey`; `engine_landscape`
lists the definitions deployed on more than one engine as its valid inputs.

### Toolsets

Each module runs exactly one toolset per boot, chosen by a suffix in `MCP_ACTIVE_MODULES`
(`camunda7:operations,analytics:standard`) and stated in the boot log. Without a suffix the default
fails closed: the read-only toolset on an unauthenticated server, the standard one under
`MCP_OAUTH`. `admin` is never implied (only naming it grants it), and an empty (`camunda7:`) or
unknown suffix warns and falls back to read-only, even under OAuth.

| Toolset               | Surface                                                                                                                                                                                                                                   | No-suffix default |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `camunda7:read-only`  | Queries only (`list_*`, `get_*`, `query_*`, incl. `camunda7_list_engines`): monitoring without writes                                                                                                                                     | without OAuth     |
| `camunda7:operations` | Read-only plus day-to-day writes: start instances, claim/assign/complete tasks, variables, job and external-task retries, resolve incidents, correlate messages, the saved default engine                                                 | with OAuth        |
| `camunda7:admin`      | Everything: adds delete/modify/suspend, migrations, batch retries, `throw_signal` (engine-wide broadcast), the external-task worker protocol (`fetch_and_lock`, `complete_external_task`, `handle_external_task_failure`) and deployments | never             |
| `analytics:read-only` | Every analytics tool and widget; no settings save                                                                                                                                                                                         | without OAuth     |
| `analytics:standard`  | Adds `analytics_save_settings`                                                                                                                                                                                                            | with OAuth        |

`camunda7_create_deployment` additionally needs `CAMUNDA_ALLOW_DEPLOYMENTS=true`: deploying a BPMN or
DMN runs code inside the engine JVM (JUEL expressions, scripts). The full surface of earlier
releases is `MCP_ACTIVE_MODULES=camunda7:admin,analytics:standard` plus that flag (the dashboard
builder also needs `MCP_OAUTH`), never on a server the network can reach without authentication.
A gateway or reverse proxy that terminates auth in front of the server is invisible to it, so such
a deployment runs read-only until it names its toolsets.

The widgets follow the toolset: an action button whose tool the toolset drops (retry, resolve
incident, complete task, edit variable, suspend, cancel) is hidden, not disabled: the default
anonymous deployment shows no write buttons. The dashboard builder (`get-builder-catalogue`,
`save/list/load/delete-dashboard`) and the language save (`shell_save_settings`) exist only under
`MCP_OAUTH` and while no active module runs read-only; `render-view`, `refresh-view`,
`get-framework-manifest` and the settings page (`shell_show_settings`) are always there.

## Configuration

The most common variables. See [Operations](operations.md#environment-variables) for the full reference.

| Variable                                                  | Default                             | Description                                                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                    | `8400`                              | HTTP port the MCP server listens on                                                                                                                                       |
| `MCP_ACTIVE_MODULES`                                      | all, read-only                      | Comma-separated modules (`camunda7,analytics`), each with an optional [toolset](#toolsets) suffix; no suffix = read-only, under OAuth the standard toolset                |
| `MCP_URL`                                                 | —                                   | Public base URL: advertised URLs, OAuth audience, the `Host`/`Origin` accepted (else localhost only), and the origin the views load Geist from (`/fonts/…`)               |
| `MCP_OAUTH`                                               | —                                   | JSON OAuth resource-server config (Keycloak / Auth0) protecting `/mcp`, the only caller identity (per-user settings and dashboards)                                       |
| `CAMUNDA_ALLOW_DEPLOYMENTS`                               | `false`                             | `true` registers `camunda7_create_deployment` under `camunda7:admin`: code execution in the engine JVM; empty = unset, any value but `true`/`false` fails the boot        |
| `CAMUNDA_BASE_URL`                                        | `http://localhost:8410/engine-rest` | Single-engine REST base URL                                                                                                                                               |
| `CAMUNDA_ENGINE_ID`                                       | `default`                           | Id of that engine; must match the engine's `ENGINE_ID` or its analytics stay empty                                                                                        |
| `CAMUNDA_ENGINE_FLAVOR`                                   | `camunda7`                          | Vendor of that engine (`cibseven`, `operaton` or `camunda7`): picks its cockpit links and product name                                                                    |
| `CAMUNDA_ENGINES_JSON` / `CAMUNDA_ENGINES_FILE`           | —                                   | Register multiple engines (see [Multi-engine](#multi-engine))                                                                                                             |
| `CAMUNDA_COCKPIT_URL`                                     | derived                             | Cockpit web base for jump-out links                                                                                                                                       |
| `CAMUNDA_AUTH_TYPE`                                       | `none`                              | `basic`, `bearer`, `passthrough`, or `none`: fallback for engines without an `auth`                                                                                       |
| `CAMUNDA_USERNAME` / `CAMUNDA_PASSWORD` / `CAMUNDA_TOKEN` | —                                   | Credentials for `basic`/`bearer`; `passthrough` forwards each caller's bearer token (trusted single-audience setups only: the engine could replay it against this server) |
| `PROMETHEUS_URL`                                          | `http://localhost:9090`             | Prometheus HTTP API, the analytics data source                                                                                                                            |
| `PROMETHEUS_BEARER_TOKEN` / `…_USERNAME` / `…_PASSWORD`   | —                                   | Prometheus auth, bearer or basic (URL userinfo works too); `PROMETHEUS_HEADERS` adds JSON headers such as a tenant id                                                     |
| `ANALYTICS_ENGINE_IDS`                                    | —                                   | Engines analytics may read when camunda7 is inactive (comma-separated `engine_id`s); otherwise camunda7's configured engines scope analytics. Neither: analytics refuses  |
| `CAMUNDA_REQUEST_TIMEOUT_MS` / `PROMETHEUS_TIMEOUT_MS`    | `30000`                             | Per-request deadline in ms for engine / Prometheus calls; a hung upstream fails the tool call with a timeout error                                                        |

### Multi-engine

The server can route to several engines: CIB seven, Operaton and Camunda 7 mixed in one fleet.
Tag each engine in its metrics plugin
(`ENGINE_ID`), register them in the server (`CAMUNDA_ENGINES_JSON` / `CAMUNDA_ENGINES_FILE`;
`ENGINE_ID` must match the registered `id`, or that engine's analytics come back empty), and the
host discovers them via `camunda7_list_engines` (read-only); `camunda7_select_engine` saves an
engine as the caller's default (a per-user profile setting, so it needs `MCP_OAUTH` identity and a
toolset that allows writes). Every operations tool also accepts a per-call `engine` override
(advertised as an enum of the configured ids), which works without any identity. Analytics tools
take an optional `engine` filter to aggregate or compare. The server `instructions` state the
routing rule once for every tool. Each engine entry may carry its own `auth`
(`{type, username?, password?, token?}`); entries without one use the global `CAMUNDA_*` settings.
Entries may also declare their vendor via `flavor` (`cibseven` | `operaton` | `camunda7`, default
`camunda7`; the single-engine shorthand takes `CAMUNDA_ENGINE_FLAVOR`), which selects the engine's
cockpit-link routes and display name.

With several engines, the cockpit landing lists every engine with its live health in words (open
incidents, empty, unreachable, loading), read from the engine itself. The cross-engine view (process
landscape plus fleet-wide failure and performance analyses) needs the analytics module; without it
(e.g. `MCP_ACTIVE_MODULES=camunda7` where no Prometheus exists) the cockpit does not offer it.

Fleets that span several environments (each environment hosting some services with an engine)
group their engines per environment: the cockpit landing lists the engines under their
environment, the engine switcher, the settings page and `camunda7_list_engines` group them by
environment, and every engine view names the environment as a chip ("PROD") next to the engine,
write confirmations included. Either write the
engines JSON as a map keyed by environment id, or tag entries individually:

```json
{
  "prod-eu": [{ "id": "prod-a", "baseUrl": "http://engine-a:8410/engine-rest" }],
  "prod-us": [{ "id": "prod-b", "baseUrl": "http://engine-b:8410/engine-rest" }]
}
```

Engine ids stay globally unique across environments: the id remains the `ENGINE_ID` metrics
join key and the per-call `engine` selector; the environment is a grouping level only.
Full walkthrough in [Operations](operations.md).

## Engine metrics plugin

The analytics module needs `camunda_*` series in Prometheus. The Kotlin plugin in
[`engine-plugins/`](https://github.com/Miragon/pulse/tree/main/engine-plugins) records them as Micrometer meters from inside the CIB seven
runtime, with no engine-side database; export via Micrometer's OTLP registry (the playground default),
an Actuator Prometheus scrape, or the OTEL Java agent's Micrometer bridge. It publishes to Maven Central as
`io.miragon.mcp:cibseven-history-metrics`. See [`engine-plugins/README.md`](https://github.com/Miragon/pulse/blob/main/engine-plugins/README.md)
and the runnable [`playground/cibseven-example/`](https://github.com/Miragon/pulse/tree/main/playground/cibseven-example).
