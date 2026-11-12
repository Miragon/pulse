# Pulse's architecture in pictures

The decisions behind these pictures are in [docs/adr](adr/README.md); this page shows
how the parts fit together.

## 1. Who talks to whom, about what, and how

```mermaid
flowchart TB
  user([Developer])
  subgraph window [VS Code window]
    direction LR
    workbench["Trees, commands, status bar, .bpmn editor"]
    webview["Webview panels: Preact and bpmn-js"]
  end
  subgraph host [Extension host: one Node process]
    extension["extension: wiring, connections, write policy"]
    core["core: panel sessions, view builders"]
    subgraph adapters [Adapters: one per dialect family]
      direction LR
      c7[c7-adapter]
      next["adapter for the next engine"]
    end
  end
  subgraph local [Local state]
    direction TB
    files[("targets file, .bpmn files, settings")]
    secrets[("SecretStorage")]
    audit[("Output: Pulse")]
  end

  c7engines["Operaton, CIB seven, Camunda 7: /engine-rest"]
  webui["Cockpit in the browser"]

  user --> workbench & webview
  workbench <-- "1: tree items, commands" --> extension
  webview <== "2: intents out, state in" ==> extension
  extension -- "7: targets, models, frames" --> files
  extension -- "8: credentials" --> secrets
  extension -- "9: one line per write" --> audit
  extension <-- "3: intent in, host actions out" --> core
  extension -- "5: a target becomes runtime, commands, web UI" --> adapters
  extension -. "10: web UI link" .-> webui
  core -- "4: questions and writes, read models back" --> adapters
  c7 -. "6: REST JSON" .-> c7engines
  c7 ~~~ webui
  classDef planned stroke-dasharray: 5 5
  class next planned
```

Thin lines are calls inside a process (the VS Code API or a port), thick lines are
messages to another process, dotted lines leave the machine. The dashed box is where the
next engine plugs in: one more adapter package and one entry in the composition root.

| #   | Who → whom                      | About what                                                                                                                | How                                                                                                                      |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | VS Code ⇄ extension             | engines and processes in the trees, commands, the status bar, the `.bpmn` file in the editor                              | VS Code API (`TreeDataProvider`, commands)                                                                               |
| 2   | webview ⇄ extension             | intents out (`ready`, `filterInstances`, `openCall`, `retryIncident`, …); the complete panel state with a revision back   | `postMessage`, JSON, checked by `MessageGuards`; the webview drops stale revisions                                       |
| 3   | extension ⇄ core                | the intent for a panel session; host actions back: open a panel, pick an instance, confirm a write, copy, open the web UI | method calls: `Panel.handle`, `PanelEffects`                                                                             |
| 4   | core → adapter                  | engine questions and writes; read models back, or a `RuntimeError`                                                        | the ports `ProcessRuntime` and `ProcessCommands`, async                                                                  |
| 5   | extension → adapter             | a configured target becomes a runtime, commands (wrapped in the audit) and web UI links                                   | `EngineAdapter`, only in `composition-root.ts`                                                                           |
| 6   | c7-adapter → C7 family          | definitions, instances, incidents, variables; retries and variable changes                                                | HTTP(S) REST `/engine-rest` through `@miragon/pulse-http` over VS Code's `fetch`, basic auth; no redirects, 60 s, 64 MiB |
| 7   | extension → your files          | the engines to show, the model to compare with a deployed version, stack frames to link to your sources                   | `.pulse.json` (watched), `.bpmn` files, `pulse.*` settings                                                               |
| 8   | extension → SecretStorage       | user name and password per target, bound to the endpoint's origin                                                         | VS Code `SecretStorage`                                                                                                  |
| 9   | extension → output channel      | one audit line per confirmation and per write, without values                                                             | the "Pulse" output channel                                                                                               |
| 10  | extension → the engine's web UI | the shown version or instance, or the engine's start page                                                                 | `vscode.env.openExternal` with a URL built from the target's `cockpitUrl`                                                |

Pulse reads what an engine is running and shows it next to the models. Writes
(retry an incident, change a variable) are guarded and audited
([writes.md](adr/writes.md)). Each package has a README with its own picture:
[engine contract](../../../packages/connectors/engine/engine-core/README.md), [ports](../../../packages/core/runtime-view/src/ports/README.md), [core](../../../packages/core/runtime-view/src/core/README.md),
[webview](../../../packages/core/runtime-view/src/webview/README.md), [extension](../src/host/README.md),
[c7-adapter](../../../packages/connectors/c7/c7-adapter/src/README.md).

## 2. Ports and adapters

The core never knows which engine it talks to. It calls the ports of the contract; an
adapter per dialect family implements them.

```mermaid
flowchart LR
  subgraph driving [Driving side]
    ui[VS Code UI: trees, commands, status bar]
    webview[Webview: Preact and bpmn-js]
  end
  subgraph neutral [Engine-neutral]
    extension[extension: composition root, connections, panel hosts]
    core[core: panels, views, drift]
    subgraph ports [ports: engine-core and the runtime view's ports]
      adapterPort{{EngineAdapter: connect}}
      runtime{{ProcessRuntime: read}}
      commands{{ProcessCommands: write}}
    end
  end
  subgraph driven [Driven side: classes that implement the ports]
    next["adapter for the next engine"]
    c7Adapter[c7-adapter: C7Adapter]
    c7Commands[c7-adapter: C7ProcessCommands]
    fake[engine-core testing: FakeEngine]
    c7Runtime[c7-adapter: C7ProcessRuntime]
  end

  ui --> extension
  webview <-- intents in, state out --> core
  extension --> core
  extension -- one adapter per engine kind --> adapterPort
  core --> runtime
  core --> commands
  adapterPort -.-> c7Adapter & next
  commands -.-> c7Commands & fake
  runtime -.-> fake & c7Runtime
  classDef planned stroke-dasharray: 5 5
  class next planned
```

- **Contract:** the engine's ports are interfaces of the engine contract
  (`packages/connectors/engine/engine-core/src/ports`, the engine family's core
  `@miragon/pulse-engine-core`); what they exchange are read models
  (`packages/connectors/engine/engine-core/src/model`). The runtime view
  (`packages/core/runtime-view`) imports them directly; its `src/ports` holds `EngineAdapter` and
  the local ports. No engine word appears in them.
- **Adapters:** a class per role (`C7ProcessRuntime implements ProcessRuntime`, …). The
  composition root picks the adapter by the target's `engine` and is the only place that
  does.
- **Core:** panel sessions and view builders work on read models only; the webview
  renders the view models the core sends.

## 3. Packages and the imports they may make

```mermaid
flowchart TB
  extension --> core
  extension --> hostKit[host-kit]
  extension --> ports[ports]
  extension -- bundled --> engineCore["@miragon/pulse-engine-core"]
  extension -- composition root only --> adapterC7[c7-adapter]
  hostKit -- connections only, bundled --> profile["@miragon/pulse-profile"]
  hostKit --> core
  ports --> engineCore
  core --> ports
  core --> engineCore
  webview -- types only --> protocol[core/protocol]
  adapterC7 --> ports
  adapterC7 --> engineCore
  adapterC7 -- bundled --> c7Core["@miragon/pulse-c7-core"]
  core -- bundled --> tones["@miragon/pulse-ui/tones"]
  webview -- bundled --> tones
  core -- bundled --> format["@miragon/pulse-ui/format"]
  webview -- bundled --> format
  webview -- shared building blocks, through preact/compat --> kit["@miragon/pulse-ui and its theme.css"]
```

Every import edge not drawn fails the closed world of its package (dependency-cruiser:
`pnpm lint:architecture:vscode`, `:runtime-view`, `:c7-adapter`). The layers live in the
runtime view (`packages/core/runtime-view`) and the C7 adapter
(`packages/connectors/c7/c7-adapter`), which Pulse for Orca hosts too, and esbuild
bundles each workspace package that reaches the extension. engine-core, the core of the engine
family, holds the contract every engine dialect implements, the language they answer in, and is
the runtime view's one contract: its ports, core, model reader and host kit, the adapter and the
host import its main entry (its kit and fake only in tests and the dev hosts). c7-core is the core
of the Camunda 7 REST dialect family c7, the workflow domain the CLI and the MCP server run too:
only the C7 adapter imports it. `@miragon/pulse-profile` is Pulse's profile format, which the CLI
reads its files with too: only the host kit's connections import it, through its main entry, to
read `.pulse.json`. `@miragon/pulse-ui/tones` and `@miragon/pulse-ui/format` are
Pulse's UI foundation without React: the tone vocabulary and the one tone per situation, and the
formatters for times, durations, counts and short ids, both as the MCP widgets show them. The
core and the webview may import the tones, only their label helpers the formatters (they set the
locale). The webview alone may also import pulse-ui's React kit and its `theme.css`, for the
building blocks the surfaces share, which it renders through `preact/compat`; the core, the ports,
the model reader and the host kit import nothing else of pulse-ui
(`apps/vscode/docs/adr/ui-foundation.md`).

## 4. One adapter for Operaton, CIB seven and Camunda 7

Operaton and CIB seven are forks of Camunda 7 and keep its REST API. So one adapter
serves all three, and the conformance kit proves it on Operaton and CIB seven in CI (Camunda 7
passed on 7.24.0 until its image left Docker Hub in November 2026). Camunda 8 is a
different engine (Zeebe) with a different API, so it would get an adapter of its own.

```mermaid
flowchart LR
  subgraph adapter [c7-adapter]
    readers[Readers: C7 answers to contract read models]
    rest[src/engine-rest: REST calls, answers checked]
  end
  core["c7-core: inspect, wait states"]
  rules["@miragon/pulse-engine-core: RootCauses"]
  subgraph family [Same REST API]
    camunda7[Camunda 7.24]
    operaton[Operaton 2.1]
    cibseven[CIB seven 2.2]
  end
  readers --> rest
  readers -- root cause --> rules
  rest -- its port over EngineHttp --> core
  rest -- HTTP /engine-rest --> family
```

| Question                             | Answer                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the C7 adapter cover all three? | Yes: all 48 read laws and 15 command laws pass on Operaton 2.1.5 and CIB seven 2.2.0; Camunda 7.24.0 passed until its image left Docker Hub |
| Do we need an adapter per fork?      | No, only per API family                                                                                                                     |
| What does a new dialect family need? | A package `packages/connectors/<family>/<family>-adapter` with an `EngineAdapter`, its conformance test, one entry in each composition root |
| Where does Camunda 8 stand?          | Not included. The spike built a C8 adapter on REST v2 against an API mock, then removed it to keep the prototype small                      |

## 5. Reading an instance

```mermaid
sequenceDiagram
  actor user as User
  participant host as extension
  participant panel as core: InstancePanel
  participant runtime as ProcessRuntime (C7ProcessRuntime)
  participant engine as Engine REST
  participant view as Webview

  user->>host: Go to Process Instance… ORD-10144
  host->>panel: open the panel for the instance
  view->>panel: intent "ready"
  panel->>runtime: getInstanceDetail(id)
  runtime->>engine: GET process instance, incidents, variables …
  engine-->>runtime: JSON
  runtime-->>panel: InstanceDetail (read model)
  panel->>panel: build the view model
  panel-->>view: state, revision n
  view->>view: draw diagram, badges, tabs
```

## 6. Retrying an incident

```mermaid
sequenceDiagram
  actor user as User
  participant view as Webview
  participant panel as core: InstancePanel
  participant host as extension: write policy, dialog, audit
  participant commands as ProcessCommands

  user->>view: Retry
  view->>panel: intent retryIncident(incidentId)
  panel->>panel: resolve against the shown snapshot
  panel->>host: confirm the write
  host->>user: dialog by environment (none, modal, type the host)
  user-->>host: confirm
  host-->>panel: confirmed
  host->>host: audit line for the answer
  panel->>host: retryIncident(id) through the audited commands
  host->>commands: retryIncident(id)
  commands-->>host: done, or RuntimeError "rejected"
  host->>host: audit line with the result, without values
  host-->>panel: done or the error
  panel-->>view: state: retried, checking again for a minute
```

## 7. How every adapter is proven

```mermaid
flowchart LR
  kit[ConformanceKit: 48 read laws, 15 command laws]
  kit --> fake[FakeEngine in memory]
  kit --> c7[C7Adapter on Operaton and CIB seven in containers]
  saboteurs[Saboteurs: broken runtimes] -- each must fail its law --> kit
```

The same executable laws run against every implementation. A saboteur breaks one
behaviour on purpose; the kit has to catch it, so a law that passes everything would
show up.

## 8. Inside a package

Classes implement the ports and keep their helpers private; one class per file.
[code-structure.md](adr/code-structure.md) has the rules and a class diagram of how the
C7 adapter reads an instance.
