# Upgrading

What changes between releases that needs your hand: settings, tool names and metric names.

## Renamed from camunda7 to engine (0.25)

The module that talks to the engine served one REST API that three vendors implement (Camunda 7,
CIB seven, Operaton), but its name named one of them. From 0.25 on it is the `engine` module: its
tools, settings, packages and metric names follow. Values stay as they are, and the vendor setting
`flavor` keeps `camunda7` for Camunda 7. The boot refuses a retired setting and names its
replacement, so a server with old settings never starts without the engine or ignores a setting.
Upgrade the metrics plugin and the server in the same release (or bridge, see below). The image
`ghcr.io/miragon/pulse-server`, the CLI and the VS Code extension keep their names and settings.

### Environment variables

| Retired                                | Replacement                           |
| -------------------------------------- | ------------------------------------- |
| `CAMUNDA_ENGINES_FILE`                 | `ENGINES_FILE`                        |
| `CAMUNDA_ENGINES_JSON`                 | `ENGINES_JSON`                        |
| `CAMUNDA_BASE_URL`                     | `ENGINE_BASE_URL`                     |
| `CAMUNDA_ENGINE_ID`                    | `ENGINE_ID`                           |
| `CAMUNDA_ENGINE_FLAVOR`                | `ENGINE_FLAVOR`                       |
| `CAMUNDA_DEFAULT_ENGINE`               | `ENGINE_DEFAULT`                      |
| `CAMUNDA_COCKPIT_URL`                  | `ENGINE_COCKPIT_URL`                  |
| `CAMUNDA_AUTH_TYPE`                    | `ENGINE_AUTH_TYPE`                    |
| `CAMUNDA_USERNAME`                     | `ENGINE_USERNAME`                     |
| `CAMUNDA_PASSWORD`                     | `ENGINE_PASSWORD`                     |
| `CAMUNDA_TOKEN`                        | `ENGINE_TOKEN`                        |
| `CAMUNDA_INCIDENT_ISSUE_REPO`          | `ENGINE_INCIDENT_ISSUE_REPO`          |
| `CAMUNDA_HEALTH_CRITICAL_INCIDENTS`    | `ENGINE_HEALTH_CRITICAL_INCIDENTS`    |
| `CAMUNDA_HEALTH_CRITICAL_CLUSTER_SIZE` | `ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE` |
| `CAMUNDA_ALLOW_DEPLOYMENTS`            | `ENGINE_ALLOW_DEPLOYMENTS`            |
| `CAMUNDA_REQUEST_TIMEOUT_MS`           | `ENGINE_REQUEST_TIMEOUT_MS`           |

Check every source of the server's environment, secrets and your shell included: one old name
stops the boot. The credentials `CAMUNDA_USERNAME`, `CAMUNDA_PASSWORD` and `CAMUNDA_TOKEN` only
log a warning (a shell may export them for the CLI); a missing new credential fails the auth check.

### Module, toolsets and tools

In `MCP_ACTIVE_MODULES` the module is `engine`, the toolsets keep their names. Every tool keeps the
rest of its name after the new prefix; two collapse a doubled word:

```text
MCP_ACTIVE_MODULES=camunda7:operations,analytics  ->  MCP_ACTIVE_MODULES=engine:operations,analytics
camunda7_<name>                                   ->  engine_<name>
camunda7_open_cockpit                             ->  engine_open_cockpit
camunda7_engine_status                            ->  engine_status
camunda7_engine_health_data                       ->  engine_health_data
mcp__pulse__camunda7_*                            ->  mcp__pulse__engine_*
```

Every allowlist, hook, gateway policy or saved approval that names a tool needs the new name.
Widgets of older conversations name `ui://views/camunda7_open_cockpit.html`, which the new server
no longer serves: they no longer render. Ask again and the new view opens.

### Metric names

The plugin `io.miragon.mcp:cibseven-history-metrics` emits every metric under `engine_` (OTel
`engine.`), the rest of each name and every label unchanged; a new server reads only the new names.
A window that starts before the upgrade shows only what came after it. Port your own alert rules
and Grafana panels too: an alert on an old name does not fail, it stops firing (check with
`absent(engine_process_instances_running)`). Until every engine runs the new plugin, this rename in
the scrape job of the engines still on the old one keeps them reporting:

```yaml
metric_relabel_configs:
  - source_labels: [__name__]
    regex: camunda_(.+)
    target_label: __name__
    replacement: engine_$1
```

| Retired                                          | Replacement                                     |
| ------------------------------------------------ | ----------------------------------------------- |
| `camunda_process_instance_started_total`         | `engine_process_instance_started_total`         |
| `camunda_process_instance_ended_total`           | `engine_process_instance_ended_total`           |
| `camunda_process_instance_duration_milliseconds` | `engine_process_instance_duration_milliseconds` |
| `camunda_activity_ended_total`                   | `engine_activity_ended_total`                   |
| `camunda_activity_duration_milliseconds`         | `engine_activity_duration_milliseconds`         |
| `camunda_usertask_created_total`                 | `engine_usertask_created_total`                 |
| `camunda_usertask_completed_total`               | `engine_usertask_completed_total`               |
| `camunda_usertask_duration_milliseconds`         | `engine_usertask_duration_milliseconds`         |
| `camunda_incident_created_total`                 | `engine_incident_created_total`                 |
| `camunda_incident_resolved_total`                | `engine_incident_resolved_total`                |
| `camunda_process_instances_running`              | `engine_process_instances_running`              |
| `camunda_jobs_failed`                            | `engine_jobs_failed`                            |
| `camunda_incidents_open`                         | `engine_incidents_open`                         |
| `camunda_jobs_executable`                        | `engine_jobs_executable`                        |
| `camunda_jobs_suspended`                         | `engine_jobs_suspended`                         |
| `camunda_jobs_due_future`                        | `engine_jobs_due_future`                        |
| `camunda_usertasks_open`                         | `engine_usertasks_open`                         |
| `camunda_process_definitions_deployed`           | `engine_process_definitions_deployed`           |
| `camunda_external_tasks_open`                    | `engine_external_tasks_open`                    |

The server's own `/metrics` labels its tool series with the new tool names (`tool="engine_…"`).

### Packages and your own server

A server built on the published modules (the [pulse-starter](https://github.com/Miragon/pulse-starter)
template) moves to the new packages and exports:

```text
@miragon/pulse-camunda7-client      ->  @miragon/pulse-engine-client
@miragon/pulse-camunda7-connector   ->  @miragon/pulse-engine-connector
camunda7Module, camunda7ConfigSchema, Camunda7PluginConfig, CAMUNDA7_ADMIN_ONLY_TOOLS
                                    ->  engineModule, engineConfigSchema, EnginePluginConfig, ENGINE_ADMIN_ONLY_TOOLS
camunda7Views, CAMUNDA7_HOST_WIDGET_REFS (./widgets)
                                    ->  engineViews, ENGINE_HOST_WIDGET_REFS
createCamunda7Client, Camunda7ClientOptions, Camunda7AuthType
                                    ->  createEngineClient, EngineClientOptions, EngineAuthType
@source "../../node_modules/@miragon/pulse-camunda7-connector/src"   (Tailwind, globals.css)
                                    ->  @source "../../node_modules/@miragon/pulse-engine-connector/src"
bpmnMissing: "no-camunda7"          ->  bpmnMissing: "no-engine-module"  (analytics heatmap result)
apps/mcp-server-camunda7            ->  apps/mcp-server  (this repository)
```

A `setup.ts` that finds the module by name looks for `engineModule.name`. The engine sees the
client's User-Agent as `@miragon/pulse-engine-client/<version>`.
