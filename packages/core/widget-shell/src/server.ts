/** The `/server` import path for module tools and composition roots. */
export { withToolErrors } from "./tool-errors.js"
export { createToolRegistrar, type ToolConfig, type ToolRegistrar } from "./tool-registrar.js"
export {
  callerCacheKey,
  getMcpRequestInfo,
  installMcpRequestContext,
  runWithMcpRequestInfo,
  type McpMiddlewareHost,
  type McpRequestInfo,
} from "./request-context.js"
export { OAUTH_ENV_VARS, oauthFromEnv, type OAuthFromEnvOptions } from "./oauth-env.js"
export {
  requestLogLevelWarning,
  resolvePort,
  swallowDevCliViewsPrime,
  type ResolvePortOptions,
  type ToolCallMiddlewareHost,
} from "./host-boot.js"
export {
  installHealthEndpoints,
  type HealthOptions,
  type HealthReport,
  type HealthStatus,
  type HttpRouteHost,
  type ReadinessCheck,
} from "./health.js"
export {
  installMetrics,
  type HttpMiddlewareContext,
  type HttpMiddlewareHost,
  type MetricsHost,
  type MetricsOptions,
} from "./metrics.js"
export {
  DEFAULT_MAX_BODY_BYTES,
  HTTP_EDGE_ENV_VARS,
  installHttpEdgeGuard,
  resolveHttpEdgePolicy,
  type AllowList,
  type EdgeGuardContext,
  type EdgeGuardHost,
  type EdgeGuardOptions,
  type HttpEdgePolicy,
} from "./http-edge.js"
export {
  fontAssetsCsp,
  installFontAssets,
  type FontAsset,
  type FontAssetsOptions,
} from "./font-assets.js"
export { SERVED_FONT_FILES, SERVED_FONT_PATH, servedFontBaseUrl } from "./served-fonts.js"
export {
  createBodyLimitedListener,
  type BodyLimitedListener,
  type BodyLimitedListenerOptions,
  type FetchTarget,
} from "./node-listener.js"
export {
  createComposedServer,
  DEFAULT_DRAIN_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type BootComposition,
  type ComposedServer,
  type ComposedServerInfo,
  type ComposedServerOptions,
  type ComposedServerRuntime,
  type ListenOptions,
  type RunningServer,
} from "./composed-server.js"
export {
  appOnly,
  showToolBinding,
  strictToolInput,
  VIEW_RESOURCE_URI_PREFIX,
  viewResourceUri,
} from "./widget-tool-bindings.js"
export {
  composeModules,
  type ActiveModuleRef,
  type ComposableModule,
  type EffectiveToolset,
  type ModuleComposition,
  type ModuleEntry,
  type ModulePlugin,
  type ResolveBootOptions,
  type ResolvedBoot,
} from "./composition.js"
export {
  createToolsetVocabulary,
  type EffectiveSelection,
  type ToolsetSource,
  type ToolsetVocabulary,
} from "./toolsets.js"
export {
  createTranslator,
  type Catalogs,
  type Message,
  type MessageCatalog,
  type Translator,
} from "./translator.js"
export {
  bpmnProcessNameOf,
  parseBpmnNames,
  readBpmnNames,
  type BpmnModelNames,
  type BpmnNames,
} from "./bpmn-names.js"

export { buildDataFeedResult, buildViewResult, type ViewResult } from "./view-results.js"
export { viewPrelude } from "./view-name.js"
export { decodeToolResult, type ToolResult } from "./tool-result.js"
