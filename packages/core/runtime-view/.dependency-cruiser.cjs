const PACKAGE = "^packages/core/runtime-view/"
const TEST_CODE = `[.]test[.](tsx?|cjs)$|${PACKAGE}test/`
const TOOLING = `${PACKAGE}(scripts|dev)/`
const PORTS_ENTRY = `${PACKAGE}src/ports/index[.]ts$`
const CORE_ENTRY = `${PACKAGE}src/core/index[.]ts$`
const PROTOCOL_ENTRY = `${PACKAGE}src/core/protocol/index[.]ts$`
const ENGINE_CORE_ENTRY = "(^|/)node_modules/@miragon/pulse-engine-core/dist/index[.]d[.]ts$"
const ENGINE_CORE_TREE = "^packages/connectors/engine/engine-core/"
const PROFILE_ENTRY = "(^|/)node_modules/@miragon/pulse-profile/dist/index[.]d[.]ts$"
const PULSE_UI = "(^|/)node_modules/@miragon/pulse-ui/|^@miragon/pulse-ui(/|$)|^packages/core/ui/"
const UI_FOUNDATION =
  "(^|/)node_modules/@miragon/pulse-ui/dist/(format|tones)/|^@miragon/pulse-ui/(format|tones)$"
const UI_TONES_ENTRY = "(^|/)node_modules/@miragon/pulse-ui/dist/tones/index[.]d[.]ts$"
const UI_FORMAT_ENTRY = "(^|/)node_modules/@miragon/pulse-ui/dist/format/index[.]d[.]ts$"
const LABEL_HELPERS = `${PACKAGE}src/(core/views/labels[.]ts$|webview/format/)`
const DIALECT_PACKAGES =
  "(^|/)node_modules/@miragon/pulse-(?!engine-core/)[^/]+-(core|client|connector|adapter)/|^@miragon/pulse-(?!engine-core(/|$))[^/]+-(core|client|connector|adapter)(/|$)|^packages/connectors/(?!engine/engine-core/)"
const WEBVIEW_LIBRARIES =
  "(^|/)node_modules/(preact|bpmn-js|diagram-js|@miragon/modeler-shell|@fontsource-variable/[^/]+)/"
const MODEL_ADAPTER = `${PACKAGE}src/model/`
const MODEL_LIBRARIES =
  "(^|/)node_modules/(bpmn-moddle|camunda-bpmn-moddle|zeebe-bpmn-moddle|@miragon/bpmn-modeler[^/]*)/|^(bpmn-moddle|camunda-bpmn-moddle|zeebe-bpmn-moddle|@miragon/bpmn-modeler[^/]*)(/|$)"

module.exports = {
  allowedSeverity: "error",
  allowed: [
    {
      comment: "A layer may use its own modules.",
      from: { path: `${PACKAGE}src/(ports|core|webview|model|host-kit)/` },
      to: { path: `${PACKAGE}src/$1/` },
    },
    {
      comment: "Tests and tooling may use anything.",
      from: { path: [TEST_CODE, TOOLING] },
      to: {},
    },
    {
      comment:
        "The ports, the core, the model adapter and the host kit speak the engine contract of @miragon/pulse-engine-core, the neutral core of the engine family (its main entry: the ports, read models and failure kinds every dialect answers in), which the editor hosts bundle with esbuild.",
      from: { path: `${PACKAGE}src/(ports|core|model|host-kit)/` },
      to: { path: ENGINE_CORE_ENTRY },
    },
    {
      comment: "The core depends on the ports.",
      from: { path: `${PACKAGE}src/core/` },
      to: { path: PORTS_ENTRY },
    },
    {
      comment: "The model adapter depends on the ports and reads models with the moddle libraries.",
      from: { path: `${PACKAGE}src/model/` },
      to: { path: [PORTS_ENTRY, MODEL_LIBRARIES] },
    },
    {
      comment: "The webview renders protocol view models and nothing else of ours.",
      from: { path: `${PACKAGE}src/webview/` },
      to: { path: PROTOCOL_ENTRY, dependencyTypes: ["type-only"] },
    },
    {
      comment:
        "The core and the webview read Pulse's tones (@miragon/pulse-ui/tones: framework-free, it imports nothing), which the editor hosts bundle with esbuild.",
      from: { path: `${PACKAGE}src/(core|webview)/` },
      to: { path: UI_TONES_ENTRY },
    },
    {
      comment:
        "Only the label helpers read Pulse's formatters (@miragon/pulse-ui/format: framework-free, it imports nothing): Labels in the core and the webview's format folder set their locale before they format, so no output depends on the machine's.",
      from: { path: LABEL_HELPERS },
      to: { path: UI_FORMAT_ENTRY },
    },
    {
      comment: "The webview may use its rendering libraries.",
      from: { path: `${PACKAGE}src/webview/` },
      to: { path: WEBVIEW_LIBRARIES },
    },
    {
      comment:
        "The host kit holds the rules every editor host shares over the core, the protocol and the ports.",
      from: { path: `${PACKAGE}src/host-kit/` },
      to: { path: [CORE_ENTRY, PROTOCOL_ENTRY, PORTS_ENTRY] },
    },
    {
      comment:
        "The host kit's connections read the project files with Pulse's profile format (@miragon/pulse-profile, its main entry: the parser, the surface rules and the wording, no runtime dependency), which the editor hosts bundle with esbuild.",
      from: { path: `${PACKAGE}src/host-kit/connections/` },
      to: { path: PROFILE_ENTRY },
    },
    {
      comment: "The host kit runs in a host's Node and may use Node built-ins.",
      from: { path: `${PACKAGE}src/host-kit/` },
      to: { dependencyTypes: ["core"] },
    },
  ],
  forbidden: [
    {
      name: "not-in-allowed",
      severity: "error",
      comment:
        "No entry of `allowed` in packages/core/runtime-view/.dependency-cruiser.cjs permits this import. Move the code to the layer that may make it (table 'Where code goes' in apps/vscode/CLAUDE.md). A layer uses its own modules and another layer only through its index.ts: the ports, the core, the model adapter and the host kit speak the main entry of @miragon/pulse-engine-core, the engine family's neutral core (never ./testing), the core and the model adapter reach the ports, the model adapter also the moddle libraries, core and webview @miragon/pulse-ui/tones and their label helpers (core/views/labels.ts, webview/format/) @miragon/pulse-ui/format, the webview protocol types and its rendering libraries, the host kit core, protocol, ports and Node built-ins, its connections also @miragon/pulse-profile's main entry. The runtime view knows no editor host and no dialect.",
      from: {},
      to: { path: "^$" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependency. Extract the shared part into its own module that both sides import.",
      from: {},
      to: { circular: true },
    },
    {
      name: "model-libraries-stay-in-the-model-adapter",
      severity: "error",
      comment:
        "BPMN model libraries (bpmn-moddle, its vendor descriptors, bpmn-modeler libs) belong in packages/core/runtime-view/src/model only. Read what you need through the ModelSource or CodeLocator port instead.",
      from: { pathNot: [MODEL_ADAPTER, "(^|/)node_modules/"] },
      to: { path: MODEL_LIBRARIES },
    },
    {
      name: "runtime-view-is-dialect-neutral",
      severity: "error",
      comment:
        "The runtime view speaks the engine contract of @miragon/pulse-engine-core only: no dialect's core (such as @miragon/pulse-c7-core, the workflow domain of the Camunda 7 REST API), client, connector or adapter. A family's adapter (packages/connectors/<family>/<family>-adapter) runs its dialect and the editor hosts' composition roots wire it in; read what you need through a port of the contract.",
      from: { pathNot: "(^|/)node_modules/" },
      to: { path: DIALECT_PACKAGES },
    },
    {
      name: "engine-core-only-by-its-entries",
      severity: "error",
      comment:
        "Import @miragon/pulse-engine-core, the neutral core of the engine family, by its package entries (the main entry in the layers that speak the contract, ./testing in tests and the dev harness), never a file of packages/connectors/engine/engine-core by path, its source or its build: the entries load the package's build, so a module reached by path is a second copy of the contract, and RuntimeError.is and instanceof no longer recognise an error of the other copy.",
      from: { pathNot: "(^|/)node_modules/" },
      to: { path: ENGINE_CORE_TREE },
    },
    {
      name: "pulse-ui-only-its-foundation",
      severity: "error",
      comment:
        "The runtime view shares Pulse's UI foundation, not its React kit: shipped code imports @miragon/pulse-ui only as @miragon/pulse-ui/format and @miragon/pulse-ui/tones (in the core and the webview), never its root (React, Radix, Tailwind classes), its stylesheets or ./testing, and never a file of it by path. Format through TimeLabels, CountLabels and Labels, draw a tone with the webview's own CSS classes; tests may import @miragon/pulse-ui/testing.",
      from: { pathNot: [TEST_CODE, TOOLING, "(^|/)node_modules/"] },
      to: { path: PULSE_UI, pathNot: UI_FOUNDATION },
    },
    {
      name: "protocol-imports-nothing",
      severity: "error",
      comment:
        "The protocol holds JSON-only message and view-model types shared by host and webview. Keep it free of imports outside packages/core/runtime-view/src/core/protocol.",
      from: { path: `${PACKAGE}src/core/protocol/` },
      to: { pathNot: `${PACKAGE}src/core/protocol/` },
    },
    {
      name: "src-not-to-dev-dependencies",
      severity: "error",
      comment:
        "Shipped code must not import a devDependency. Declare it in the dependencies of packages/core/runtime-view/package.json.",
      from: { path: `${PACKAGE}src/`, pathNot: TEST_CODE },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-undeclared-dependencies",
      severity: "error",
      comment:
        "This package is not declared in packages/core/runtime-view/package.json. Add it there (dependencies for shipped code, devDependencies for tests and tooling).",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "This import cannot be resolved to a file or an installed package.",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: [`${PACKAGE}(dist|coverage|reports)/`] },
    combinedDependencies: true,
    preserveSymlinks: true,
    tsPreCompilationDeps: true,
    tsConfig: { fileName: require("node:path").join(__dirname, "tsconfig.json") },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".json", ".css"],
    },
  },
}
