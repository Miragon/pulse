# Architecture

The CLI speaks to an engine through a port. Each engine has its own adapter behind that port.
Today every adapter passes straight through to the Camunda 7 REST API. When an engine diverges,
only its adapter changes.

```mermaid
flowchart TB
  workflow["src/workflow<br/>advance, inspect, retry …"]
  core["@miragon/pulse-c7-core<br/>the c7 family's core: workflow domain, engine REST rules<br/>and engine-contract's root-cause rule, bundled"]
  operation["src/operation<br/>dates, --var typing"]
  cli["src/cli<br/>commands, help, describe"]
  port["src/engine-port<br/>EnginePort, EngineAdapter"]
  subgraph engines["src/engines"]
    operaton["operaton/adapter.ts"]
    cibseven["cibseven/adapter.ts"]
    camunda7["camunda7/adapter.ts"]
  end
  api["src/api/camunda7-rest<br/>catalog + engine port"]
  rest["Operaton · CIB seven · Camunda 7<br/>/engine-rest"]
  workflow -- knows only --> port
  workflow -- renders --> core
  operation -- reads dates, types values --> core
  cli -- selected adapter --> engines
  engines -. implements .-> port
  engines -- uses --> api
  api -- HTTP --> rest
```

## Layers

| Folder            | What it holds                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/engine-port` | What the CLI needs from an engine: `EnginePort` and `EngineAdapter`. Types only                                          |
| `src/engines`     | One adapter per engine: `operaton`, `cibseven`, `camunda7`                                                               |
| `src/api`         | One folder per engine API. `camunda7-rest` builds catalog and port                                                       |
| `src/workflow`    | The workflow commands. They know the port, never an adapter or an API                                                    |
| c7-core           | `packages/connectors/c7/c7-core`, the Camunda 7 REST family's core: selection, inspect, status, plans, engine REST rules |
| `src/cli`         | Selects the adapter and registers its commands                                                                           |

dependency-cruiser enforces the boundaries (`pnpm lint:architecture && pnpm lint:architecture:cli`):

- `workflow` imports `engine-port` and `@miragon/pulse-c7-core`, never `engines` or `api`.
  It turns the package's steps and reasons into the command lines and errors the CLI prints.
  Only `operation/dates.ts` and `operation/variables.ts` also import c7-core, for its rules.
- Only `engines/<name>/adapter.ts` imports `api`.
- Adapters do not import each other. An API does not import another API.
- `engine-port` imports types only. `api`, `engine-port` and `engines` use no Node built-ins.
- Only the adapters and `src/catalog/catalog.ts` read the generated catalog.

## From spec to request

The commands are data. A generator turns the OpenAPI spec into one catalog that every engine
shares. The selected adapter hands it to the CLI, which registers commands, help and `describe` from
it and sends requests over HTTP.

```mermaid
flowchart LR
  spec["spec/camunda7-rest<br/>api.json + patches.json"] --> gen["pnpm catalog<br/>scripts/catalog"]
  gen --> catalog["src/generated<br/>catalog.json"]
  catalog -- loaded by --> adapter["src/engines/&lt;engine&gt;/adapter.ts"]
  adapter --> cli["src/cli<br/>commands, help, describe"]
  cli --> http["operation + http<br/>request, auth, errors"]
  http -- HTTP --> engine["Engine<br/>/engine-rest"]
```

## Selecting the engine

`run.ts` picks the adapter before it registers a single command. Only then do commands, help and
`describe` match the catalog of that engine.

```mermaid
flowchart LR
  argv["--flavor"] --> pick{first set}
  env["PULSE_CLI_FLAVOR"] --> pick
  profile["profile.flavor"] --> pick
  pick -- none --> default["camunda7"]
  pick --> adapter["ENGINES[flavor]"]
  default --> adapter
  adapter --> program["createProgram: commands, help, describe"]
```

A config file that cannot be read does not stop the selection: the CLI falls back to `camunda7`,
and the command reports the problem when it reads its configuration.

## A workflow command

```mermaid
sequenceDiagram
  participant W as workflow (retry)
  participant P as EnginePort
  participant A as camunda7-rest
  participant E as Engine
  W->>P: call("setJobRetries", input)
  P->>A: same call (adapter passes through)
  A->>E: PUT /job/{id}/retries
  E-->>W: result or engine error
```

The decisions behind this: [Architecture decisions](adr/).
