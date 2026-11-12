const PACKAGE = "^packages/connectors/c7/c7-adapter/"
const TEST_CODE = `[.]test[.](tsx?|cjs)$|${PACKAGE}test/`
const ENTRY = `${PACKAGE}src/index[.]ts$`
const ENGINE_TEST = "[.]engine[.]test[.]ts$"
const PORTS_ENTRY = "(^|/)node_modules/@miragon/pulse-runtime-view/dist/ports/index[.]d[.]ts$"
const ENGINE_CORE_ENTRY = "(^|/)node_modules/@miragon/pulse-engine-core/dist/index[.]d[.]ts$"
const CONFORMANCE_KIT = "(^|/)node_modules/@miragon/pulse-engine-core/dist/testing/index[.]d[.]ts$"
const C7_CORE_ENTRY = "(^|/)node_modules/@miragon/pulse-c7-core/dist/index[.]d[.]ts$"
const WIRE = `${PACKAGE}src/engine-rest/http/`
const HTTP_ENTRY = "(^|/)node_modules/@miragon/pulse-http/dist/index[.]d[.]ts$"
const HTTP_PACKAGE =
  "(^|/)node_modules/@miragon/pulse-http/|^@miragon/pulse-http(/|$)|^packages/core/http/"

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
      comment:
        "The adapter implements the engine contract of @miragon/pulse-engine-core, the neutral core of the engine family (its main entry), which the editor hosts bundle.",
      from: { path: `${PACKAGE}src/` },
      to: { path: ENGINE_CORE_ENTRY },
    },
    {
      comment:
        "The adapter provides the plug of the runtime view's ports (EngineAdapter, EngineConnection, EngineWebUi), through their entry.",
      from: { path: `${PACKAGE}src/` },
      to: { path: PORTS_ENTRY },
    },
    {
      comment:
        "The adapter runs the core of the Camunda 7 REST dialect family c7 (@miragon/pulse-c7-core, its main entry: the workflow domain), which the editor hosts bundle.",
      from: { path: `${PACKAGE}src/` },
      to: { path: C7_CORE_ENTRY },
    },
    {
      comment:
        "The adapter's wire (src/engine-rest/http: EngineHttp and the wording of its failures) sends every engine request through @miragon/pulse-http, the transport the CLI and the MCP server send through too (its main entry), which the editor hosts bundle.",
      from: { path: WIRE },
      to: { path: HTTP_ENTRY },
    },
  ],
  forbidden: [
    {
      name: "not-in-allowed",
      severity: "error",
      comment:
        "No entry of `allowed` in packages/connectors/c7/c7-adapter/.dependency-cruiser.cjs permits this import. The adapter uses its own modules, the main entries of @miragon/pulse-engine-core (the contract) and @miragon/pulse-c7-core (the c7 dialect's workflow domain), never a subpath, the runtime view's ports (@miragon/pulse-runtime-view/ports), in its wire (src/engine-rest/http) the main entry of the transport @miragon/pulse-http, and no Node built-in: the REST client runs on the global fetch of its host's runtime.",
      from: {},
      to: { path: "^$" },
    },
    {
      name: "http-only-in-the-wire",
      severity: "error",
      comment:
        "Only the adapter's wire (src/engine-rest/http) sends: EngineHttp is the one place that imports the transport @miragon/pulse-http, by its package entry or by path. Send through EngineHttp (read, find, readAll, text, write) and word a failure in its EngineRequestError.",
      from: { path: `${PACKAGE}src/`, pathNot: [WIRE, TEST_CODE] },
      to: { path: HTTP_PACKAGE },
    },
    {
      name: "http-by-its-main-entry",
      severity: "error",
      comment:
        "The adapter's wire imports @miragon/pulse-http by its main entry only: never ./oauth (the OAuth client protocol, which the C7 adapter does not speak), ./testing or ./testing/loopback (the conformance cases and their engine, for tests), never a file of packages/core/http by path, which would bundle a second copy of the transport.",
      from: { path: WIRE, pathNot: TEST_CODE },
      to: { path: HTTP_PACKAGE, pathNot: HTTP_ENTRY },
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
        "Shipped code must not import a devDependency. Declare it in the dependencies of packages/connectors/c7/c7-adapter/package.json.",
      from: { path: `${PACKAGE}src/`, pathNot: TEST_CODE },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-undeclared-dependencies",
      severity: "error",
      comment:
        "This package is not declared in packages/connectors/c7/c7-adapter/package.json. Add it there (dependencies for shipped code, devDependencies for tests).",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "adapter-proven-on-an-engine",
      severity: "error",
      comment:
        "The adapter is not run by any *.engine.test.ts. Add packages/connectors/c7/c7-adapter/test/<engine>-conformance.engine.test.ts that runs new ConformanceKit(test).registerRuntimeLaws(...) from @miragon/pulse-engine-core/testing against the engine or a mock of its API.",
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
        "An engine test proves an adapter with the conformance kit. Import ConformanceKit from @miragon/pulse-engine-core/testing and run new ConformanceKit(test).registerRuntimeLaws(...) with the adapter under test.",
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
