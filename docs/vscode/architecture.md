# Architecture

The core never knows which engine it talks to: it asks the ports of the engine contract
(`@miragon/pulse-engine-contract`, the shared language of the engine dialects, a package of its
own bundled into the extension), and one adapter per engine family answers. The C7 adapter serves
Operaton, CIB seven and Camunda 7 over their REST API, with the c7 family's core and workflow
domain (`@miragon/pulse-c7-core`, shared with the CLI and the MCP server and bundled into the
extension) for inspecting an instance, and with the contract's rule for the root cause of a
failure (`RootCauses`, which c7-core applies too); a new engine is one more adapter folder, proven
by the contract's conformance kit, and one entry in the composition root.

```mermaid
flowchart LR
  webview["Webview panels (Preact, bpmn-js)"] <--> host["Extension host: wiring, write policy"]
  host --> core["core: panel sessions, view builders"]
  core --> contract["contract: ports and read models"]
  contract -- re-exports --> engineContract["@miragon/pulse-engine-contract"]
  c7["adapter c7"] -. implements .-> contract
  c7 --> engines["Operaton, CIB seven, Camunda 7: /engine-rest"]
  c7 -- bundled --> c7core["c7-core: inspect, wait states"]
```

The extension is one package with six layers under `apps/vscode/src`, each with its own globals
and dependency rules:

| Layer      | Holds                                                   |
| ---------- | ------------------------------------------------------- |
| `contract` | the engine contract re-exported, the ports of the IDE   |
| `core`     | grouping, view models, panel behaviour                  |
| `webview`  | what the panels draw                                    |
| `host`     | the VS Code wiring and the composition root             |
| `adapters` | one folder per engine family (`c7` today)               |
| `model`    | the local `.bpmn` model and the code that implements it |

The webview stays Preact with its own stylesheets. Its tones come from `@miragon/pulse-ui/tones`
and its times, durations, counts and short ids from `@miragon/pulse-ui/format`, the parts of
Pulse's design kit without React, bundled as well: a running, suspended or failing instance shows
in the same tone as in the MCP widgets, and a duration, a lower bound or a long key reads the same.
The extension shares that foundation with the MCP widgets, the words of its counts and the brand
gates, never a component: [Parity with the MCP cockpit](./parity.md) lists what differs and why,
and [#586](https://github.com/Miragon/pulse/issues/586) holds when the two share building blocks.

More in the repository:

- `apps/vscode/docs/architecture-overview.md`: who talks to whom, in pictures
- `apps/vscode/docs/adr/`: the decisions and their reasons (writes, migrations, live updates …),
  the shared UI foundation in `apps/vscode/docs/adr/ui-foundation.md`
- `apps/vscode/CLAUDE.md`: commands and rules for contributors and coding agents
