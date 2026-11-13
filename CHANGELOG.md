# Changelog

## [0.28.0](https://github.com/Miragon/pulse/compare/v0.27.1...v0.28.0) (2026-11-13)


### ⚠ BREAKING CHANGES

* **engine:** @miragon/pulse-engine-connector/widgets no longer exports ENGINE_HOST_WIDGET_REFS: the engine module renders no widget of another module. The fleet view shows the engine landscape from the engine REST API and appears with two or more engines; the process flow embeds neither analytics:process-heatmap nor analytics:process-heatmap-legend. A composition root registers no host widget for it: the starter's server/src/ui/view-registry.ts exports no hostWidgets, and its main.tsx passes none to mountViews.
* The engine plugin io.miragon.mcp:cibseven-history-metrics is no longer built or published, and engine-plugins/ is gone: 0.27.1 on Maven Central stays its last version. An engine that keeps the plugin keeps exporting its engine_* meters; nothing in Pulse builds or tests them any more, and the playground engine runs without the plugin.
* The analytics module is gone, and with it Prometheus as a source. An MCP_ACTIVE_MODULES that names analytics (e.g. engine:operations,analytics) fails the boot as an unknown module; engine is the only known one. PROMETHEUS_URL, PROMETHEUS_BEARER_TOKEN, PROMETHEUS_USERNAME, PROMETHEUS_PASSWORD, PROMETHEUS_HEADERS, PROMETHEUS_TIMEOUT_MS and ANALYTICS_ENGINE_IDS configure nothing, and the server no longer warns about them. The tools analytics_engine_health, analytics_show_dashboard, analytics_show_period_compare, analytics_show_version_compare, analytics_show_engine_compare, analytics_show_engine_landscape and analytics_show_bpmn_heatmap and the feeds analytics_bpmn_heatmap_data, analytics_bpmn_xml_data and analytics_engine_landscape_data are gone. The process flow of engine_open_cockpit shows running tokens per element from the engine REST API and what the instances started in the last 30 days passed, from history level activity; the duration heat, time per activity, the dashboard and the period, version and engine comparisons have no replacement. @miragon/pulse-analytics-connector and @miragon/pulse-analytics-client are no longer published; 0.27.1 is their last version. @miragon/pulse-engine-connector no longer exports createBpmnXmlFetcher or configuredEngineIds. In @miragon/pulse-widget-shell, describeError no longer recognizes a Prometheus failure (ErrorSource has no "prometheus" type), and HandOffAction loses analyzePerformance, explainBottleneck and compareEngines. A starter drops analyticsModule and the analytics wiring of sharedResources from server/src/setup.ts (SharedResources stays, empty, as the port for what the modules share), analyticsViews from server/src/ui/view-registry.ts, the analytics @source line from server/src/ui/globals.css, the dependency from server/package.json and the Prometheus block from its .env.
* **widget-shell:** @miragon/pulse-widget-shell has no host widget map any more. mountViews and TestViewHost take no hostWidgets; HostWidgetSlot, useHostWidget, HostWidget and HostWidgets are gone. shared stays as it is: `ComposableModule<TShared>`, createPlugin(config, shared) and createComposedServer({ shared }) are unchanged. A composition root passes no hostWidgets to mountViews, as the starter's server/src/ui/main.tsx already does.
* **ui:** PRODUCT_GLOSSARY, glossaryFindings, blindGlossaryRules, unnamedGlossaryTerms and the types GlossaryRule and GlossaryFinding moved from @miragon/pulse-widget-shell/testing to @miragon/pulse-ui/testing; import them from there. @miragon/pulse-widget-shell/testing keeps recordingModuleServer and testServerContext. The English PRODUCT_GLOSSARY no longer flags a bare "pause" or "halt", only one next to what the engine suspends; a module whose UI pauses nothing of its own adds BARE_PAUSE_RULE_EN to its own glossary test, as the engine connector does. PRODUCT_GLOSSARY now flags "With incidents" and "Mit Incidents" for instances: a module whose catalog says so fails its glossary test until it writes "With incident" or "Mit Incident".
* **ui:** countTone and severityTone moved from @miragon/pulse-widget-shell/widgets to @miragon/pulse-ui (and @miragon/pulse-ui/tones); widget-shell no longer exports them, so import them from the new path. severityTone now returns neutral instead of success for a process with running instances and no open incident or job without retries.
* **ui:** shortId moved from @miragon/pulse-widget-shell/widgets to @miragon/pulse-ui (and @miragon/pulse-ui/format); widget-shell no longer exports it, so import it from the new path. formatDuration shows days from 24 hours on ("1d 3h" instead of "27h 0m"), and shortId shows a number longer than 12 digits by its tail and keeps an id that is neither a number nor a UUID whole.
* **widget-shell:** a widget test under TestViewHost formats numbers and dates in the test host's locale and host.timeZone, no longer in the machine's. A test that sets the formatters' locale itself with setFormatLocale before it mounts TestViewHost loses it while the host is mounted: pass locale and host.timeZone instead. A test under a German locale (the prop or an outer LocaleProvider) that asserted English numbers or dates now reads German ones, and a test without a locale on a machine in another language reads English ones.
* **c7:** The Camunda 7 REST rules of @miragon/pulse-engine-core are now @miragon/pulse-c7-core, the core of the Camunda 7 REST dialect family, under packages/connectors/c7/c7-core; the name @miragon/pulse-engine-core passes to the neutral core of the engine family (see below). The MCP module keeps its names: @miragon/pulse-engine-connector, engineModule, the engine_* tools and the ENGINE_* variables, so a server that composes the connector changes nothing.
* **c7:** @miragon/pulse-engine-client is now @miragon/pulse-c7-client, under packages/connectors/c7/c7-client. Its SDK-bound reads moved from src/engine-contract to src/sdk-reads, and the server's engine requests carry the User-Agent `@miragon/pulse-c7-client/<version>`. The old name gets no further release.
* **engine-core:** @miragon/pulse-engine-core is now the neutral core of the engine family, under packages/connectors/engine/engine-core: the engine contract every dialect implements (the ports ProcessRuntime and ProcessCommands, their read models and failure kinds), with its conformance kit and fake under ./testing. The Camunda 7 REST rules it held up to 0.27 are @miragon/pulse-c7-core.
* **engine-core:** rootCause and rootCauseLine leave @miragon/pulse-c7-core. The rule lives in @miragon/pulse-engine-core as RootCauses.of and RootCauses.lineOf, the root-cause rule of every dialect; c7-core adds causeOf(text, fallback), the root cause of a text or the fallback.
* **c7:** the SDK of @miragon/pulse-c7-client (formerly @miragon/pulse-engine-client) is generated from the one patched Operaton spec instead of CIB seven's. The type CamundaFormRef is OperatonFormRef; TaskDto and FormDto carry operatonFormRef next to camundaFormRef, both OperatonFormRef | null; ProcessInstanceModificationInstructionDto.variables is a map of variable name to TriggerVariableValueDto instead of one value; the variableValue query parameter of getHistoricVariableInstances and getHistoricVariableInstancesCount is a string instead of an object; TelemetryInternalsDto has operaton-integration instead of license-key and camunda-integration.
* **engine:** createEngineClient of @miragon/pulse-c7-client takes { baseUrl, fetch, requestValidator } instead of auth fields; the connector builds the credential and the transport. The server sends Basic credentials as UTF-8 (RFC 7617), as the CLI and Pulse for VS Code do: a password outside Latin-1 no longer fails the boot, and an engine that decoded Latin-1 now rejects a password or a user name with umlauts. An engine answer above 64 MiB fails as too large instead of being buffered. A path value that is empty, "." or ".." is refused before anything is sent. Integers beyond 2^53 reach the model as strings of their exact digits. @miragon/pulse-c7-client no longer exports EngineRequestError, EngineFailureKind, EngineAuthType and DEFAULT_ENGINE_TIMEOUT_MS: an engine error rejects with the engine's answer (its ExceptionDto, its text or {}) and a transport failure with what the fetch threw, for an error interceptor to word; without a transport behind its fetch the client keeps no deadline and follows a redirect. A call or setConfig that brings its own fetch, requestValidator or auth is refused. With ENGINE_BASE_URL the server's boot fails on a Basic user name with a colon, a control character in a Basic user name or password (a final line break in ENGINE_PASSWORD included) and a bearer token that is no RFC 6750 token after trimming, all of which it sent before; in ENGINES_JSON or ENGINES_FILE such a profile is refused instead (see the profile entry below). A forwarded caller token of that kind is refused before sending, and a "Bearer " prefix pasted into ENGINE_TOKEN is dropped.
* **profile:** a broken profile no longer makes the CLI refuse its whole config file: the profile fails when it is used, and only text that gives no profiles still fails the file. A project file names neither a secret nor a variable; such a profile is refused. The only profile of a project file is its default without defaultProfile, and a defaultProfile that names no profile gives no default instead of the user config's. Pulse for VS Code shows a profile with credentials, headers or an unknown key as a problem instead of connecting. The JSON Schema moves to https://unpkg.com/@miragon/pulse-profile/schema/pulse.schema.json. A profile may carry environment and the auth type passthrough, which only the MCP server serves. pulse config set refuses a new profile without --url, a flag no longer rescues a profile with a value the format refuses, and pulse config leaves a file that holds a profile name or a key twice as it is. Pulse for VS Code also shows a profile as a problem for a value the format refuses in timeout, output or environment or an auth object it refuses (one OAuth endpoint without the other), and its problems take the format's wording.
* **profile:** the CLI and Pulse for VS Code read the project file .pulse.json; rename .pulse-cli.json, its content stays. A directory with only a .pulse-cli.json fails in the CLI with a hint to rename it and shows a problem in Pulse for VS Code. Pulse for VS Code keys a stored sign-in by the file's path, so you sign in once more after the rename. The CLI keys an OAuth login of a project profile outside a git repository by the file's path too, so you log in once more there.
* **engine:** ENGINES_JSON and ENGINES_FILE now hold a profile file, `{"defaultProfile": "<name>", "profiles": {"<name>": {…}}}`, the format of the CLI and of Pulse for VS Code, instead of a list or an environment map. A profile's name is the engine id; baseUrl becomes url; an environment map's key becomes environment on each profile. Secrets leave the JSON: auth.passwordEnv and auth.tokenEnv name the variable that holds them, and only names that start with ENGINE_SECRET_ are read; a literal secret refuses the profile. ENGINE_BASE_URL with ENGINE_AUTH_TYPE, ENGINE_USERNAME, ENGINE_PASSWORD and ENGINE_TOKEN still describe one engine and yield its profile. A broken profile no longer stops the boot: the boot warns, engine_list_engines lists it as refused, and a call to it fails with ENGINE_PROFILE_REFUSED; the boot fails only when no profile is usable or when defaultProfile or ENGINE_DEFAULT names no profile. A profile with headers or a process engine name, or a URL with credentials, a query or a fragment, is refused; a cockpitUrl may still end in the web app's start route, "#/" or a bare "#", which is dropped. readOnly on a profile blocks writes to that engine. In @miragon/pulse-widget-shell, describeError's kind (DescribedError, ERROR_KINDS) gains profileRefused and readOnly, so an exhaustive switch over it needs the two cases, and ComposableModule gains the optional referencedEnvVars.
* **cli:** a --url flag or PULSE_CLI_URL without a --profile flag selects no profile: neither PULSE_CLI_PROFILE nor a defaultProfile applies beside it, so none of that profile's headers, auth, engine name, flavor, cockpitUrl, timeout, output or read-only flag go with the command. Before, the CLI sent the headers of the profile it had selected itself, an Authorization header included, to the given URL. Pass --profile <name> to use a profile beside the URL, or drop the URL to use the profile with its own. pulse auth login, status and logout take --url with the same rule.
* **cli:** --profile <name> --url <url> fails with CONFIG (exit 3) when <name> is a profile of your config file (or of the file --config or PULSE_CLI_CONFIG names) that holds any header, whatever its name, Basic auth, OAuth or a bearer token, and <url> has another origin (scheme, host, port) than the profile's own url; a profile without a url has none, so every --url fails for it. Before, the profile's headers and credentials went to <url>. pulse auth login, status and logout follow the same rule. Drop --url to use the profile with its own URL, or point the profile at that engine with pulse config set <name> --url <url>. Headers you pass with -H or PULSE_CLI_HEADERS do not count, and a profile of the project file, a --url of the profile's own origin, a profile without headers or credentials and PULSE_CLI_URL beside --profile behave as before.
* MCP_ACTIVE_MODULES=camunda7 fails the boot as an unknown module, without naming engine. A CAMUNDA_* variable of 0.24 neither fails the boot nor warns any more: CAMUNDA_ is no prefix the server watches, so a deployment still configured through CAMUNDA_BASE_URL boots against the default engine http://localhost:8410/engine-rest. MCP_OAUTH no longer fails the boot: it warns as an unknown variable, and without a provider's MCP_OAUTH_* variables the server boots without OAuth. The module port loses ComposableModule.retired, and @miragon/pulse-widget-shell/server no longer exports retiredEnvVars.
* **engine:** an engine URL or cockpit URL that carries credentials, a query string or a fragment is refused (ENGINE_BASE_URL, ENGINE_COCKPIT_URL and every engine of ENGINES_JSON or ENGINES_FILE); a cockpit URL may still end in the web app's start route, "#/" or a bare "#", which is dropped. A login goes into ENGINE_AUTH_TYPE with ENGINE_USERNAME and ENGINE_PASSWORD, or into the engine's auth.
* Rename MCP_USE_OAUTH_* to MCP_OAUTH_* (same suffixes), MCP_USE_OAUTH_DEBUG to MCP_OAUTH_DEBUG (0 and false now turn it off) and MCP_USE_LOG_LEVEL to MCP_LOG_LEVEL. The boot no longer names an old variable's successor and no longer fails on it: an old MCP_USE_OAUTH_*, like any misspelled provider variable, boots WITHOUT OAuth, with every toolset MCP_ACTIVE_MODULES names, and only warns as unknown. MCP_USE_ANONYMIZED_TELEMETRY, CSP_URLS, CSP_*_DOMAINS and MCP_ASSETS_URL have no effect; unset them. GET, DELETE and HEAD on /mcp answer 405 with Allow: POST; there is no landing page, no inspector under /mcp/inspector and no skills/ folder; a JWKS that cannot be loaded answers 503; an invalid body answers a JSON-RPC parse error; a request without a token gets "Missing Authorization header". Paths that answered before now get 404: every dot-segment alias of a route (/./mcp, /x/../mcp, /%2e/mcp), a backslash in place of a slash, a target with a fragment, a discovery document with a trailing slash, and a percent-encoded path. A Host header that is empty, holds a path or names no host gets 400. The view document drops the "Compiling..." placeholder and reads globalThis.__pulseViewConfig; __mcpUseViewConfig and /mcp/_mcp-use/public/ are gone. mcp-use dev, its tunnel and the MCP_URL it set are gone: OAuth under pnpm dev needs MCP_URL in the .env. The starter needs Node.js ^22.23.4, ^24.22.1 or >=26.12.1. Module API: server.tool() and server.prompt() are gone, a handler's ctx is the SDK's ServerContext, showToolBinding and appOnly return config parts, a non-strict input schema fails the boot, a registration cannot change after the boot, a hand-built ModuleServer needs registerResource, and a view-bound tool that binds another tool's view, a URI no module serves, a resourceUri of null or an openai/outputTemplate other than its _meta.ui.resourceUri fails the boot.

### Features

* **c7:** one Camunda 7 REST spec and its generated route table in @miragon/pulse-c7-core ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **cli:** the CLI renews its tokens by the shared policy of @miragon/pulse-http/oauth ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **cli:** the CLI says on stderr when a URL leaves PULSE_CLI_PROFILE out ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine-core:** @miragon/pulse-engine-core becomes the neutral core of every dialect, from the engine contract of Pulse for VS Code ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine-core:** lower-bound counts, refused conditions and optional migration planning ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine:** the fleet view shows the engine landscape from the engine REST API ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine:** the instance names each incident's element, links its process, and the list's chips count ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine:** the MCP server reads its engines as profiles ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine:** the process flow shows each element's running tokens, read from the engine ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine:** the process flow shows what the instances started in the last 30 days passed ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **http:** one engine transport for the server, the CLI, Pulse for VS Code and Pulse for Orca in @miragon/pulse-http, with the OAuth client protocol in @miragon/pulse-http/oauth ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **orca:** Pulse for Orca, the runtime view of the VS Code extension as an Orca plugin ([#585](https://github.com/Miragon/pulse/issues/585)) ([3f581e8](https://github.com/Miragon/pulse/commit/3f581e8d5d8da0bbf2c18db70d04d55ee5de1170))
* **profile:** one profile format for the CLI, Pulse for VS Code and the MCP server in @miragon/pulse-profile ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **profile:** the CLI and Pulse for VS Code read profiles through @miragon/pulse-profile ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **profile:** the project file is .pulse.json ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **runtime-view:** Pulse for VS Code and Pulse for Orca copy the CLI command that triggers an event behind an event-based gateway ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **ui:** copy the Miragon tokens with .miragon/brand-assets.yaml (miragon-brand 1.32.0) ([#604](https://github.com/Miragon/pulse/issues/604)) ([0bf7af6](https://github.com/Miragon/pulse/commit/0bf7af68a617e878779bbf92e65da3fad9f73bae))
* **ui:** one set of formatters in @miragon/pulse-ui/format for the MCP widgets and the VS Code webview ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))


### Bug Fixes

* bump commander ([#611](https://github.com/Miragon/pulse/issues/611)) ([52555d0](https://github.com/Miragon/pulse/commit/52555d0356c20d63d8ff33a9f34257a6cc46c61b))
* bump gradle-wrapper ([#614](https://github.com/Miragon/pulse/issues/614)) ([63e5d9d](https://github.com/Miragon/pulse/commit/63e5d9d6a0e2179c6a875ad0c08a53a720af29fb))
* bump the npm-dependencies group across 2 directories with 12 updates ([#613](https://github.com/Miragon/pulse/issues/613)) ([8f9e289](https://github.com/Miragon/pulse/commit/8f9e2893e99736abf49d38925e6136004ab4a7f5))
* bump the vscode group across 1 directory with 3 updates ([#612](https://github.com/Miragon/pulse/issues/612)) ([bd3cad2](https://github.com/Miragon/pulse/commit/bd3cad2582546d6e75a6aa89038ebbdc0c50f8fe))
* **c7-adapter:** the C7 adapter of Pulse for VS Code and Pulse for Orca takes incident types, retry targets and failure texts from @miragon/pulse-c7-core ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **c7-adapter:** the C7 adapter sends through @miragon/pulse-http ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **c7-adapter:** the C7 adapter types a written variable by the rules of @miragon/pulse-c7-core ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **c7:** the CLI writes a decimal beyond the range of a double as text, not as a Double without a value ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **c7:** the MCP server's write tools refuse a variable that holds a number beyond the range of a double instead of writing null ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **cli:** a --url or PULSE_CLI_URL without --profile uses no profile ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **cli:** a --url refuses to carry a user profile's headers and credentials to another origin ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **cli:** the CLI sends through @miragon/pulse-http and masks secrets in engine texts ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **cli:** the npm package, the image and the executables ship the licences of the code they bundle ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine:** a failed write or read shows the engine's text only under Details ([#579](https://github.com/Miragon/pulse/issues/579)) ([b19cac6](https://github.com/Miragon/pulse/commit/b19cac61772588615dcde148a5bca45863f52ca5))
* **engine:** a refused engine profile says so at once, in one place, without Try again ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine:** the boot refuses an engine URL with credentials, and its errors show only ids ([e640866](https://github.com/Miragon/pulse/commit/e6408667679e51502fabd70a764765bb3951c1a9))
* **engine:** the cockpit says an engine refused the server's login instead of calling it unreachable ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine:** the engine client sends through @miragon/pulse-http ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine:** the server instructions tell the model to write an integer beyond 2^53 as a string of type Long ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **http:** the CLI runs a bearer token command once for the parallel reads of a call, not once per read ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **mcp-server:** the server image ships the licences of the code it bundles ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **runtime-view:** Pulse for VS Code and Pulse for Orca name the CLI command that triggers a message, signal or timer behind an event-based gateway, and move a token whose event there already occurred ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **runtime-view:** Pulse for VS Code and Pulse for Orca name the columns a board can show instead of promising variable columns ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **runtime-view:** Pulse for VS Code and Pulse for Orca refuse a whole number beyond 64 bits or a number beyond the range of a double before they ask ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **runtime-view:** Pulse for VS Code and Pulse for Orca say what to change in a profile that uses OAuth instead of promising OAuth2 ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **runtime-view:** the move panel and the read-only note of Pulse for VS Code and Pulse for Orca promise no later feature and name what to change ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **vscode:** Pulse for VS Code ships the licences of the code it bundles ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **widget-shell:** a call the ModuleServer does not offer names the module and what it offers ([#581](https://github.com/Miragon/pulse/issues/581)) ([7f2f848](https://github.com/Miragon/pulse/commit/7f2f8481e85b8974e2479856f9495eea73ed0d46))
* **widget-shell:** TestViewHost formats numbers and dates in its own locale ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **widget-shell:** TRACE and other methods the bridge cannot build answer 405, not 500 ([#580](https://github.com/Miragon/pulse/issues/580)) ([c40e722](https://github.com/Miragon/pulse/commit/c40e722e115db2b81d01018185bde66afe255bbb))


### Performance Improvements

* **widget-shell:** one building block from /widgets no longer pulls the view runtime ([#584](https://github.com/Miragon/pulse/issues/584)) ([325b48b](https://github.com/Miragon/pulse/commit/325b48bb35f9c2f4595b0b7ae4a0a8e32e3a6b28))


### Code Refactoring

* **c7:** the Camunda 7 REST family's core is @miragon/pulse-c7-core ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **c7:** the generated Camunda 7 REST SDK is @miragon/pulse-c7-client ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **engine-core:** the root-cause rule of every dialect lives in @miragon/pulse-engine-core ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* the analytics module is gone ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* the boot refuses no former name, and the module port has no retired field ([#578](https://github.com/Miragon/pulse/issues/578)) ([90e10bf](https://github.com/Miragon/pulse/commit/90e10bf7d8c3f5618f38f697d03fae0ab9517071))
* the engine plugin cibseven-history-metrics is gone ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* the server runs on the official MCP SDK, mcp-use is gone ([#575](https://github.com/Miragon/pulse/issues/575)) ([a099386](https://github.com/Miragon/pulse/commit/a0993863ebd25a5bb19efeed0c619f12e356dd9e)), closes [#403](https://github.com/Miragon/pulse/issues/403)
* **ui:** one glossary and one term table for the MCP widgets and the VS Code webview ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **ui:** the tone ladder lives in @miragon/pulse-ui/tones ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))
* **widget-shell:** no host widget map ([46ebe4b](https://github.com/Miragon/pulse/commit/46ebe4b0b60eb0f15bb108ab1bd151adfb1b5262))

## [0.27.1](https://github.com/Miragon/pulse/compare/v0.27.0...v0.27.1) (2026-11-07)


### Bug Fixes

* analytics errors name their way out, and the boot log says what it leaves off ([#568](https://github.com/Miragon/pulse/issues/568)) ([578ae71](https://github.com/Miragon/pulse/commit/578ae719ae06807bf914fda2bfcb72e1a87ffd29))
* **template:** the copied .env runs what compose.yaml can serve, and the Quickstart says what it prints ([#569](https://github.com/Miragon/pulse/issues/569)) ([ffe8a61](https://github.com/Miragon/pulse/commit/ffe8a6137f033f11c5c3f802031a3a1a2d6886e2))

## [0.27.0](https://github.com/Miragon/pulse/compare/v0.26.0...v0.27.0) (2026-11-06)


### ⚠ BREAKING CHANGES

* a server whose MCP_ACTIVE_MODULES names a module it does not compose no longer starts without that module: the boot fails and lists the known modules. Correct or remove the name (module names are exact: engine, analytics and those of your own modules), or leave MCP_ACTIVE_MODULES unset to activate every module.

### Features

* a focused test run, and inner loops that never read a stale dist ([#533](https://github.com/Miragon/pulse/issues/533)) ([69b2d0c](https://github.com/Miragon/pulse/commit/69b2d0cb8d0acb8d097e32c43fc0b0ef7f8596ff))
* **template:** a compose.yaml starts a CIB seven engine to try the engine tools ([#552](https://github.com/Miragon/pulse/issues/552)) ([e83ce8d](https://github.com/Miragon/pulse/commit/e83ce8d8e17af6b4e939095f3ff9a5ac70bf17d1))


### Bug Fixes

* a failed boot names the setting in one line; unknown modules and schemeless URLs fail it ([#547](https://github.com/Miragon/pulse/issues/547)) ([e425980](https://github.com/Miragon/pulse/commit/e4259807882407e81bc81000594d09f483927d6c))
* bump @miragon/modeler-shell ([#563](https://github.com/Miragon/pulse/issues/563)) ([47f0a55](https://github.com/Miragon/pulse/commit/47f0a5566d35bbc3ac2fc3988849d516d096a15e))
* **engine:** a malformed ENGINES_JSON or ENGINES_FILE never echoes its value ([#538](https://github.com/Miragon/pulse/issues/538)) ([410522d](https://github.com/Miragon/pulse/commit/410522d655ef88f5981bcb044d515268dbba4fc7))
* **template:** pins move in lockstep, an unmet peer fails the install ([#541](https://github.com/Miragon/pulse/issues/541)) ([463f852](https://github.com/Miragon/pulse/commit/463f8524936f1fda6ba90e285f9eaedce58b20c6))
* **template:** the container recipe joins the engine's network, and CI starts the try-out engine on Linux ([#558](https://github.com/Miragon/pulse/issues/558)) ([3d1b4f5](https://github.com/Miragon/pulse/commit/3d1b4f555933fc054ef07cdd48c5c4333da89d27))
* **template:** the guard tests follow the composition, not the notes example ([#546](https://github.com/Miragon/pulse/issues/546)) ([58e8fa1](https://github.com/Miragon/pulse/commit/58e8fa1ac56641624d508e957006cff13f9f30ec))
* **template:** the starter formats in the workspace's style, and pnpm format:check holds it ([#554](https://github.com/Miragon/pulse/issues/554)) ([1c5566c](https://github.com/Miragon/pulse/commit/1c5566c966922fe43c0ccceb845f687c057ad9b9))
* **template:** the starter quickstart works as written ([#539](https://github.com/Miragon/pulse/issues/539)) ([afef9b6](https://github.com/Miragon/pulse/commit/afef9b674ba00a99acc022d084d57d93d8a270f3))
* the libraries ship the sources their maps name ([#542](https://github.com/Miragon/pulse/issues/542)) ([320a12e](https://github.com/Miragon/pulse/commit/320a12e58a7f8b8f5c24d0f150f2ac72a9265846))
* **vscode:** a table knows the user left from the commit that rendered its rows ([#564](https://github.com/Miragon/pulse/issues/564)) ([e538408](https://github.com/Miragon/pulse/commit/e5384087b5c654e40203897fccf2d8ccdb92a567))
* **widget-shell:** the OAuth token audience is &lt;MCP_URL&gt;/mcp, plus an identity provider checklist ([#548](https://github.com/Miragon/pulse/issues/548)) ([e7c80bc](https://github.com/Miragon/pulse/commit/e7c80bc3e65d605e4338c53ebae0f9e916e1e348))
* **widget-shell:** warn about each write a module without toolsets leaves open ([#544](https://github.com/Miragon/pulse/issues/544)) ([f376fa7](https://github.com/Miragon/pulse/commit/f376fa727f0bc94c5f2774eddaf58a8043c871b2))

## [0.26.0](https://github.com/Miragon/pulse/compare/v0.25.0...v0.26.0) (2026-11-04)


### ⚠ BREAKING CHANGES

* **engine:** @miragon/pulse-engine-client: fetchJobStacktrace and fetchExternalTaskErrorDetails reject on a 404 instead of resolving null (null stays for an empty body), and readBatch rejects with the engine's error of the history read instead of "Batch <id> not found"; read a 404 with @miragon/pulse-engine-core's isMissing. createEngineClient never follows a redirect: a 3xx rejects with an EngineRequestError. @miragon/pulse-engine-core: isMissing moved from the /testing entry to the main entry; isUnknownEndpoint, RAW_VARIABLES_QUERY and timelineOf are new exports. @miragon/pulse-engine-connector: createBpmnXmlFetcher without an engine id reads on ENGINE_DEFAULT, else the only configured engine, and rejects with ENGINE_NOT_SELECTED when several engines have no default (before: the first configured engine); an unknown id rejects with "Unknown engine id".
* **analytics:** analytics_engine_health's result fields status and statusRule are now metricsState and metricsStateRule. In @miragon/pulse-analytics-client, EngineHealthResult carries metricsState and metricsStateRule, and the export ENGINE_HEALTH_STATUS_RULE is now ENGINE_METRICS_STATE_RULE.
* **engine:** @miragon/pulse-engine-core/testing no longer exports messagePattern (use messageSignature from the entry) or engineStatus (use engineVerdict). readStatus returns critical from 50 open incidents or 25 of one cause by default; pass StatusOptions.thresholds to judge otherwise.
* **analytics:** @miragon/pulse-analytics-client no longer exports `schemas` and has no zod peer. The analytics tools' input schemas belong to @miragon/pulse-analytics-connector and are not exported; a consumer that validated its own input with them declares its own zod schema.

### Features

* **cli:** a JSON Schema for .pulse-cli.json, held to the CLI and the VS Code extension ([#523](https://github.com/Miragon/pulse/issues/523)) ([8f47111](https://github.com/Miragon/pulse/commit/8f47111a6e74743a607fbd74c30f9b5bc695426b))
* **cli:** pulse is the command, pulse-cli stays as an alias ([#522](https://github.com/Miragon/pulse/issues/522)) ([988ba08](https://github.com/Miragon/pulse/commit/988ba08494aee715bb906a29ffd0a5dee574134f))


### Bug Fixes

* **analytics:** analytics_engine_health reports metricsState, not status ([683f65f](https://github.com/Miragon/pulse/commit/683f65fda5014dabaa8a05ab0550f9d368c4bea9))
* **cli:** pulse status groups incidents like the cockpit ([683f65f](https://github.com/Miragon/pulse/commit/683f65fda5014dabaa8a05ab0550f9d368c4bea9))
* **engine:** engine-core judges with the cockpit's thresholds and drops messagePattern ([683f65f](https://github.com/Miragon/pulse/commit/683f65fda5014dabaa8a05ab0550f9d368c4bea9))
* **engine:** one 404 rule, no followed redirects, one BPMN engine pick ([#528](https://github.com/Miragon/pulse/issues/528)) ([9cdc54c](https://github.com/Miragon/pulse/commit/9cdc54caaad2296cac8c6f81825996109527dc3c))
* **engine:** one incident mask and one live verdict for engine_status and the cockpit ([#526](https://github.com/Miragon/pulse/issues/526)) ([683f65f](https://github.com/Miragon/pulse/commit/683f65fda5014dabaa8a05ab0550f9d368c4bea9))
* **vscode:** read .pulse-cli.json by the CLI's rules ([8f47111](https://github.com/Miragon/pulse/commit/8f47111a6e74743a607fbd74c30f9b5bc695426b))
* **vscode:** read a 404 by the engine family's one missing-resource rule ([9cdc54c](https://github.com/Miragon/pulse/commit/9cdc54caaad2296cac8c6f81825996109527dc3c))


### Code Refactoring

* **analytics:** move the tool input schemas into analytics-connector ([#521](https://github.com/Miragon/pulse/issues/521)) ([41b2805](https://github.com/Miragon/pulse/commit/41b280587d90123d799cf7fc36600a2c1a515830))

## [0.25.0](https://github.com/Miragon/pulse/compare/v0.24.2...v0.25.0) (2026-11-03)


### ⚠ BREAKING CHANGES

* the MCP server, its modules and its npm packages change as listed below; docs/mcp/upgrading.md walks through the migration.
* `MCP_ACTIVE_MODULES=camunda7:<toolset>` is `engine:<toolset>`; every `camunda7_*` tool is `engine_*` (`camunda7_engine_status` and `camunda7_engine_health_data` are `engine_status` and `engine_health_data`); every `CAMUNDA_*` setting is `ENGINE_*` (`CAMUNDA_ENGINES_FILE` and `CAMUNDA_ENGINES_JSON` are `ENGINES_FILE` and `ENGINES_JSON`, `CAMUNDA_DEFAULT_ENGINE` is `ENGINE_DEFAULT`) with its value unchanged; the engine plugin's `camunda_*` metrics are `engine_*` with the same labels; `@miragon/pulse-camunda7-client` and `@miragon/pulse-camunda7-connector` are `@miragon/pulse-engine-client` and `@miragon/pulse-engine-connector`. The boot refuses the old module name and every old setting that is set, except `CAMUNDA_USERNAME`, `CAMUNDA_PASSWORD` and `CAMUNDA_TOKEN`, which only warn. Upgrade the engine plugin and the server together and move dashboards and alerts to the new metric names.
* the tools render-view, refresh-view, get-framework-manifest, get-builder-catalogue and the dashboard tools are gone, and so are saved dashboards. `MCP_DASHBOARD_DIR` is no longer read. Modules register through `createPlugin` returning `{ name, register(server) }`.
* a show tool's structuredContent is the view data itself, with no layout envelope. A bundle root calls `mountViews({ views, hostWidgets })`; widget-shell drops `AppShellProviders`, `LocalizedAppView`, `adaptDataWidget` (the `./ui` export), `buildSingleWidgetView`, `buildComposedView`, `settingsLayout` and `shellWidgets`.
* the components, tone model, locale, toasts, formatters and the Miragon theme come from `@miragon/pulse-ui` (`@miragon/pulse-ui/theme.css`) and the brand gates from `@miragon/pulse-ui/testing`; widget-shell no longer exports them, and `@miragon/mcp-toolkit-ui` is no longer used. `TONE_TEXT` is `TONE_INK`; `TOOLKIT_MESSAGES`, `useToolkitMessages` and `toolkitMessages` are `UI_MESSAGES`, `useUiMessages` and `uiMessages`.
* `createToolRegistrar`, `withToolErrors`, `createTranslator` and the catalog types come from `@miragon/pulse-widget-shell/server`; drop `@miragon/mcp-toolkit-core` from your manifests and your Vite dedupe list. Registrar tools always take strict input. The Pulse packages require mcp-use 2.12.2, pinned exactly, also as a peer.
* the settings tools and `camunda7_select_engine` are gone; `DATABASE_URL` and `MCP_PROFILE_DIR` are no longer read, and profile data in Postgres is abandoned. The UI language follows the host locale (German for de*, else English) and tool results for the model are English only. A multi-engine deployment names its default engine with `ENGINE_DEFAULT`. Analytics declares no toolsets.
* **analytics:** analytics_analyze_process_performance, analytics_element_bottleneck, analytics_find_failed_instances, analytics_show_failure_dashboard, analytics_cluster_compare, analytics_show_cluster_compare, analytics_compare_execution_periods, analytics_version_compare, analytics_engine_compare and analytics_engine_landscape are gone; analytics_show_dashboard, analytics_show_period_compare and the other analytics_show_* tools answer their questions, and the incidents open right now come from the engine module. Results use one vocabulary in camelCase and milliseconds (the dashboard's `totalCount` is `startedCount`, analytics_engine_health's `deadJobs` is `failedJobs`), and `@miragon/pulse-analytics-client` exports only its root entry.
* **engine:** the twelve show tools of the engine module (engine health, process list, incidents dashboard, cluster detail, process detail, process incidents, process instances, instance detail, incident detail, BPMN viewer, job panel, history timeline) are gone. `engine_open_cockpit` opens each as a `view` with the ids it needs; its structuredContent is `{ engineId, engines, start }` and its content the view's facts as compact JSON. Widget hand-offs and model contexts name no tool. The heatmap's `durationSec` is `durationMs`.
* `MCP_OAUTH` is gone; set one provider's `MCP_USE_OAUTH_*` variables instead (Keycloak, Auth0, and new WorkOS, Better Auth and Convex), and unset `MCP_OAUTH` in the same deploy: the boot fails while it is still set. `MCP_URL` stays the token audience. `createComposedServer` takes `info`, `modules`, `shared` and `bundle`; `composeModules`, `oauthFromEnv` and the boot's other parts are no longer exported.
* **engine:** `camunda7_get_process_instance` is removed: use `engine_inspect_process_instance`, which also shows ended instances, wait states, root-cause incidents and called instances. `engine_get_activity_instance_tree` is in the admin toolset only. `@miragon/pulse-engine-connector` depends on `@miragon/pulse-engine-core` at runtime.
* **exports:** 83 names that `@miragon/pulse-widget-shell` and `@miragon/pulse-analytics-connector` exported in 0.24 are gone, among them the boot's parts on `/server` (`installMetrics`, `installHealthEndpoints`, `installHttpEdgeGuard`, `resolvePort` and more; boot through `createComposedServer`) and view-runtime internals on `/widgets` (`InlineFitBox`, `DisplayModeToggle`, `useShellHost`, the providers). The starter template imports none of them.
* **engine:** `@miragon/pulse-engine-client` has no `/schemas` entry and no zod peer: the tool input schemas belong to the engine connector and are not exported. The pure engine rules (`toEngineDate`, `engineSorting`, `toEngineVariable(s)`, `incidentRecovery`, `RAW_VARIABLES` and the rest) come from `@miragon/pulse-engine-core`.
* **widgets:** `@miragon/pulse-widget-shell/widgets` no longer exports `BpmnHeatmap`, `HeatmapLegend`, `BpmnHeatmapWidget` and their types. A view that drew the heat renders the host widgets `analytics:process-heatmap` and `analytics:process-heatmap-legend` through `HostWidgetSlot`; a root that spreads `analyticsHostWidgets`, as the template does, needs no change.
* **cli:** `pulse-cli completion` is gone and the Homebrew formula no longer installs a completion script, so Tab completion stops working in a plain shell after upgrading.
* **cli:** the first deploy without --name after the update deploys every resource again under the name pulse-cli, since unchanged files are compared per deployment name; pass --name operate to keep the old deployment line. An external task locked by an earlier advance as operate can be completed once its lock expires, or with --worker-id operate.
* **cli:** pulse-cli no longer reads the names of operate (up to 0.10.0), earlier than the "first release after 2027-01-31" its warning announced: set PULSE_CLI_* instead of OPERATE_* (PULSE_CLI_URL, PULSE_CLI_TOKEN …), rename .operate.json to .pulse-cli.json (the VS Code extension reads only that name too), move ~/.config/operate/config.json to ~/.config/pulse-cli/config.json (Windows: %APPDATA%\pulse-cli) and run pulse-cli auth login once, and call pulse-cli instead of operate (the Homebrew formula no longer links it).

### Features

* **engine-core:** the CLI's workflow domain as @miragon/pulse-engine-core ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **engine:** inline, the cockpit's trail shares the head row ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **engine:** inspect and engine status tools on engine-core ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **vscode:** add boards, shared JSON views across engines ([#474](https://github.com/Miragon/pulse/issues/474)) ([237eb97](https://github.com/Miragon/pulse/commit/237eb974e386ad80835ec6df4024cf2aecfa0a9c))
* **vscode:** search instances by process variables ([#473](https://github.com/Miragon/pulse/issues/473)) ([fe142c9](https://github.com/Miragon/pulse/commit/fe142c9a379607706583bcfb621a6f2a35adffd1))


### Bug Fixes

* bump the npm-dependencies group across 1 directory with 7 updates ([#484](https://github.com/Miragon/pulse/issues/484)) ([a52fc64](https://github.com/Miragon/pulse/commit/a52fc64382e43f5176fb695d2806e05c5a8475eb))
* bump the vscode group across 1 directory with 3 updates ([#502](https://github.com/Miragon/pulse/issues/502)) ([a584b23](https://github.com/Miragon/pulse/commit/a584b23f7b9c540688b6fe0d8aeeba41da4c98d5))
* bump the vscode group with 2 updates ([#478](https://github.com/Miragon/pulse/issues/478)) ([3c5e5bf](https://github.com/Miragon/pulse/commit/3c5e5bf17afa67fc47c56027a261541e075ed61c))
* **cli:** trim trailing slashes in linear time ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **deps:** patch hono, glob, minimatch and the template's vitest ([#511](https://github.com/Miragon/pulse/issues/511)) ([fde9665](https://github.com/Miragon/pulse/commit/fde966532f9d34f2c8311ca7741f55324654bcd0))
* **ui:** read stylesheets, markup and font URLs in linear time ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **vscode:** trim trailing slashes of engine endpoints in linear time ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))


### Code Refactoring

* **analytics:** one tool per analytics question ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **cli:** name the default worker and deployment pulse-cli ([#472](https://github.com/Miragon/pulse/issues/472)) ([7a5384d](https://github.com/Miragon/pulse/commit/7a5384d3aa5c5a216ca72fd00d000e074a4ffc5e))
* **cli:** remove operate's names ([caa6589](https://github.com/Miragon/pulse/commit/caa658952f36c14e8eca74af95cb1e4ea4f533c7))
* **cli:** remove shell completion ([#493](https://github.com/Miragon/pulse/issues/493)) ([29be7fa](https://github.com/Miragon/pulse/commit/29be7fa16c86ae499bf9bb3f4bcee7f3470f9531))
* drop @miragon/mcp-toolkit-core and bump mcp-use to 2.12.2 ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* drop per-user settings, the profile store and Postgres ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* drop the toolkit's dynamic UI layer and own the server boot ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **engine:** give the engine REST rules one home in engine-core ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **engine:** one routed cockpit is the only engine view ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **exports:** trim the published entries to what servers and modules use ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* move the design kit into the new package @miragon/pulse-ui ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* own the view runtime in widget-shell and send plain view data ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* rebuild the MCP server mcp-use first ([#498](https://github.com/Miragon/pulse/issues/498)) ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* rename the camunda7 module, its tools, packages, settings and metrics to engine ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* the boot composes and reads OAuth from mcp-use's own variables ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))
* **widgets:** move the heatmap to analytics behind a host widget ([0b45840](https://github.com/Miragon/pulse/commit/0b45840589d6c369100ea82524d2ccee38bdd3a5))

## [0.24.2](https://github.com/Miragon/pulse/compare/v0.24.1...v0.24.2) (2026-10-26)


### Bug Fixes

* **vscode:** bundle the engine CLI with its dependencies ([#467](https://github.com/Miragon/pulse/issues/467)) ([60cb706](https://github.com/Miragon/pulse/commit/60cb706d0c3a3b02497c9229f1c7765988e33c96))

## [0.24.1](https://github.com/Miragon/pulse/compare/v0.24.0...v0.24.1) (2026-10-26)


### Bug Fixes

* bump body-parser from 2.3.0 to 2.4.0 ([#441](https://github.com/Miragon/pulse/issues/441)) ([75b3688](https://github.com/Miragon/pulse/commit/75b3688de4eca7f39909f789c41cb402469bd5e0))
* **vscode:** publish the extension as miragon-gmbh.pulse-cockpit ([#464](https://github.com/Miragon/pulse/issues/464)) ([47dc189](https://github.com/Miragon/pulse/commit/47dc189beeb540dc1502d76345b0e6758d39cc86))

## [0.24.0](https://github.com/Miragon/pulse/compare/v0.23.0...v0.24.0) (2026-10-26)


### Features

* **vscode:** publish the extension on every release as miragon-gmbh.pulse ([#460](https://github.com/Miragon/pulse/issues/460)) ([e5db43c](https://github.com/Miragon/pulse/commit/e5db43c73535347a483b38538352a339bbba69c1))


### Bug Fixes

* **docs:** open the landing footer's own link in a new tab ([#462](https://github.com/Miragon/pulse/issues/462)) ([a267447](https://github.com/Miragon/pulse/commit/a267447cb6acfbb1e408c57fc8ed6d985c3050f7))

## [0.23.0](https://github.com/Miragon/pulse/compare/v0.22.0...v0.23.0) (2026-10-26)


### Features

* **cli:** install the Claude Code plugin from this repository's marketplace ([#453](https://github.com/Miragon/pulse/issues/453)) ([fd8e324](https://github.com/Miragon/pulse/commit/fd8e3244b825abe92e144ba5cd2e5c3420544a05))

## [0.22.0](https://github.com/Miragon/pulse/compare/v0.21.0...v0.22.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* **cli:** import operate as @miragon/pulse-cli ([#445](https://github.com/Miragon/pulse/issues/445))
* **camunda7:** an engine without a `flavor` is Camunda 7, no longer CIB seven: its cockpit links use the classic Camunda 7 routes and the views, `camunda7_list_engines` and incident drafts name it Camunda 7. A CIB seven or Operaton engine sets `"flavor": "cibseven"` (or `operaton`) on its engine entry, or `CAMUNDA_ENGINE_FLAVOR` next to `CAMUNDA_BASE_URL`.

### Features

* **camunda7:** engines without a flavor are Camunda 7 ([#442](https://github.com/Miragon/pulse/issues/442)) ([355c1b8](https://github.com/Miragon/pulse/commit/355c1b89bf1c98e4f0bfb9df7df830c8496e45d4))
* **cli:** import operate as @miragon/pulse-cli ([#445](https://github.com/Miragon/pulse/issues/445)) ([0d62b83](https://github.com/Miragon/pulse/commit/0d62b83f131304ccfe62c5f9339639898b6772d8))
* **vscode:** import the Pulse VS Code extension ([#451](https://github.com/Miragon/pulse/issues/451)) ([6207cf4](https://github.com/Miragon/pulse/commit/6207cf472db0d2c2f546b42049821265483c6077))

## [0.21.0](https://github.com/Miragon/pulse/compare/v0.20.0...v0.21.0) (2026-10-16)


### ⚠ BREAKING CHANGES

* the npm packages are now @miragon/pulse-widget-shell, @miragon/pulse-camunda7-client, @miragon/pulse-camunda7-connector, @miragon/pulse-analytics-client and @miragon/pulse-analytics-connector (subpaths unchanged; the @miragon-ai packages are deprecated). The server image is ghcr.io/miragon/pulse-server on the GitHub Container Registry; the Docker Hub image miragon/miragon-ai-server stays frozen at 0.20.0. The repo is Miragon/pulse, the starter Miragon/pulse-starter, the playground https://pulse-playground.miragon.ai/mcp. The MCP server introduces itself as pulse (title "Pulse") and logs as [pulse]; the examples register it as pulse. See "Renamed from miragon-ai" in the README.

### Code Refactoring

* rename the repo and everything it ships to Pulse ([0bab7b9](https://github.com/Miragon/pulse/commit/0bab7b9d4d9051b041f564cf071a5de276379bba))

## [0.20.0](https://github.com/Miragon/miragon-ai/compare/v0.19.0...v0.20.0) (2026-10-13)


### ⚠ BREAKING CHANGES

* **widget-shell:** `inlineRowBudget`, `DEFAULT_INLINE_ROWS` and `InlineBudget.rows` are gone, replaced by the measured fit (`InlineFitBox`, `useInlineRows`). `RowsBudgeted` takes the paged list's `rows`. `PagedViewData` gains `fit` and `footerLabels`.
* camunda7_show_user_profile, camunda7_user_profile_data and camunda7_save_user_profile are renamed to camunda7_show_settings, camunda7_settings_data and camunda7_save_settings; the widget id camunda7:user-profile is camunda7:settings; camunda7_save_settings no longer takes language (use shell_save_settings). AppShellProviders and ProfileGate take no profileTool. settingsLayout and filterLayoutToWidgets come from @miragon-ai/widget-shell/widgets, and camunda7's cockpitViews take no view context. A composition root passes { profileStore, allowSave } to createShellPlugin and spreads shellWidgets into its widget registry.
* **camunda7:** the view payloads replace `bpmnXml` with `diagramDefinitionId` (camunda7) or carry no diagram at all (`analytics_show_bpmn_heatmap`, `analytics_bpmn_heatmap_data`). The widgets read the XML from the new app-only feeds `camunda7_bpmn_xml_data` and `analytics_bpmn_xml_data`. `BpmnDiagram` takes `definitionId` (+ `engineId`) instead of `bpmnXml`; `BpmnCanvas` draws XML already in hand.
* **widget-shell:** `buildDataFeedResult` returns `{ content }` only: the feed payload is JSON text, no `structuredContent`. Read it with the toolkit's `parseToolResult`. The `camunda7:bpmnXml` key of `camunda7:load-process-instance` is gone.
* **widget-shell:** `installToolCallLogging` is removed from `@miragon-ai/widget-shell/server` (mcp-use logs requests itself). `MCP_DEBUG_LEVEL` is no longer a known variable; use mcp-use's `MCP_USE_LOG_LEVEL`. A module named twice in `MCP_ACTIVE_MODULES` fails the boot.
* **analytics:** the duration histograms are now `camunda_*_duration_milliseconds` and record milliseconds; the incident counters gain `process_definition_version`; `VersionCompareResult.notes` is removed. Upgrade the engine plugin and the analytics client together; dashboards and alert rules of your own need the new names and the reading rules in metrics-contract.json. A clustered engine needs a unique `service.instance.id` per node.

### Features

* **analytics:** millisecond histograms, versioned incidents, honest first counts and committed-only metrics ([#388](https://github.com/Miragon/miragon-ai/issues/388)) ([28dfa26](https://github.com/Miragon/miragon-ai/commit/28dfa2622c7c26f020e252416979d7c4de02a47a)), closes [#337](https://github.com/Miragon/miragon-ai/issues/337)
* **camunda7:** one action group per view, every action one button size ([#405](https://github.com/Miragon/miragon-ai/issues/405)) ([483d386](https://github.com/Miragon/miragon-ai/commit/483d3868af4f8fd5acb7e33d08d11df2ba3003be))
* **camunda7:** warn at boot that passthrough auth is for trusted single-audience setups only ([#390](https://github.com/Miragon/miragon-ai/issues/390)) ([3c39be9](https://github.com/Miragon/miragon-ai/commit/3c39be9fb715b541b563daf3c4cc4bea17334210)), closes [#330](https://github.com/Miragon/miragon-ai/issues/330)
* the shell owns the UI language and the settings page ([#397](https://github.com/Miragon/miragon-ai/issues/397)) ([8fa4fb3](https://github.com/Miragon/miragon-ai/commit/8fa4fb3f4a83930c304fe08b7cc9496f5ef5d728)), closes [#346](https://github.com/Miragon/miragon-ai/issues/346)
* **widget-shell:** an inline confirmation opens beside its opener ([#400](https://github.com/Miragon/miragon-ai/issues/400)) ([ce80c39](https://github.com/Miragon/miragon-ai/commit/ce80c39d067ae07136058e128b799ea06097142b)), closes [#344](https://github.com/Miragon/miragon-ai/issues/344)
* **widget-shell:** focus after navigation, fullscreen in a drill, no pip, an outlier floor ([#399](https://github.com/Miragon/miragon-ai/issues/399)) ([4657df5](https://github.com/Miragon/miragon-ai/commit/4657df55230e9bc00785cb88a666ef1b15b734a3)), closes [#344](https://github.com/Miragon/miragon-ai/issues/344)
* **widget-shell:** inline lists fit the host's height by measuring their rows ([#404](https://github.com/Miragon/miragon-ai/issues/404)) ([6791363](https://github.com/Miragon/miragon-ai/commit/6791363414ca8089d23288e0c96dd14a7951f4f2))
* **widget-shell:** inline views are cards that fit the host's height budget ([#398](https://github.com/Miragon/miragon-ai/issues/398)) ([1b563e2](https://github.com/Miragon/miragon-ai/commit/1b563e2cbb51b241c2b6cf5566519d7674fadcac)), closes [#396](https://github.com/Miragon/miragon-ai/issues/396)
* **widget-shell:** views ask for a border, the bundle gets a budget ([#401](https://github.com/Miragon/miragon-ai/issues/401)) ([266ab71](https://github.com/Miragon/miragon-ai/commit/266ab71f53f5901ced480ab3ead94b6e768d0713)), closes [#344](https://github.com/Miragon/miragon-ai/issues/344)


### Bug Fixes

* **camunda7:** row actions have the one action size, level with their icon buttons ([#408](https://github.com/Miragon/miragon-ai/issues/408)) ([84fcb31](https://github.com/Miragon/miragon-ai/commit/84fcb314266225c3541fadbb44c584d773a94a8e))
* **camunda7:** the instances list finds an instance by its id, and pages in one order ([#402](https://github.com/Miragon/miragon-ai/issues/402)) ([5207a8e](https://github.com/Miragon/miragon-ai/commit/5207a8e30ccb7c901cb95c3f04fa9542f806969f))
* docs and skills match the code, guarded; connectors declare the toolkit-ui peer ([#395](https://github.com/Miragon/miragon-ai/issues/395)) ([7fff7f4](https://github.com/Miragon/miragon-ai/commit/7fff7f47dd4de3a0f56efadea7a1cc2899c8d257)), closes [#345](https://github.com/Miragon/miragon-ai/issues/345)
* **widget-shell:** the segmented toggle's selection follows its rounded corners ([#406](https://github.com/Miragon/miragon-ai/issues/406)) ([d0423e2](https://github.com/Miragon/miragon-ai/commit/d0423e23052f8ceea63a9989960a08d8bfb9ee98))


### Code Refactoring

* **camunda7:** views name the diagram they draw; the widgets read its XML by id ([#394](https://github.com/Miragon/miragon-ai/issues/394)) ([4169059](https://github.com/Miragon/miragon-ai/commit/416905982a80459cfec6998331df378338faba6f)), closes [#342](https://github.com/Miragon/miragon-ai/issues/342)
* **widget-shell:** feeds answer once, diagrams are read once, summaries claim no UI ([#393](https://github.com/Miragon/miragon-ai/issues/393)) ([8bd2e51](https://github.com/Miragon/miragon-ai/commit/8bd2e519447e8521790ed93c8ec869211b3efc0f)), closes [#342](https://github.com/Miragon/miragon-ai/issues/342)
* **widget-shell:** one request log, one module per name, honest tool-call metrics ([#392](https://github.com/Miragon/miragon-ai/issues/392)) ([4665445](https://github.com/Miragon/miragon-ai/commit/4665445865e91f8d778c5c07e2e6c0c5de6515ef)), closes [#346](https://github.com/Miragon/miragon-ai/issues/346)

## [0.19.0](https://github.com/Miragon/miragon-ai/compare/v0.18.0...v0.19.0) (2026-10-12)


### ⚠ BREAKING CHANGES

* **analytics:** In @miragon-ai/analytics-client, an EngineLandscapeEngine that reports no metrics carries null instead of 0 in every count. The landscape totals' runningInstances, openIncidents and failedJobs are null while no engine reports, and analytics_engine_landscape and its feed send these nulls too. AnalyticsDashboardData requires the new previous and activityCount fields, and dashboardData takes an optional minBucketSize. createBpmnXmlFetcher (camunda7-connector) rejects a failed read instead of resolving null, and resolves null only for a missing definition. FetchBpmnXml (analytics-connector) takes an optional engineId and carries the same contract, so a custom fetcher must reject a failure.
* **camunda7:** In @miragon-ai/camunda7-connector, camunda7_save_user_profile and Camunda7Settings drop preferredRole; the strict tool input refuses it, and a stored value stays inert. UserProfileView requires readOnlyReason ("toolset" | "noSignIn" | null); "noSignIn" is reported for any request without a profile key. The view models require new name and label fields, each null when unknown:
    - Job: processDefinitionName and activityName;
    - ProcessInstanceRow: processDefinitionName;
    - IncidentInstance: businessKey;
    - InstanceDetailData: processDefinitionName;
    - HistoryTimelineData: incidentActivityIds;
    - EngineHealthCluster: activityName and processDefinitionName;
    - ClusterIncidentRow: processDefinitionName;
    - ClusterDetailData: activityName;
    - BpmnViewerData: businessKey and processDefinitionName.
* **widget-shell:** In @miragon-ai/widget-shell/widgets, ViewDataState and QueryFallback require onRetry. QueryFallback no longer takes errorHint: describeError words the failure, and errorTitle heads only a failure it cannot classify. ViewDataState's loadingText is now the optional sr-only status. useDetailView takes refreshErrorTitle instead of refreshErrorText. ListTable requires ariaLabel and renders its table inside a scroll region. TableEmptyState renders the toolkit's EmptyState, with its children as a non-heading title. BpmnHeatmap without a height sizes itself from the diagram's aspect ratio, and HeatmapLegend shows min and max when given. The shell:* widgets' default empty texts are the kit's localized words instead of the dataKey.
* @miragon-ai/widget-shell/widgets no longer exports cn, the tone model (ToneVariant, TONE_*, MICRO_LABEL), KpiGrid/KpiGridSkeleton/KpiCell/KpiGridHeader, LivePill/StatusBadge/CountPill, FilterBar/FilterChip, WidgetHeader, PagedListFooter, SectionHeading, GroupCard, DrillButton, ListFooter, useDebouncedValue, parseToolResult/parseViewToolResult, useHostActions/buildShowWidgetIntent/HostActions, useViewToolQuery, useViewData or ViewDataResult. Import them from @miragon/mcp-toolkit-ui (or its /app and /hooks subpaths), and use useViewData with initialDataMode "seed" plus the new viewRefreshState. camunda7's CockpitListFooter and its listFooter.* catalog keys are gone. The @miragon/mcp-toolkit-* peer range is ~2.8.0.
* The in-app theme switch is gone. The profile record, the camunda7 settings panel and camunda7_save_user_profile no longer carry a theme, and the save tool rejects the key. widget-shell no longer exports THEMES or ThemePref, and useApplyTheme() takes no argument; widgets follow the host's theme, then the OS's. @miragon-ai/widget-shell no longer ships ./theme.css. A consumer stylesheet imports tailwindcss, adds an @source for node_modules/@miragon/mcp-toolkit-ui/src, imports @miragon/mcp-toolkit-ui/theme.css and overrides role variables only; the template's brand.css shows how. The --m-* accents and the critical tone no longer exist. The @miragon/mcp-toolkit-* peer range is ~2.7.0, and a host bundle that dedupes lucide-react needs a 1.x version.
* **camunda7:** EngineHealthData drops `headline`; the verdict is `status` plus `summary`, worded by its reader. IncidentsDashboardData, ProcessIncidentsData and IncidentDetailData require `engineVendor`. The CIB seven provider's display name is "CIB seven". Several camunda7 catalog keys changed: the hand-off labels (`handOff.*`), the former `…One`/`…Other` plural pairs and several messages. The show tools' view titles come from the profile language, or are absent.
* **widget-shell:** The widget-shell tone vocabulary drops `critical` (use `danger`) and `TONE_TEXT` (use `TONE_INK`; numbers stay neutral, and a state is a dot, edge or icon). `WidgetHeader` no longer takes `icon`/`iconTone`. The tone colours live in `@miragon-ai/widget-shell/theme.css`, and the `--critical*` and `--*-foreground` tone tokens are gone from the app and template stylesheets; override `--<tone>`, `--<tone>-soft` and `--<tone>-ink` instead. `formatDuration` renders German units in a German view. The kit peers on `lucide-react` (`^0.562.0 || ^1.0.0`), which a consumer installs and appends to its vite `dedupe` list.
* In @miragon-ai/widget-shell, PagedViewData.error now carries only the page-0 failure; load-more failures move to the new loadMoreError, and retry, refreshing and stale are added. firstPage keeps the previous result of the same list while a new page 0 is in flight or has failed. camunda7:process-definition-flow drops its initialMode prop. camunda7_open_cockpit lists only the caller's engines (allowedEngineIds) and refuses an `engine` outside them with ENGINE_NOT_AVAILABLE instead of opening the picker.
* **widget-shell:** The profile language gains "system" (follow the host locale) and defaults to it, so ProfileRecord.language and the camunda7 UserProfile.language are now LanguagePref. View stylesheets import @miragon-ai/widget-shell/theme.css after tailwindcss, plus an @source for the toolkit's src, instead of @miragon/mcp-toolkit-ui/globals.css, and Geist is no longer shipped. ViewDisplayModeBridge is replaced by ViewHostBridge, and AppShellProviders no longer mounts mcp-use's ThemeProvider. ProfileGate holds the first paint until the profile answers: at most 1.5 s after the host connects, 5 s without a host. BpmnZoomControls sit top-right.
* AskAiButton's `prompt` accepts only an `AskAiPrompt` built by `askAiPrompt` from `@miragon-ai/widget-shell/widgets`: a raw string no longer compiles, and `null` renders no button. `@miragon-ai/camunda7-connector` no longer exports `CAMUNDA7_ENGINELESS_TOOLS`. `camunda7_format_incident_issue` and the `draft_incident_ticket` prompt drop their `repository` argument: drafts target only the configured `CAMUNDA_INCIDENT_ISSUE_REPO`, and without one there is no prefilled URL.
* **analytics:** analytics reads only the server's configured engines: camunda7's engine ids, else ANALYTICS_ENGINE_IDS, else every analytics tool refuses. It refuses any other `engine` id. analytics_engine_health returns `unknown` (a new status) for silent engines and only counts alerts scoped to them. @miragon-ai/analytics-client renames or removes result fields without aliases:
    - dashboard runningCount/failedCount/incidentCount/failureRatePct → runningNow/openIncidentsNow/incidentsCreated/incidentsResolved/incidentRatePct;
    - failureDashboardData.processBreakdown totalInstances/failedCount/incidentCount/failureRatePct → runningNow/deadJobs/openIncidents/incidentRatePct;
    - definitionBreakdown running/failed → runningNow/incidentsCreated;
    - activityBreakdown rows drop activityName and gain processDefinitionKey;
    - analyzePerformance/comparePeriods failed/failure_rate_pct → incident_count/incident_rate_pct, and analyzePerformance drops earliest/latest;
    - compare failed_count/failure_rate_pct and the failure-rate delta are removed, instance_count_delta_pct → started_per_day_delta_pct, and element-scoped incidents move to element_incident_*;
    - failure-dashboard and find-failed rows carry only incident type, process and counts;
    - durations and rates are null when not measured;
    - every engine-filterable result gains `engines`, and findFailedInstances returns { engines, patterns }.
* **camunda7:** camunda7 view payloads change meaning and shape. The definition view, the cockpit landscape and the incidents dashboard count every version of a key. ProcessIncidentsData.version is now diagramVersion; DefinitionStat.version and IncidentsDashboardProcess.version are now latestVersion; IncidentsDashboardProcess.totalActivityCount is gone; per-activity incidentCount is now scannedIncidentCount. Health and cluster counts follow the ClusterCounts shape: incidentCount is nullable, with scannedIncidentCount and a nullable last24hCount. Numbers the server cannot vouch for are null instead of 0: affected activities, the 24h and first-seen facts of a partial scan, siblingsWithIncidents and BpmnViewerData.bpmnXml. InstanceDetailData gains exact incidentCount/openTaskCount. BpmnViewerData gains statsScope and, in instance mode, counts only the instance's own tokens and failed jobs. The process-instance list reports totals over the whole filtered set. Engine failures and unknown ids are tool errors instead of empty views. The pipeline steps throw on failure and stamp engineId. The incidents-dashboard step reads its scope from camunda7:incidentsProcessDefinitionKey instead of camunda7:processDefinitionKey.
* @miragon-ai/widget-shell/server no longer exports `mergeRawSlice` (save a slice with `saveModuleSlice`) or `mergeProfile` (use `mergeStoredProfile(...).record`). `ComposableModule.supportsToolsets` is removed: a module without a `toolsets` vocabulary is a module without toolsets, so its suffix is ignored with a warning and its config never carries a `toolset`. `EffectiveToolset.source` no longer has the `"legacy"` value. Profile records stored below schema v3 are no longer migrated: they are adopted at schema v3, their flat v1/v2 module fields stay inert, and those preferences read as their defaults.
* camunda7_engine is gone: camunda7_list_engines (read-only) lists the engines and the saved default, and camunda7_select_engine saves it. The camunda7 `engine` parameter is advertised as an enum of the configured ids, so an unknown id now fails input validation instead of returning UNKNOWN_ENGINE. camunda7_list_process_definitions and camunda7_list_deployments return the { items, totalCount, hasMore, nextOffset? } envelope instead of a bare array. Every model-visible maxResults is capped at 100, and camunda7_show_history_timeline defaults to 100 (was 500). The model-facing variable reads cut string values over 2000 characters (truncated: true, valueLength); pass variableName to read one variable whole. Writes declare destructiveHint: false explicitly. BootComposition (createComposedServer) requires the composition's `instructions` member, and module snippets are appended to the server instructions. Advertised input schemas drop $schema and the safe-integer bounds.
* camunda7 and analytics tools, including show tools and app-only feeds, now reject unknown input keys with a tool error that lists the valid ones, instead of ignoring them. Parameters were renamed without aliases: camunda7_list_process_definitions, camunda7_show_process_list and camunda7_process_list_data take processDefinitionKey (was key); camunda7_get_deployment takes deploymentId (was id); camunda7_query_historic_task_instances takes assignee (was taskAssignee); camunda7_show_process_instances, camunda7_process_instances_data and the process-instances widget take withIncidents (was withIncidentsOnly; the echoed filters follow); analytics_find_failed_instances and analytics_element_bottleneck take maxResults (was limit, also in the analytics-client params); and the analytics cluster/engine/version compare tools and their show twins take activityId (was elementId; VERSION_ELEMENT_SCOPE_NOTE is now VERSION_ACTIVITY_SCOPE_NOTE). A false boolean filter is no longer forwarded: it is sent as its complementary flag or dropped. A complementary pair that asks for both states or neither is refused. A …Like filter without % now matches a substring instead of the exact value.
* A client-supplied Mcp-Session-Id is no longer a profile key, and a missing request context no longer maps to the shared `anonymous` record. Without MCP_OAUTH there is no caller identity: settings show defaults and saves refuse. MCP_PROFILE_SESSION_TTL_DAYS and REDIS_URL are no longer read. widget-shell drops startProfileSessionCleanup, isExpiredSessionRecord, ProfileStore.cleanupSessions, ProfileAuthContext and McpRequestInfo.sessionId; `anonymousCaller` declares the local caller instead. MCP_OAUTH is parsed strictly by widget-shell's oauthFromEnv, so `oidc`/`oidc-proxy` and the ignored `audience` key now fail the boot as invalid config. camunda7's EngineRegistry.defaultEngineId lookup now receives the tool call's ctx.
* **camunda7:** camunda7_handle_external_task_failure (and the exported handleExternalTaskFailureInput) requires retries; camunda7_set_job_retries_batch and camunda7_migrate_process_instances_async return { batchId, status: "queued", type, totalJobs, … } instead of { success: true, …, batch }; camunda7_complete_task submits the task form (/submit-form) only for a task with form fields, so the engine rejects a completion that violates those fields while omitted fields keep their value, a task without form fields still completes through /complete, and a delegated task is resolved back to its owner and stays open (outcome "resolved"); camunda7_get_task_form fails for an unknown task instead of returning empty fields; variable reads return Json/Xml/Object values serialized (a string plus valueInfo) instead of deserialized; date filters and Date variables refuse non-ISO-8601 input.

### Features

* adopt the toolkit's Miragon theme (toolkit 2.7.0) and drop the in-app theme switch ([#382](https://github.com/Miragon/miragon-ai/issues/382)) ([1f6f6e5](https://github.com/Miragon/miragon-ai/commit/1f6f6e5c1d8792d6d991363b354688b0d2179028))
* **analytics:** Lucide hand-offs, brand-tone copy, honest comparisons and a shared vocabulary ([#380](https://github.com/Miragon/miragon-ai/issues/380)) ([6db8405](https://github.com/Miragon/miragon-ai/commit/6db84056379b9b029673c1712744c96fe46ca16d))
* **analytics:** names before ids, honest unknowns and one severity ladder in the analytics views ([#387](https://github.com/Miragon/miragon-ai/issues/387)) ([bcd40b5](https://github.com/Miragon/miragon-ai/commit/bcd40b5c95637ef9b00925c0a71ecee5efae6a05))
* build every Ask-AI hand-off with askAiPrompt — fenced engine text, localized intents, live tool surface ([#373](https://github.com/Miragon/miragon-ai/issues/373)) ([2fe8492](https://github.com/Miragon/miragon-ai/commit/2fe8492773cc0858e71ca4fd0af32a51c4e2200c))
* **camunda7:** context line, names before ids and one primary action in the camunda7 views ([#386](https://github.com/Miragon/miragon-ai/issues/386)) ([d06ad38](https://github.com/Miragon/miragon-ai/commit/d06ad3862726cc58d559ac24a365b0641afa5993))
* **camunda7:** Lucide icons, chat hand-offs and brand-tone copy in the camunda7 widgets ([#379](https://github.com/Miragon/miragon-ai/issues/379)) ([f773444](https://github.com/Miragon/miragon-ai/commit/f773444c4d53a5960c76b7a8f4aaef3d78d01845))
* **camunda7:** run every in-widget write through useEngineAction — named confirmations, targeted refresh, seeded standalone views ([#376](https://github.com/Miragon/miragon-ai/issues/376)) ([01bf2fa](https://github.com/Miragon/miragon-ai/commit/01bf2fa74d2ce9d37b1324d5c32999e8916e868b))
* **deps:** bump @miragon/mcp-toolkit-* to 2.6.0 and mcp-use to 2.7.3 ([#362](https://github.com/Miragon/miragon-ai/issues/362)) ([62a8879](https://github.com/Miragon/miragon-ai/commit/62a88791404648228e0af21c13445b0dbe171d42))
* **docs:** align the docs site with the Miragon CI dark theme ([#350](https://github.com/Miragon/miragon-ai/issues/350)) ([#369](https://github.com/Miragon/miragon-ai/issues/369)) ([017fe4d](https://github.com/Miragon/miragon-ai/commit/017fe4dd5ed4cb65603430feb61d47c8403d7d63))
* LLM surface trims — engine enum + server instructions, camunda7_engine split, one pagination contract, historic incidents, labelled health verdicts ([#368](https://github.com/Miragon/miragon-ai/issues/368)) ([11d7d8a](https://github.com/Miragon/miragon-ai/commit/11d7d8a648ca1578322c8b9f3bfa11e16c6fe88b))
* **widget-shell:** kit layout, states, feedback and BPMN tokens on the Miragon CI ([#385](https://github.com/Miragon/miragon-ai/issues/385)) ([a7f2b16](https://github.com/Miragon/miragon-ai/commit/a7f2b1606de0bb15e97e54a5c2834a9dc867ff68))
* **widget-shell:** lay the Miragon design-system foundation in the kit ([#378](https://github.com/Miragon/miragon-ai/issues/378)) ([242ec19](https://github.com/Miragon/miragon-ai/commit/242ec19bebea74f2fa929fca39dfdfb6071d57ca))
* **widget-shell:** serve Geist and Geist Mono from the server and load them in every view ([#384](https://github.com/Miragon/miragon-ai/issues/384)) ([1261745](https://github.com/Miragon/miragon-ai/commit/12617454a9473b1f9bdb113e5ac3cf1b6c92a29a))


### Bug Fixes

* **analytics:** report only what the metrics measure — unknown health, live gauges, null durations, clamped windows, configured engines ([#372](https://github.com/Miragon/miragon-ai/issues/372)) ([60e20bc](https://github.com/Miragon/miragon-ai/commit/60e20bc302e7828396c3e18a1b91243661754766))
* **camunda7:** honour the engine REST contract in tools, feeds and widgets ([#365](https://github.com/Miragon/miragon-ai/issues/365)) ([c5d5f69](https://github.com/Miragon/miragon-ai/commit/c5d5f696d974b04dc080ffd02d3993792867de94))
* **camunda7:** report honest camunda7 numbers — key-wide views, counts over capped scans, errors over zeros ([#371](https://github.com/Miragon/miragon-ai/issues/371)) ([0bfbabc](https://github.com/Miragon/miragon-ai/commit/0bfbabc456f7a884dee74ab8dab99ab8abc1dbd1))
* **camunda7:** resolve real definition keys in the data builders and echo the incidents-dashboard filters ([#374](https://github.com/Miragon/miragon-ai/issues/374)) ([594ed37](https://github.com/Miragon/miragon-ai/commit/594ed37ca100484e95bb17716798fad6021960bd))
* open the cockpit on its resolved engine, keep paged lists mounted while they fetch, gate the heatmap on analytics and read tenant diagrams by id ([#377](https://github.com/Miragon/miragon-ai/issues/377)) ([2f6f56c](https://github.com/Miragon/miragon-ai/commit/2f6f56ca7e06cf8eb01b6a438acdb81ab8c95b86))
* profile persistence keeps unknown keys, serializes writes and degrades on store outages ([#363](https://github.com/Miragon/miragon-ai/issues/363)) ([e900ac9](https://github.com/Miragon/miragon-ai/commit/e900ac96cebf5ad4b140dda6d73d7b768807285e))
* refuse unknown tool inputs and give the tools the filters their prompts promise ([#367](https://github.com/Miragon/miragon-ai/issues/367)) ([3024da1](https://github.com/Miragon/miragon-ai/commit/3024da114678767c6de3fb4d94b0bdc2d26d47f1))
* resolve caller identity from OAuth only, wired through widget-shell's oauthFromEnv ([#366](https://github.com/Miragon/miragon-ai/issues/366)) ([cdd40a1](https://github.com/Miragon/miragon-ai/commit/cdd40a1daa46b425c578158635780d9517949721))
* **widget-shell:** follow the host — theme, locale, height, fonts, BPMN canvas, fullscreen ([#375](https://github.com/Miragon/miragon-ai/issues/375)) ([eca2918](https://github.com/Miragon/miragon-ai/commit/eca29184b2c29c891e80c9d7a440ed96cf20d8e2))


### Code Refactoring

* move to toolkit 2.8.0 — one kit, the toolkit's seeded views and builder titles ([#383](https://github.com/Miragon/miragon-ai/issues/383)) ([bbe64a7](https://github.com/Miragon/miragon-ai/commit/bbe64a7f68166da15d1e101780d01497544aae2d))
* remove the pre-production compat paths ([#370](https://github.com/Miragon/miragon-ai/issues/370)) ([29c9f98](https://github.com/Miragon/miragon-ai/commit/29c9f98ca8f06323e2c7164a3a8f46aa10132b69))

## [0.18.0](https://github.com/Miragon/miragon-ai/compare/v0.17.0...v0.18.0) (2026-10-09)


### ⚠ BREAKING CHANGES

* **server:** requests whose Host (or, on non-GET requests, Origin) is not localhost-class, MCP_URL's or allow-listed via MCP_ALLOWED_HOSTS / MCP_ALLOWED_ORIGINS get 403 (`*` disables a check), so a server reached under a public name must set MCP_URL or the allow-lists; request bodies over MCP_MAX_BODY_BYTES (default 4194304) get 413; MCP_OAUTH now requires MCP_URL; and camunda7_engine "list", UserProfileView.availableEngines and CockpitEngineInfo no longer carry the engine REST baseUrl.
* **analytics:** @miragon-ai/analytics-client's VersionCompareKpi failed_count, failure_rate_pct, incident_count and incident_rate_pct (and the two rate deltas) are now `number | null` and always null, and VersionCompareResult gains a required `notes: string[]`. analytics_version_compare and analytics_show_version_compare report these KPIs as unavailable instead of 0; the previous zeros were never measured values.
* toolsets fail closed. Without a suffix in MCP_ACTIVE_MODULES a module no longer gets every tool: unauthenticated boots (no MCP_OAUTH) run each module read-only; with MCP_OAUTH the defaults are camunda7:operations and the new analytics:standard; admin is reached only by naming it; an empty (camunda7:) or unknown suffix falls back to read-only, even under OAuth. camunda7_create_deployment additionally requires CAMUNDA_ALLOW_DEPLOYMENTS=true (deploying is code execution inside the engine JVM). camunda7_throw_signal and the external-task worker protocol (fetch_and_lock, complete_external_task, handle_external_task_failure) are admin-only; the new camunda7_list_external_tasks (read-only) and camunda7_set_external_task_retries (operations) cover reading and recovering external tasks. The dashboard builder and its tools need OAuth and no read-only module. A server behind an auth-terminating gateway looks unauthenticated and must name its toolsets. Restore the previous surface with MCP_ACTIVE_MODULES=camunda7:admin,analytics:standard (+ CAMUNDA_ALLOW_DEPLOYMENTS=true for deployments, MCP_OAUTH for dashboards). Package API: a direct createPlugin call without `toolset` (camunda7 or analytics) now registers the read-only floor, so pass the toolset explicitly (camunda7 also needs `allowDeployments: true` for deployments); createToolsetVocabulary().resolve(undefined) returns the floor instead of undefined, and ToolsetVocabulary gained module/fallback/authenticatedDefault/effective/allowsDurableWrites, so build vocabularies with createToolsetVocabulary; modules declare `toolsets` instead of the deprecated supportsToolsets (which keeps a raw pass-through but blocks the dashboard builder); composed servers boot via composeModules().resolveBoot(env, { authenticated }) and logEffectiveToolsets.

### Features

* fail-closed toolset defaults and opt-in deployments ([#351](https://github.com/Miragon/miragon-ai/issues/351)) ([005cdd9](https://github.com/Miragon/miragon-ai/commit/005cdd9d97d9909348723f91f3a0bfe3cf47f1ec))


### Bug Fixes

* **analytics:** version-compare incident KPIs unavailable instead of 0; label-checked metrics contract ([#356](https://github.com/Miragon/miragon-ai/issues/356)) ([144f410](https://github.com/Miragon/miragon-ai/commit/144f4103e42902266f6adfd03546008afa229e59))
* **camunda7,analytics:** actionable engine errors, upstream timeouts and Prometheus auth ([#357](https://github.com/Miragon/miragon-ai/issues/357)) ([8d1045d](https://github.com/Miragon/miragon-ai/commit/8d1045d7db81f41fcc488ff9839df92b58d9337f))
* **camunda7:** send deployment resources as real multipart parts ([#355](https://github.com/Miragon/miragon-ai/issues/355)) ([dab051c](https://github.com/Miragon/miragon-ai/commit/dab051ca7c0eebec1629e566104a33f5ae5f654b))
* **server:** DNS-rebinding protection, pre-auth body cap, graceful drain and one createApp factory ([#358](https://github.com/Miragon/miragon-ai/issues/358)) ([e1fa024](https://github.com/Miragon/miragon-ai/commit/e1fa0244ee13e416f1c8131277169c4b7de85edb))

## [0.17.0](https://github.com/Miragon/miragon-ai/compare/v0.16.0...v0.17.0) (2026-09-30)


### Features

* **deps:** bump @miragon/mcp-toolkit-* to 2.5.0 and mcp-use to 2.7.1 ([#316](https://github.com/Miragon/miragon-ai/issues/316)) ([ad0edd8](https://github.com/Miragon/miragon-ai/commit/ad0edd857ed2b61c1ad75056cf91fcb3b76077d8))


### Bug Fixes

* bump the npm-dependencies group with 17 updates ([#314](https://github.com/Miragon/miragon-ai/issues/314)) ([f9b9e2e](https://github.com/Miragon/miragon-ai/commit/f9b9e2e53601ac9cf97fc8ce5a964196e96dd7eb))

## [0.16.0](https://github.com/Miragon/miragon-ai/compare/v0.15.0...v0.16.0) (2026-09-23)


### Features

* **camunda7:** hide widget actions and views the deployment does not expose ([#307](https://github.com/Miragon/miragon-ai/issues/307)) ([687f780](https://github.com/Miragon/miragon-ai/commit/687f78088b9c35ad58a1eb91e853c7472d0f7166))

## [0.15.0](https://github.com/Miragon/miragon-ai/compare/v0.14.0...v0.15.0) (2026-09-21)


### Features

* **deps:** publish consumer-shared libraries as ranged peerDependencies ([#305](https://github.com/Miragon/miragon-ai/issues/305)) ([7e48000](https://github.com/Miragon/miragon-ai/commit/7e480009c45ca4a6f7a3b6b7de2321c3602b5488))


### Bug Fixes

* **ci:** cut releases for runtime dependency bumps ([#301](https://github.com/Miragon/miragon-ai/issues/301)) ([387a4dd](https://github.com/Miragon/miragon-ai/commit/387a4dd4a24247fe5843a3ab9e4804d0a2509869))

## [0.14.0](https://github.com/Miragon/miragon-ai/compare/v0.13.0...v0.14.0) (2026-09-10)


### Features

* **server:** health probes and Prometheus metrics next to /mcp ([#290](https://github.com/Miragon/miragon-ai/issues/290)) ([e04a462](https://github.com/Miragon/miragon-ai/commit/e04a462fb0eab7a183288ad803f1ea0febb20925))

## [0.13.0](https://github.com/Miragon/miragon-ai/compare/v0.12.0...v0.13.0) (2026-09-09)


### Features

* **camunda7:** environment-map engine config with two-stage selection ([#276](https://github.com/Miragon/miragon-ai/issues/276)) ([6483480](https://github.com/Miragon/miragon-ai/commit/6483480e31772c8d42c37d4f6bb722d59ed3c6dc))

## [0.12.0](https://github.com/Miragon/miragon-ai/compare/v0.11.0...v0.12.0) (2026-08-17)


### Features

* **widget-shell:** share the Postgres persistence layer with composed servers ([#258](https://github.com/Miragon/miragon-ai/issues/258)) ([c1b3037](https://github.com/Miragon/miragon-ai/commit/c1b30371f4c0c090fd75d17dfcacbb13e550e8b6))

## [0.11.0](https://github.com/Miragon/miragon-ai/compare/v0.10.0...v0.11.0) (2026-08-17)


### Features

* starter-template DX — self-sufficient dev loop, install guards, headless verification ([#256](https://github.com/Miragon/miragon-ai/issues/256)) ([46f5d89](https://github.com/Miragon/miragon-ai/commit/46f5d89cc8cabecb45a9fb51159a31055a733069))

## [0.10.0](https://github.com/Miragon/miragon-ai/compare/v0.9.0...v0.10.0) (2026-08-15)


### Features

* **widget-shell:** share the host app shell and boot helpers with composed servers ([#253](https://github.com/Miragon/miragon-ai/issues/253)) ([8c20434](https://github.com/Miragon/miragon-ai/commit/8c2043464b60320f9a26008144409fc3221907f5))

## [0.9.0](https://github.com/Miragon/miragon-ai/compare/v0.8.0...v0.9.0) (2026-08-14)


### ⚠ BREAKING CHANGES

* **camunda7:** `cockpitViews.settings()` no longer takes zero arguments. Every builder in `cockpitViews` is now typed `(params: ViewParams, ctx?: ViewContext) => LayoutConfig`, so callers pass the route params plus, for the composed settings view, the host's widget ids: `cockpitViews.settings(params, { widgetIds })`. Called without the context it yields camunda7's own section alone.

### Features

* **camunda7:** assemble the settings page from the host widget registry ([#251](https://github.com/Miragon/miragon-ai/issues/251)) ([a4eda7e](https://github.com/Miragon/miragon-ai/commit/a4eda7e90dc4410ea26db44371dbadcfdb34b2a1))

## [0.8.0](https://github.com/Miragon/miragon-ai/compare/v0.7.0...v0.8.0) (2026-08-13)


### ⚠ BREAKING CHANGES

* **repo:** the npm packages @miragon-ai/mcp-camunda7, @miragon-ai/client-camunda7, @miragon-ai/mcp-analytics and @miragon-ai/client-analytics are renamed to @miragon-ai/camunda7-connector, @miragon-ai/camunda7-client, @miragon-ai/analytics-connector and @miragon-ai/analytics-client; the old names stay behind on the registry.

### Code Refactoring

* **repo:** split packages into core/connectors and extract the platform core into widget-shell ([#244](https://github.com/Miragon/miragon-ai/issues/244)) ([f5605d2](https://github.com/Miragon/miragon-ai/commit/f5605d21d0260702d81d525f2554dcfd7ea1ff44))

## [0.7.0](https://github.com/Miragon/miragon-ai/compare/v0.6.0...v0.7.0) (2026-08-12)


### ⚠ BREAKING CHANGES

* **analytics:** `analytics_engine_compare` and `analytics_show_engine_compare` reject calls without `processDefinitionKey`.

### Features

* **analytics:** cross-engine landscape; engine_compare requires a process key ([#242](https://github.com/Miragon/miragon-ai/issues/242)) ([0faf5fb](https://github.com/Miragon/miragon-ai/commit/0faf5fb0649ef779ca667add82b962a7efe731a0))

## [0.6.0](https://github.com/Miragon/miragon-ai/compare/v0.5.1...v0.6.0) (2026-08-11)


### ⚠ BREAKING CHANGES

* MCP_OAUTH providers "oidc"/"oidc-proxy" now fail the boot (upstream removed jwksVerifier/oauthProxy); REDIS_URL session sharing is ignored (the pluggable backend seam is gone); persisted user settings and the sticky engine selection require MCP_OAUTH (stateless HTTP has no session ids).

### Features

* **engine-plugins:** record process metrics via Micrometer ([#226](https://github.com/Miragon/miragon-ai/issues/226)) ([abe2b9c](https://github.com/Miragon/miragon-ai/commit/abe2b9c8b73b7e885934e6729d87a8c3b607872b))
* migrate to @miragon/mcp-toolkit 1.1.0 on mcp-use 2 ([#239](https://github.com/Miragon/miragon-ai/issues/239)) ([538ce47](https://github.com/Miragon/miragon-ai/commit/538ce47ba2ac01929b3411d0e097dcece021df0e))

## [0.5.1](https://github.com/Miragon/miragon-ai/compare/v0.5.0...v0.5.1) (2026-08-07)


### Bug Fixes

* **docker:** keep the pnpm store in the image layer, not a cache mount ([#209](https://github.com/Miragon/miragon-ai/issues/209)) ([d9f6d7a](https://github.com/Miragon/miragon-ai/commit/d9f6d7aae1aa8346305fc6c3c0b36f54b9ee0fa8))

## [0.5.0](https://github.com/Miragon/miragon-ai/compare/v0.4.0...v0.5.0) (2026-08-05)


### Features

* give the composed-server template a loaded .env.example ([#208](https://github.com/Miragon/miragon-ai/issues/208)) ([5fc31fe](https://github.com/Miragon/miragon-ai/commit/5fc31fe4d0a442c93d6d5b82cd10fa85b67408bd))


### Bug Fixes

* **ci:** gate npm publish behind release approval ([#205](https://github.com/Miragon/miragon-ai/issues/205)) ([2a28651](https://github.com/Miragon/miragon-ai/commit/2a286516daf70d933d7fff931e2547db60032ecf))

## [0.4.0](https://github.com/Miragon/miragon-ai/compare/v0.3.0...v0.4.0) (2026-08-05)


### Features

* align the single-engine id with the metrics engine_id label ([#201](https://github.com/Miragon/miragon-ai/issues/201)) ([7188ebc](https://github.com/Miragon/miragon-ai/commit/7188ebc9cccdc3c822dc4045dec1d33f06733968))
* composed-server template — build your own server from the npm modules ([#203](https://github.com/Miragon/miragon-ai/issues/203)) ([fa4837f](https://github.com/Miragon/miragon-ai/commit/fa4837f2f5cc5359c731c8c458d4e444848f7217))

## [0.3.0](https://github.com/Miragon/miragon-ai/compare/v0.2.1...v0.3.0) (2026-08-04)


### ⚠ BREAKING CHANGES

* drop upstream/proxy federation — an external MCP gateway takes over ([#162](https://github.com/Miragon/miragon-ai/issues/162))

### Features

* **camunda7:** unify cockpit list pagination, filtering, and item UI ([#171](https://github.com/Miragon/miragon-ai/issues/171)) ([89b3070](https://github.com/Miragon/miragon-ai/commit/89b3070de756f782dfb90f7a9be1d452595b2f13))
* dialect-true package composition — renames, module contract, engine provider port ([#167](https://github.com/Miragon/miragon-ai/issues/167)) ([c1d737f](https://github.com/Miragon/miragon-ai/commit/c1d737f0299dda7a573bd453dcb887ad333bfe28))
* **docs:** cookie consent via consentmanager, like the marketing site ([#151](https://github.com/Miragon/miragon-ai/issues/151)) ([c88b750](https://github.com/Miragon/miragon-ai/commit/c88b750ebf7c8e1a3aec010a86c917c0354cd0a7))
* **docs:** hero "Try it out" button opens the MCP inspector ([#152](https://github.com/Miragon/miragon-ai/issues/152)) ([37b20dc](https://github.com/Miragon/miragon-ai/commit/37b20dcad09f85025b848ad0555a3ce670615157))
* **docs:** prominent "Try it out" CTA with example prompt ([#153](https://github.com/Miragon/miragon-ai/issues/153)) ([5c63368](https://github.com/Miragon/miragon-ai/commit/5c6336811a2303c783c0f5a12b15a23876aca2e2))
* **docs:** redesign the landing hero around a live conversation ([#154](https://github.com/Miragon/miragon-ai/issues/154)) ([fe654f9](https://github.com/Miragon/miragon-ai/commit/fe654f99c99b31278af7849fb6f0a9a61a9ce64e))
* drop upstream/proxy federation — an external MCP gateway takes over ([#162](https://github.com/Miragon/miragon-ai/issues/162)) ([ad09d8a](https://github.com/Miragon/miragon-ai/commit/ad09d8a9293f9ef781e08b83a0bbbd5dbcd1fdad))
* durable user settings — Postgres persistence, modular settings page, auth-scoped profiles ([#177](https://github.com/Miragon/miragon-ai/issues/177)) ([8fc91cb](https://github.com/Miragon/miragon-ai/commit/8fc91cb26736b1477ab6307e39eb6e660797cc62))
* OAuth resource-server, engine token passthrough, per-engine auth ([#144](https://github.com/Miragon/miragon-ai/issues/144)) ([2ae5094](https://github.com/Miragon/miragon-ai/commit/2ae5094f6bbce49902c24e96391e3587837f2c91))
* **playground:** reset the Fly.io playground nightly at midnight ([#157](https://github.com/Miragon/miragon-ai/issues/157)) ([c308742](https://github.com/Miragon/miragon-ai/commit/c3087421eeb7b938639181bf0fb1e96362a8c5fd))
* replace examples/ with deployable playground (Compose + Fly.io) ([#146](https://github.com/Miragon/miragon-ai/issues/146)) ([cf09d6a](https://github.com/Miragon/miragon-ai/commit/cf09d6a381889dc73c50f41716da5b20b3f5c0f7))
* repo-review remediation — bugfixes, shared widget primitives, generic shell widgets ([#158](https://github.com/Miragon/miragon-ai/issues/158)) ([51263b2](https://github.com/Miragon/miragon-ai/commit/51263b2f8f24fc48f9f9611910a049f21ab45e16))
* UI review remediation — shared primitives, engine-safe mutations, a11y/i18n fixes ([#168](https://github.com/Miragon/miragon-ai/issues/168)) ([e673992](https://github.com/Miragon/miragon-ai/commit/e6739925f6d9e0f459d65b24182c6bab609fb72d))


### Bug Fixes

* add missing npm metadata to published packages ([#182](https://github.com/Miragon/miragon-ai/issues/182)) ([69ff2bc](https://github.com/Miragon/miragon-ai/commit/69ff2bc9fe94b62a5c00418dcfc5817beeaf4e8d))
* **widgets:** expert-review fixes — paging scope, Apps-SDK contract, i18n/a11y, typed feed contracts, bundle diet, KPI navigation ([#173](https://github.com/Miragon/miragon-ai/issues/173)) ([08370a5](https://github.com/Miragon/miragon-ai/commit/08370a5b79b52b6cb1cc30a76fa983a89b5061f7))

## [0.2.1](https://github.com/Miragon/miragon-ai/compare/v0.2.0...v0.2.1) (2026-06-22)


### Bug Fixes

* **docker:** install pnpm directly, node:26 dropped corepack ([#135](https://github.com/Miragon/miragon-ai/issues/135)) ([f664c8e](https://github.com/Miragon/miragon-ai/commit/f664c8e83df0f5d8f44dd116c2356b2ef38a1da8))

## [0.2.0](https://github.com/Miragon/miragon-ai/compare/v0.1.0...v0.2.0) (2026-06-22)


### Features

* add Camunda 7 ops skills + supporting MCP tools ([#40](https://github.com/Miragon/miragon-ai/issues/40)) ([4309afd](https://github.com/Miragon/miragon-ai/commit/4309afdf4e052d55ef8228ac7d343ca0a5460cfa))
* add testdata ([#36](https://github.com/Miragon/miragon-ai/issues/36)) ([3e087a6](https://github.com/Miragon/miragon-ai/commit/3e087a624fb4bf1d494efda8218895c1b4f13654))
* AI-first audit fixes, stages 1-4 — feedback loops, knowledge & tests, MCP tool surface, contracts & publishing ([#124](https://github.com/Miragon/miragon-ai/issues/124)) ([673c3c3](https://github.com/Miragon/miragon-ai/commit/673c3c3609cf6213e30924326140cc9807c1edb0))
* **analytics:** render path frequency as BPMN heatmap ([#60](https://github.com/Miragon/miragon-ai/issues/60)) ([b68b18d](https://github.com/Miragon/miragon-ai/commit/b68b18d1de55f4af66a17c326e6b364aab51dc96))
* **analytics:** self-fetching failure widgets + manifest descriptions ([#80](https://github.com/Miragon/miragon-ai/issues/80)) ([7d52658](https://github.com/Miragon/miragon-ai/commit/7d52658925c7139ef7818e42cc212ccbe75931b8))
* **analytics:** version-compare tool, version-aware path-frequency, realistic seed timings ([#75](https://github.com/Miragon/miragon-ai/issues/75)) ([2413a46](https://github.com/Miragon/miragon-ai/commit/2413a46666cfb1678d79f313e47e8067f3feedb1))
* **bpmn-viewer:** accept processDefinitionKey + version as alternative to processInstanceId ([#81](https://github.com/Miragon/miragon-ai/issues/81)) ([25326ad](https://github.com/Miragon/miragon-ai/commit/25326ad3cd65f0cdbfb230141c3793242a7acfd4))
* **bpmn-viewer:** improve alignment and zoom controls in incident panel ([#54](https://github.com/Miragon/miragon-ai/issues/54)) ([4269f09](https://github.com/Miragon/miragon-ai/commit/4269f09ed67a2887cb48bd6a58b0b356f83d1a84))
* **bpmn-viewer:** re-fit zoom on fullscreen toggle and resize ([#74](https://github.com/Miragon/miragon-ai/issues/74)) ([fca00a7](https://github.com/Miragon/miragon-ai/commit/fca00a720526c0d7c115e32e77e2a8f7e5467f3d))
* **builder:** per-cell scoping for self-fetching widgets ([#71](https://github.com/Miragon/miragon-ai/issues/71)) ([086747c](https://github.com/Miragon/miragon-ai/commit/086747c56e66b8ad9c61fdb6f90ef4b9586c549b))
* Camunda Cockpit MCP + Analytics dashboards + client package refactor ([#14](https://github.com/Miragon/miragon-ai/issues/14)) ([265336c](https://github.com/Miragon/miragon-ai/commit/265336c5e10a06e1a790946f4cdad8407e2b0e92))
* **camunda7:** user profile & settings + i18n (localized summaries & widgets) ([#126](https://github.com/Miragon/miragon-ai/issues/126)) ([7cddd4c](https://github.com/Miragon/miragon-ai/commit/7cddd4cbbede55af6790722a7c0d7ccc156739c1))
* **cockpit:** CI-style process views + host-bridge navigation ([#55](https://github.com/Miragon/miragon-ai/issues/55)) ([c3997c5](https://github.com/Miragon/miragon-ai/commit/c3997c5a65525f4d8a6b3861a43300983791b151))
* **cockpit:** consolidated client-side CIB Seven cockpit (v4) ([#96](https://github.com/Miragon/miragon-ai/issues/96)) ([b32232d](https://github.com/Miragon/miragon-ai/commit/b32232df717b632f252ce8cfc5939e11512d714b))
* dev-platform MVP — T4 + T7 + T8 + T9 + T10 + T11 + T13 ([#35](https://github.com/Miragon/miragon-ai/issues/35)) ([ecdb8fe](https://github.com/Miragon/miragon-ai/commit/ecdb8fe4f9c4590ac299a91d157c35987d092648))
* **docker:** add mcp-server to compose stack ([#42](https://github.com/Miragon/miragon-ai/issues/42)) ([107648f](https://github.com/Miragon/miragon-ai/commit/107648f2a7a8faf6897718680bef858bc105b2d8))
* **docs:** replace GitBook with lightweight VitePress site ([#84](https://github.com/Miragon/miragon-ai/issues/84)) ([80e9aaa](https://github.com/Miragon/miragon-ai/commit/80e9aaaee423eb17f37cd3a4376e7f3b632f9f3e))
* **history:** populate trace_id in camunda history tables ([#62](https://github.com/Miragon/miragon-ai/issues/62)) ([b7b4249](https://github.com/Miragon/miragon-ai/commit/b7b4249e4aa358a007a71eb7bccb3cea71182058))
* **incident-detail:** add per-incident analysis view with OTEL logs ([#61](https://github.com/Miragon/miragon-ai/issues/61)) ([5fbfc79](https://github.com/Miragon/miragon-ai/commit/5fbfc79a189221fb9ec939a535df7c096424690c))
* **incident-panel:** distinct panels for incidents ([#53](https://github.com/Miragon/miragon-ai/issues/53)) ([b4d1330](https://github.com/Miragon/miragon-ai/commit/b4d13308fcd95c59d5f29c9f475bcbd7bd30fcc5))
* **incidents:** MCP tool + prompt to file engine incidents as GitHub issues ([#66](https://github.com/Miragon/miragon-ai/issues/66)) ([#72](https://github.com/Miragon/miragon-ai/issues/72)) ([daa73fb](https://github.com/Miragon/miragon-ai/commit/daa73fb0af309bb2fa9a4181366a6d73ac218112))
* initialize miragon.ai ([2a93770](https://github.com/Miragon/miragon-ai/commit/2a93770c272729befa0167ff9187acf776f9effc))
* **miravelo:** standalone leasing-application upstream + bpmn-viewer consolidation ([#82](https://github.com/Miragon/miragon-ai/issues/82)) ([d51c0c1](https://github.com/Miragon/miragon-ai/commit/d51c0c16a05a6db87e5118a20fec01d449843a88))
* **multi-engine:** route operations + analytics across multiple CIB Seven engines ([#91](https://github.com/Miragon/miragon-ai/issues/91)) ([ef492e6](https://github.com/Miragon/miragon-ai/commit/ef492e643a3c6732e2bac81ec2a4a213c223bd87))
* **release:** GHCR pipeline for the MCP server + correct engine-plugin namespace ([#128](https://github.com/Miragon/miragon-ai/issues/128)) ([a2d4f54](https://github.com/Miragon/miragon-ai/commit/a2d4f54bcb239ebc15db344a7b58fd1fda6681a6))
* replace loanApproval/orderFulfillment demos with Miravelo showcase ([#43](https://github.com/Miragon/miragon-ai/issues/43)) ([362b9a9](https://github.com/Miragon/miragon-ai/commit/362b9a9013e38e28014a38e207d517c240f99a2a))
* **task-form:** customer support order lookup + generic task completion form ([#64](https://github.com/Miragon/miragon-ai/issues/64)) ([046d2ab](https://github.com/Miragon/miragon-ai/commit/046d2ab0b34434bec882123b8ba863c19b6ca1ca))
* **task-form:** use embedded BPMN form definition instead of variable inference ([#69](https://github.com/Miragon/miragon-ai/issues/69)) ([63fa024](https://github.com/Miragon/miragon-ai/commit/63fa0244a9df51c7c569ef47c802822cb1acf0b6))
* **widget-shell:** use full width in fullscreen mode ([#59](https://github.com/Miragon/miragon-ai/issues/59)) ([3d706da](https://github.com/Miragon/miragon-ai/commit/3d706daa7683fb79b79890b0d994e645371a7e0e))
* **widgets:** shadcn token system + dark mode, a11y, color & state fixes ([#94](https://github.com/Miragon/miragon-ai/issues/94)) ([7938574](https://github.com/Miragon/miragon-ai/commit/7938574c0da4ff77f031704d7ef17149b3197ea1))


### Bug Fixes

* **analytics:** forward per-cell props in split dashboard widgets ([#79](https://github.com/Miragon/miragon-ai/issues/79)) ([f679ec2](https://github.com/Miragon/miragon-ai/commit/f679ec297f0b973d17a7435531961ea7817a5386))
* **analytics:** make failure & analytics dashboards render in render-view ([#57](https://github.com/Miragon/miragon-ai/issues/57)) ([92a1277](https://github.com/Miragon/miragon-ai/commit/92a1277e6a7f6f523e2ab36472fd26f6cb7b3474))
* **cibseven:** resolve render-view step client from the engine registry ([#97](https://github.com/Miragon/miragon-ai/issues/97)) ([eeaf741](https://github.com/Miragon/miragon-ai/commit/eeaf741b3af79da62bbe992576f2156d4de88ade))
* dev startup, missing enrichment config, and Docker build issues ([#50](https://github.com/Miragon/miragon-ai/issues/50)) ([58b6cec](https://github.com/Miragon/miragon-ai/commit/58b6cec818f3b44142067e049e0b5b5b34af0bc5))
* **heatmap:** colorize full canvas on retina displays ([#68](https://github.com/Miragon/miragon-ai/issues/68)) ([ecd6fc0](https://github.com/Miragon/miragon-ai/commit/ecd6fc09ac0039fd0a6c9ba49e5f660136d57e4e))
* **tooling:** create verified commits via GraphQL API ([#26](https://github.com/Miragon/miragon-ai/issues/26)) ([854d591](https://github.com/Miragon/miragon-ai/commit/854d5915472187881be8c1699b38078a402bfc8d))
* **tooling:** use GITHUB_TOKEN for push and PR operations in auto-format bot ([#24](https://github.com/Miragon/miragon-ai/issues/24)) ([73410e8](https://github.com/Miragon/miragon-ai/commit/73410e84dd19709daf7562f567bbad9f5ff1b135))
* **tooling:** use GITHUB_TOKEN for push, TOOLKIT_PAT for PR creation ([0d650f7](https://github.com/Miragon/miragon-ai/commit/0d650f7a71400a988c1d5c9d269eedbbd6c4e840))
* **ui:** route render-view through framework McpAppView shell ([#48](https://github.com/Miragon/miragon-ai/issues/48)) ([aaa08ae](https://github.com/Miragon/miragon-ai/commit/aaa08ae8cab05c1b7c24a2b1ab69dacbe1fcaa43))


### Reverts

* **deps:** pin spring-boot back to 3.5.6 (CIB Seven 2.1 incompat) ([#63](https://github.com/Miragon/miragon-ai/issues/63)) ([a79ea1c](https://github.com/Miragon/miragon-ai/commit/a79ea1cb1f07c347b4c83edd59200435beaf4daf))

## Changelog

All notable changes to this project are documented here. This file is maintained
automatically by [release-please](https://github.com/googleapis/release-please) from
Conventional Commit messages — do not edit it by hand.
