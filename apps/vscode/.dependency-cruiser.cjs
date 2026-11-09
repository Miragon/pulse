const APP = "^apps/vscode/"
const TEST_CODE = `[.]test[.](tsx?|cjs)$|${APP}test/`
const TOOLING = `${APP}(scripts|dev)/`
const RUNTIME_VIEW = "(^|/)node_modules/@miragon/pulse-runtime-view/"
const LAYER_ENTRIES = `${RUNTIME_VIEW}dist/(ports|core|core/protocol|host-kit)/index[.]d[.]ts$`
const MODEL_ENTRY = `${RUNTIME_VIEW}dist/model/index[.]d[.]ts$`
const ADAPTER_ENTRY = "(^|/)node_modules/@miragon/pulse-[^/]+-adapter/dist/index[.]d[.]ts$"
const ENGINE_CORE_ENTRY = "(^|/)node_modules/@miragon/pulse-engine-core/dist/index[.]d[.]ts$"
const ENGINE_CORE_TREE = "^packages/connectors/engine/engine-core/"
const DIALECT_PACKAGES =
  "(^|/)node_modules/@miragon/pulse-(?!engine-core/)[^/]+-(core|client|connector)/|^@miragon/pulse-(?!engine-core(/|$))[^/]+-(core|client|connector)(/|$)|^packages/connectors/(?!engine/engine-core/)[^/]+/[^/]+-(core|client|connector)/"
const EXTENSION_LIBRARIES = "(^|/)node_modules/@miragon/modeler-shell/"
const MODEL_LIBRARIES =
  "(^|/)node_modules/(bpmn-moddle|camunda-bpmn-moddle|zeebe-bpmn-moddle|@miragon/bpmn-modeler[^/]*)/|^(bpmn-moddle|camunda-bpmn-moddle|zeebe-bpmn-moddle|@miragon/bpmn-modeler[^/]*)(/|$)"

module.exports = {
  allowedSeverity: "error",
  allowed: [
    {
      comment: "The host may use its own modules.",
      from: { path: `${APP}src/host/` },
      to: { path: `${APP}src/host/` },
    },
    {
      comment: "Tests and tooling may use anything.",
      from: { path: [TEST_CODE, TOOLING] },
      to: {},
    },
    {
      comment:
        "The extension host wires the runtime view's ports, core, protocol and host kit into VS Code.",
      from: { path: `${APP}src/host/` },
      to: { path: [LAYER_ENTRIES, EXTENSION_LIBRARIES, "^vscode$"] },
    },
    {
      comment:
        "The extension host names the contract's ids and read models from @miragon/pulse-engine-core, the neutral core of the engine family (its main entry), which esbuild bundles into the extension.",
      from: { path: `${APP}src/host/` },
      to: { path: ENGINE_CORE_ENTRY },
    },
    {
      comment: "The extension host may use Node built-ins.",
      from: { path: `${APP}src/host/` },
      to: { dependencyTypes: ["core"] },
    },
    {
      comment: "Only the composition root knows the engine adapters and the model adapter.",
      from: { path: `${APP}src/host/composition-root[.]ts$` },
      to: { path: [ADAPTER_ENTRY, MODEL_ENTRY] },
    },
  ],
  forbidden: [
    {
      name: "not-in-allowed",
      severity: "error",
      comment:
        "No entry of `allowed` in apps/vscode/.dependency-cruiser.cjs permits this import. Move the code to the layer that may make it (table 'Where code goes' in apps/vscode/CLAUDE.md). The host uses its own modules, the runtime view (@miragon/pulse-runtime-view) through the entries of its ports, core, protocol and host kit, the main entry of @miragon/pulse-engine-core (never ./testing), vscode, modeler-shell and Node built-ins, and only its composition root the engine adapters (@miragon/pulse-<family>-adapter) and the model adapter (@miragon/pulse-runtime-view/model).",
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
      from: { pathNot: "(^|/)node_modules/" },
      to: { path: MODEL_LIBRARIES },
    },
    {
      name: "extension-is-dialect-neutral",
      severity: "error",
      comment:
        "The extension speaks the engine contract of @miragon/pulse-engine-core only: no dialect's core (such as @miragon/pulse-c7-core, the workflow domain of the Camunda 7 REST API), client or connector. Only the family's adapter (packages/connectors/<family>/<family>-adapter) runs its dialect, and the composition root wires it in.",
      from: { pathNot: "(^|/)node_modules/" },
      to: { path: DIALECT_PACKAGES },
    },
    {
      name: "engine-core-only-by-its-entries",
      severity: "error",
      comment:
        "Import @miragon/pulse-engine-core, the neutral core of the engine family, by its package entries (the main entry in the host, ./testing in tests and the dev host), never a file of packages/connectors/engine/engine-core by path, its source or its build: the entries load the package's build, so a module reached by path is a second copy of the contract, and RuntimeError.is and instanceof no longer recognise an error of the other copy.",
      from: { pathNot: "(^|/)node_modules/" },
      to: { path: ENGINE_CORE_TREE },
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
      name: "not-to-unresolvable",
      severity: "error",
      comment: "This import cannot be resolved to a file or an installed package.",
      from: {},
      to: { couldNotResolve: true, pathNot: "^vscode$" },
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
