const PACKAGE = "^packages/connectors/c7/c7-adapter/"
const TEST_CODE = `[.]test[.](tsx?|cjs)$|${PACKAGE}test/`
const ENTRY = `${PACKAGE}src/index[.]ts$`
const ENGINE_TEST = "[.]engine[.]test[.]ts$"
const BPMN_DIALECT = `${PACKAGE}src/c7-bpmn-dialect[.]ts$`
const DESCRIPTOR = "(^|/)node_modules/camunda-bpmn-moddle/resources/camunda[.]json$"
const MODDLE_DESCRIPTORS = "(^|/)node_modules/[^/]+-bpmn-moddle/|^[^/]+-bpmn-moddle(/|$)"
const PORTS_ENTRY = "(^|/)node_modules/@miragon/pulse-runtime-view/dist/ports/index[.]d[.]ts$"
const ENGINE_CORE_ENTRY = "(^|/)node_modules/@miragon/pulse-engine-core/dist/index[.]d[.]ts$"
const CONFORMANCE_KIT = "(^|/)node_modules/@miragon/pulse-engine-core/dist/testing/index[.]d[.]ts$"
const C7_CORE_ENTRY = "(^|/)node_modules/@miragon/pulse-c7-core/dist/index[.]d[.]ts$"
const C7_RUNTIME_ENTRY = "(^|/)node_modules/@miragon/pulse-c7-core/dist/runtime/index[.]d[.]ts$"
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
        "The adapter's BPMN dialect (src/c7-bpmn-dialect.ts, the BpmnDialect of the ports) hands the model reader the vocabulary of Camunda 7's BPMN files: the descriptor of camunda-bpmn-moddle, which the editor hosts bundle.",
      from: { path: BPMN_DIALECT },
      to: { path: DESCRIPTOR },
    },
    {
      comment:
        "The adapter runs the core of the Camunda 7 REST dialect family c7 (@miragon/pulse-c7-core, its main entry: the workflow domain), which the editor hosts bundle.",
      from: { path: `${PACKAGE}src/` },
      to: { path: C7_CORE_ENTRY },
    },
    {
      comment:
        "The adapter reads the engine's answers and checks its ids with what c7-core's ./runtime entry (@miragon/pulse-c7-core/runtime) builds the engine contract's reads on: JsonView and the one engine id rule, which the editor hosts bundle.",
      from: { path: `${PACKAGE}src/` },
      to: { path: C7_RUNTIME_ENTRY },
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
        "No entry of `allowed` in packages/connectors/c7/c7-adapter/.dependency-cruiser.cjs permits this import. The adapter uses its own modules, the main entry of @miragon/pulse-engine-core (the contract), the main entry of @miragon/pulse-c7-core (the c7 dialect's workflow domain) and its ./runtime entry (what the engine contract's reads build on), never another subpath, the runtime view's ports (@miragon/pulse-runtime-view/ports), in its BPMN dialect (src/c7-bpmn-dialect.ts) the descriptor of camunda-bpmn-moddle, in its wire (src/engine-rest/http) the main entry of the transport @miragon/pulse-http, and no Node built-in: the REST client runs on the global fetch of its host's runtime.",
      from: {},
      to: { path: "^$" },
    },
    {
      name: "moddle-descriptor-only-in-the-bpmn-dialect",
      severity: "error",
      comment:
        "Only the adapter's BPMN dialect (src/c7-bpmn-dialect.ts) imports a moddle descriptor (the JSON of a *-bpmn-moddle package): it names the vocabulary of Camunda 7's BPMN files once, and the model reader of the runtime view reads them through it. Add a rule to the dialect instead of reading the descriptor elsewhere.",
      from: { path: `${PACKAGE}src/`, pathNot: [BPMN_DIALECT, TEST_CODE] },
      to: { path: MODDLE_DESCRIPTORS },
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
