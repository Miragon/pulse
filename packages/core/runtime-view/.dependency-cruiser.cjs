const PACKAGE = "^packages/core/runtime-view/"
const TEST_CODE = `[.]test[.](tsx?|cjs)$|${PACKAGE}test/`
const TOOLING = `${PACKAGE}(scripts|dev)/`
const CONTRACT_ENTRY = `${PACKAGE}src/contract/index[.]ts$`
const CORE_ENTRY = `${PACKAGE}src/core/index[.]ts$`
const PROTOCOL_ENTRY = `${PACKAGE}src/core/protocol/index[.]ts$`
const WEBVIEW_LIBRARIES =
  "(^|/)node_modules/(preact|bpmn-js|diagram-js|@miragon/modeler-shell|@fontsource-variable/[^/]+)/"
const MODEL_ADAPTER = `${PACKAGE}src/model/`
const MODEL_LIBRARIES =
  "(^|/)node_modules/(bpmn-moddle|camunda-bpmn-moddle|zeebe-bpmn-moddle|@miragon/bpmn-modeler[^/]*)/|^(bpmn-moddle|camunda-bpmn-moddle|zeebe-bpmn-moddle|@miragon/bpmn-modeler[^/]*)(/|$)"
const ENGINE_CORE =
  "(^|/)node_modules/@miragon/pulse-engine-core/|^@miragon/pulse-engine-core(/|$)|^packages/connectors/engine/engine-core/"

module.exports = {
  allowedSeverity: "error",
  allowed: [
    {
      comment: "A layer may use its own modules.",
      from: { path: `${PACKAGE}src/(contract|core|webview|model|host-kit)/` },
      to: { path: `${PACKAGE}src/$1/` },
    },
    {
      comment: "Tests and tooling may use anything.",
      from: { path: [TEST_CODE, TOOLING] },
      to: {},
    },
    {
      comment: "The core depends only on the contract.",
      from: { path: `${PACKAGE}src/core/` },
      to: { path: CONTRACT_ENTRY },
    },
    {
      comment:
        "The model adapter depends on the contract and reads models with the moddle libraries.",
      from: { path: `${PACKAGE}src/model/` },
      to: { path: [CONTRACT_ENTRY, MODEL_LIBRARIES] },
    },
    {
      comment: "The webview renders protocol view models and nothing else of ours.",
      from: { path: `${PACKAGE}src/webview/` },
      to: { path: PROTOCOL_ENTRY, dependencyTypes: ["type-only"] },
    },
    {
      comment: "The webview may use its rendering libraries.",
      from: { path: `${PACKAGE}src/webview/` },
      to: { path: WEBVIEW_LIBRARIES },
    },
    {
      comment:
        "The host kit holds the rules every editor host shares over the core, the protocol and the contract.",
      from: { path: `${PACKAGE}src/host-kit/` },
      to: { path: [CORE_ENTRY, PROTOCOL_ENTRY, CONTRACT_ENTRY] },
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
        "No entry of `allowed` in packages/core/runtime-view/.dependency-cruiser.cjs permits this import. Move the code to the layer that may make it (table 'Where code goes' in apps/vscode/CLAUDE.md). A layer uses its own modules and another layer only through its index.ts: the core reaches the contract, the model adapter the contract and the moddle libraries, the webview protocol types and its rendering libraries, the host kit core, protocol, contract and Node built-ins. The runtime view knows no editor host and no engine.",
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
        "BPMN model libraries (bpmn-moddle, its vendor descriptors, bpmn-modeler libs) belong in packages/core/runtime-view/src/model only. Read what you need through the ModelSource or CodeLocator port of the contract instead.",
      from: { pathNot: [MODEL_ADAPTER, "(^|/)node_modules/"] },
      to: { path: MODEL_LIBRARIES },
    },
    {
      name: "runtime-view-is-engine-neutral",
      severity: "error",
      comment:
        "@miragon/pulse-engine-core is the Camunda 7 family's workflow domain: only the family's adapter (packages/connectors/engine/engine-adapter) imports it. The contract, the core, the webview, the model adapter and the host kit stay engine-neutral; read what you need through a port of the contract.",
      from: { pathNot: "(^|/)node_modules/" },
      to: { path: ENGINE_CORE },
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
