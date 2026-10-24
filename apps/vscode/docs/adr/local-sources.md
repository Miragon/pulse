# Local sources: model and code next to the runtime

- Status: accepted
- Last reviewed: 2026-10-22

## Context

When an instance is stuck on an incident, the next questions are "what is configured on
this element?" and "where is the code that ran?" (Miragon/pulse-vscode#2). A
standalone cockpit cannot answer them; an IDE can, because the `.bpmn` file and the
workers are in the workspace. The configuration is vendor vocabulary (`camunda:topic`,
`camunda:delegateExpression`, `zeebe:taskDefinition`, `camunda:inputOutput`,
`zeebe:ioMapping`), so it must stay out of the contract, the core and the webview, and
Pulse must keep working without the Miragon BPMN modeler.

Libraries considered:

- The bpmn-modeler libraries that read implementations (`@miragon/bpmn-modeler-code-link`,
  `-types`, `-core`) are private workspace packages, not on npm.
- `@miragon/bpmn-cli` 0.8.0 reads implementations in Node, but brings 5.5 MB with resvg
  wasm, bpmnlint and commander for one function.
- `bpmn-moddle` with the vendor descriptors `camunda-bpmn-moddle` and `zeebe-bpmn-moddle`
  is what the bpmn-modeler itself parses with on the extension host: pure JavaScript, no
  DOM, about 1 MB unpacked, and `bpmn-moddle` 10.3.1 is already installed for bpmn-js.

## Decision

### Two ports and one seam in the contract

`apps/vscode/src/contract/model/local-sources.ts` holds the neutral read models,
`src/ports/` the ports:

| Port             | Method                                    | Answer                                                                                                  |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ModelSource`    | `modelOf(bpmnProcessId)`                  | The local `ModelFile` (`uri`, `fileName`, `bpmnProcessId`, `xml`) that declares the process, or nothing |
| `ModelSource`    | `elementIn(model, elementId)`             | `ModelElement`: its `SourceLocation` (`uri`, 1-based `line`) and its `ElementConfiguration`, or nothing |
| `CodeLocator`    | `locate(implementation)`                  | The `SourceLocation` of the code that implements an `ElementImplementation`, or nothing                 |
| `WorkspaceFiles` | `find(glob, limit)`, `read(uri)` (a seam) | The workspace's files; the extension implements it with `vscode.workspace`, tests with an in-memory map |

`ElementConfiguration` has an optional `implementation` (`workerTask` with its
`taskType`, `class`, `delegate` or `expression`), `inputs` and `outputs`
(`VariableMapping`: `target`, optional `source`) and `errors` (`ErrorReference`: `code`,
`name`). `workerTask` and `taskType` are the words `WaitState` already uses for a topic or
a job type. These ports are no engine questions, so the conformance kit does not cover
them.

### One adapter package: `apps/vscode/src/model`

The only package with the moddle libraries (and, should they be published one day, the
bpmn-modeler libraries). It is not called `adapter-*`, because every `adapter-*` package
must pass the engine conformance kit.

- `BpmnModelSource` finds `**/*.bpmn` (at most 500, sorted by path), skips files that do not
  mention the process id, and confirms the id with moddle. It parses a Camunda 8 file
  (zeebe namespace) with the zeebe descriptor and every other file with the camunda one:
  one moddle instance with both descriptors drops the processes of a file. It reads the
  implementation in the order of bpmn-modeler's code link (class, delegate expression,
  expression, external topic, zeebe job type), the camunda `inputOutput` or zeebe
  `ioMapping`, and the errors of the error boundary events attached to the element plus
  its `camunda:errorEventDefinition`s.
- `WorkspaceCodeLocator` follows bpmn-modeler's `ImplementationLocator`: a class by its
  qualified name as a path (`**/io/shop/Charge.{java,kt,groovy,scala}`, the outer class of a
  nested one); a delegate or expression by its bean (`${svc.run()}` → `Svc.java`, else
  `@Component("svc")` and its kin); a worker task by its task type as a quoted literal, first on a line that subscribes (`@ExternalTaskSubscription`, `@JobWorker`, `subscribe(`, `jobType(` …) so a constants class does not win, then anywhere, in
  `*.{java,kt,groovy,scala,js,ts}`, outside comment lines, at most 5 000 files, main
  sources before test sources.

Only the composition root constructs the adapter (`CompositionRoot.localSources(files)`).
A class lands on its declaration (`class`, `interface`, `enum`, `record` or `object` and the
simple name), else on the first line. The stack trace document reuses the `CodeLocator`: its
`DocumentLinkProvider` links the thrown classes and the classes of application frames to their
declaration. VS Code links stack traces only in the terminal and the debug console, not in a
document, and a language server's workspace symbols would make the links depend on the Java
extension.
The `operaton:` namespace is not read yet.

### Core, protocol and webview

`PanelContext.sources` is optional. Without it, or when a lookup fails, the panels show
what they showed before. `ModelLinks` resolves, per incident, the model of the incident's
own process (`incident.definition.bpmnProcessId`, so an incident in a called instance
looks into the called process), the element, its code and whether the local XML matches
the deployed XML of that version (`ModelXml.same`, the normalisation of the drift check).
The definition panel resolves the same link for the element its list is filtered by (a
click on a shape), and only the model file without one. The instance panel does the same
for the element clicked in its diagram (`selectElement`, kept by `SelectedElement` outside
the snapshot, so a refresh keeps it). The snapshot keeps the result;
intents carry no locations: `openModel` and `openCode` with an `incidentId` from an
incident card, `openModel` with the filtered `elementId` from the definition header
(without one the whole file; the instance panel opens the model only from an incident),
`openCode` with the `elementId` of the shape's code button, which only
follows a link already resolved for that element (an incident's or the selection's).

`IncidentRow.model` (`ModelFacts`: file name, label/value settings, `differsFromDeployed`,
`codeLabel`) and `DefinitionView.model` / `InstanceView.model` (file name and the `code` label of the
filtered or selected element, with its id) carry what the webview shows. The webview renders
"Task type" (left out when it repeats the job's type), "Class", "Delegate", "Expression", "Input", "Output", "Error" and "Model" facts
and the buttons _Open in model_ and _Open code_ only when they are present.

### Opening

`PanelEffects.openModel(location, elementId?)` and `openSource(location)` are implemented
by `SourceNavigation` in the extension:

Everything opens as a tab in the panel's own editor group, over the panel, never in a split.

- With an element and the bpmn-modeler installed (an extension contributes the command
  `bpmn-modeler.focusLintElement`), Pulse opens the file with the modeler's editor
  (`vscode.openWith`, `bpmn-modeler.bpmn`) and then calls `focusLintElement(uri, elementId)`,
  which centres the element; the modeler does not select it. The check reads the
  contributions, not the registered commands, because the modeler registers its commands
  only once it has activated.
- Otherwise the file opens as text at the element's line. Without an element, `vscode.open`
  uses the file's default editor.
- Code opens as text at its line.

The extension declares no `extensionDependencies` (`manifest.test.ts` checks it).

## Consequences

- dependency-cruiser's `model-libraries-stay-in-the-model-adapter` refuses
  `bpmn-moddle`, its descriptors and `@miragon/bpmn-modeler*` outside
  `apps/vscode/src/model`; a planted import in the tree
  `apps/vscode/test/architecture/dependency-rules.test.ts` builds proves it bites. The cruiser no
  longer excludes every `dist/` folder, only our own build output, because libraries such as
  `bpmn-moddle` resolve into `node_modules/<lib>/dist/` and were invisible to every rule.
- `focusLintElement` is an internal command of the bpmn-modeler, meant for its lint links.
  If it disappears or fails, Pulse falls back to the text editor; a public "reveal element"
  command upstream would make this sturdier.
- The code lookup is a text search, like the modeler's: a task type that also appears in an
  unrelated string can point at the wrong file. It never runs without an incident and stops
  after 5 000 files.
