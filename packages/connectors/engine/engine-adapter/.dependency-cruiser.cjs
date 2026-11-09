const PACKAGE = "^packages/connectors/engine/engine-adapter/"
const TEST_CODE = `[.]test[.](tsx?|cjs)$|${PACKAGE}test/`
const ENTRY = `${PACKAGE}src/index[.]ts$`
const ENGINE_TEST = "[.]engine[.]test[.]ts$"
const CONTRACT_ENTRY = "(^|/)node_modules/@miragon/pulse-runtime-view/dist/contract/index[.]d[.]ts$"
const CONFORMANCE_KIT =
  "(^|/)node_modules/@miragon/pulse-runtime-view/dist/contract/conformance/index[.]d[.]ts$"
const ENGINE_CORE_ENTRY = "(^|/)node_modules/@miragon/pulse-engine-core/dist/index[.]d[.]ts$"

module.exports = {
  allowedSeverity: "error",
  allowed: [
    {
      comment: "The adapter may use its own modules.",
      from: { path: `${PACKAGE}src/` },
      to: { path: `${PACKAGE}src/` },
    },
    {
      comment: "Tests may use anything.",
      from: { path: TEST_CODE },
      to: {},
    },
    {
      comment: "The adapter implements the runtime view's contract, through its entry.",
      from: { path: `${PACKAGE}src/` },
      to: { path: CONTRACT_ENTRY },
    },
    {
      comment:
        "The adapter runs the Camunda 7 family's workflow domain (@miragon/pulse-engine-core, its main entry), which the editor hosts bundle.",
      from: { path: `${PACKAGE}src/` },
      to: { path: ENGINE_CORE_ENTRY },
    },
  ],
  forbidden: [
    {
      name: "not-in-allowed",
      severity: "error",
      comment:
        "No entry of `allowed` in packages/connectors/engine/engine-adapter/.dependency-cruiser.cjs permits this import. The adapter uses its own modules, the runtime view's contract (@miragon/pulse-runtime-view/contract) and @miragon/pulse-engine-core's main entry (never a subpath), and no Node built-in: the REST client runs on fetch.",
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
      name: "src-not-to-dev-dependencies",
      severity: "error",
      comment:
        "Shipped code must not import a devDependency. Declare it in the dependencies of packages/connectors/engine/engine-adapter/package.json.",
      from: { path: `${PACKAGE}src/`, pathNot: TEST_CODE },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-undeclared-dependencies",
      severity: "error",
      comment:
        "This package is not declared in packages/connectors/engine/engine-adapter/package.json. Add it there (dependencies for shipped code, devDependencies for tests).",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "adapter-proven-on-an-engine",
      severity: "error",
      comment:
        "The adapter is not run by any *.engine.test.ts. Add packages/connectors/engine/engine-adapter/test/<engine>-conformance.engine.test.ts that runs new ConformanceKit(test).registerRuntimeLaws(...) from @miragon/pulse-runtime-view/contract/conformance against the engine or a mock of its API.",
      from: { path: ENGINE_TEST },
      to: { path: ENTRY, reachable: false },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "This import cannot be resolved to a file or an installed package.",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  required: [
    {
      name: "engine-test-runs-the-conformance-kit",
      severity: "error",
      comment:
        "An engine test proves an adapter with the conformance kit. Import ConformanceKit from @miragon/pulse-runtime-view/contract/conformance and run new ConformanceKit(test).registerRuntimeLaws(...) with the adapter under test.",
      module: { path: ENGINE_TEST },
      to: { path: CONFORMANCE_KIT },
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
