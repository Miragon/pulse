const APP = "^apps/vscode/"
const TEST_CODE = `[.]test[.](tsx?|cjs)$|${APP}test/`
const TOOLING = `${APP}(scripts|dev)/`
const CONTRACT_ENTRY = `${APP}src/contract/index[.]ts$`
const CORE_ENTRY = `${APP}src/core/index[.]ts$`
const PROTOCOL_ENTRY = `${APP}src/core/protocol/index[.]ts$`
const ADAPTER_ENTRY = `${APP}src/adapters/[^/]+/index[.]ts$`
const ENGINE_TEST = "[.]engine[.]test[.]ts$"
const CONFORMANCE_KIT = `${APP}src/contract/conformance/index[.]ts$`
const WEBVIEW_LIBRARIES =
  "(^|/)node_modules/(preact|bpmn-js|diagram-js|@miragon/modeler-shell|@fontsource-variable/[^/]+)/"
const EXTENSION_LIBRARIES = "(^|/)node_modules/@miragon/modeler-shell/"
const MODEL_ADAPTER = `${APP}src/model/`
const MODEL_ADAPTER_ENTRY = `${APP}src/model/index[.]ts$`
const MODEL_LIBRARIES =
  "(^|/)node_modules/(bpmn-moddle|camunda-bpmn-moddle|zeebe-bpmn-moddle|@miragon/bpmn-modeler[^/]*)/"

module.exports = {
  allowedSeverity: "error",
  allowed: [
    {
      comment: "A layer may use its own modules.",
      from: { path: `${APP}src/(contract|core|webview|model|host|adapters/[^/]+)/` },
      to: { path: `${APP}src/$1/` },
    },
    {
      comment: "Tests and tooling may use anything.",
      from: { path: [TEST_CODE, TOOLING] },
      to: {},
    },
    {
      comment: "The core depends only on the contract.",
      from: { path: `${APP}src/core/` },
      to: { path: CONTRACT_ENTRY },
    },
    {
      comment: "Adapters depend only on the contract.",
      from: { path: `${APP}src/adapters/[^/]+/` },
      to: { path: CONTRACT_ENTRY },
    },
    {
      comment:
        "The model adapter depends on the contract and reads models with the moddle libraries.",
      from: { path: `${APP}src/model/` },
      to: { path: [CONTRACT_ENTRY, MODEL_LIBRARIES] },
    },
    {
      comment: "Only the engine CLI wrapper of the C7 adapter talks to Node.",
      from: { path: `${APP}src/adapters/c7/engine-cli/` },
      to: { dependencyTypes: ["core"] },
    },
    {
      comment: "The webview renders protocol view models and nothing else of ours.",
      from: { path: `${APP}src/webview/` },
      to: { path: PROTOCOL_ENTRY, dependencyTypes: ["type-only"] },
    },
    {
      comment: "The webview may use its rendering libraries.",
      from: { path: `${APP}src/webview/` },
      to: { path: WEBVIEW_LIBRARIES },
    },
    {
      comment: "The extension host wires the core, the protocol and the contract into VS Code.",
      from: { path: `${APP}src/host/` },
      to: { path: [CORE_ENTRY, PROTOCOL_ENTRY, CONTRACT_ENTRY, EXTENSION_LIBRARIES, "^vscode$"] },
    },
    {
      comment: "The extension host may use Node built-ins.",
      from: { path: `${APP}src/host/` },
      to: { dependencyTypes: ["core"] },
    },
    {
      comment: "Only the composition root knows the engine adapters and the model adapter.",
      from: { path: `${APP}src/host/composition-root[.]ts$` },
      to: { path: [ADAPTER_ENTRY, MODEL_ADAPTER_ENTRY] },
    },
  ],
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependency. Extract the shared part into its own module that both sides import.",
      from: {},
      to: { circular: true },
    },
    {
      name: "engine-cli-wrapper-is-self-contained",
      severity: "error",
      comment:
        "apps/vscode/src/adapters/c7/engine-cli must import nothing of ours: the in-process engine client (a -domain package) replaces it as a whole. Pass what it needs in as parameters instead.",
      from: { path: `${APP}src/adapters/c7/engine-cli/` },
      to: { path: APP, pathNot: [`${APP}src/adapters/c7/engine-cli/`, `${APP}node_modules/`] },
    },
    {
      name: "model-libraries-stay-in-the-model-adapter",
      severity: "error",
      comment:
        "BPMN model libraries (bpmn-moddle, its vendor descriptors, bpmn-modeler libs) belong in apps/vscode/src/model only. Read what you need through the ModelSource or CodeLocator port of the contract instead.",
      from: { pathNot: [MODEL_ADAPTER, "(^|/)node_modules/"] },
      to: { path: MODEL_LIBRARIES },
    },
    {
      name: "protocol-imports-nothing",
      severity: "error",
      comment:
        "The protocol holds JSON-only message and view-model types shared by host and webview. Keep it free of imports outside apps/vscode/src/core/protocol.",
      from: { path: `${APP}src/core/protocol/` },
      to: { pathNot: `${APP}src/core/protocol/` },
    },
    {
      name: "src-not-to-dev-dependencies",
      severity: "error",
      comment:
        "Shipped code must not import a devDependency. Declare it in the dependencies of apps/vscode/package.json.",
      from: { path: `${APP}src/`, pathNot: TEST_CODE },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-undeclared-dependencies",
      severity: "error",
      comment:
        "This package is not declared in apps/vscode/package.json. Add it there (dependencies for shipped code, devDependencies for tests and tooling).",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "adapter-proven-on-an-engine",
      severity: "error",
      comment:
        "This engine adapter is not run by any *.engine.test.ts. Add apps/vscode/test/adapters/<engine>/<engine>-conformance.engine.test.ts that runs new ConformanceKit(test).registerRuntimeLaws(...) from src/contract/conformance against the engine or a mock of its API.",
      from: { path: ENGINE_TEST },
      to: { path: ADAPTER_ENTRY, reachable: false },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "This import cannot be resolved to a file or an installed package.",
      from: {},
      to: { couldNotResolve: true, pathNot: "^vscode$" },
    },
  ],
  required: [
    {
      name: "engine-test-runs-the-conformance-kit",
      severity: "error",
      comment:
        "An engine test proves an adapter with the conformance kit. Import ConformanceKit from src/contract/conformance and run new ConformanceKit(test).registerRuntimeLaws(...) with the adapter under test.",
      module: { path: ENGINE_TEST },
      to: { path: CONFORMANCE_KIT },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: [`${APP}(dist|dist-dev|coverage|reports|\\.vscode-test)/`] },
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
