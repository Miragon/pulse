/**
 * The `/server` import path: the module port, tool authoring and the boot. The boot's own parts
 * (edge guard, body limit, metrics, health, request context) stay inside `createComposedServer`,
 * so no root can wire a second boot that skips one of them.
 */

// The module port: what a module hands the boot.
export { type ComposableModule, type ModuleEntry, type ModulePlugin } from "./composition.js"
export { createToolsetVocabulary, type ToolsetVocabulary } from "./toolsets.js"

// Tool authoring: the registrar, the view and feed bindings and results, the server i18n, the
// BPMN-name readers and the per-caller request info.
export { withToolErrors } from "./tool-errors.js"
export { createToolRegistrar, type ToolConfig, type ToolRegistrar } from "./tool-registrar.js"
export { appOnly, showToolBinding, strictToolInput } from "./widget-tool-bindings.js"
export { buildDataFeedResult, buildViewResult, type ViewResult } from "./view-results.js"
// The two protocol helpers both halves use are also on `/widgets`, with their types: server
// summaries and widget strings call createTranslator at runtime, and the server's tool tests
// decode results the way the view runtime does. Both come from src/protocol/, the one tree the
// server half and the view half (src/ui) share; neither half imports the other
// (.dependency-cruiser.cjs: widget-shell-server-headless, widget-shell-views-browser-only).
export { decodeToolResult, type ToolResult } from "./protocol/tool-result.js"
export {
  createTranslator,
  type Catalogs,
  type Message,
  type MessageCatalog,
  type Translator,
} from "./protocol/translator.js"
export {
  bpmnProcessNameOf,
  parseBpmnNames,
  readBpmnNames,
  type BpmnModelNames,
  type BpmnNames,
} from "./protocol/bpmn-names.js"
export {
  callerCacheKey,
  getMcpRequestInfo,
  runWithMcpRequestInfo,
  type McpRequestInfo,
} from "./request-context.js"

// The boot: one composed server, the variables it reads, the view resources it primes and the
// view bundle's dedupe list.
export {
  composedEnvVars,
  createComposedServer,
  retiredEnvVars,
  type ComposedServer,
  type ComposedServerInfo,
  type ComposedServerOptions,
  type ListenOptions,
  type RunningServer,
} from "./composed-server.js"
export { VIEW_RESOURCE_URI_PREFIX, viewResourceUri } from "./widget-tool-bindings.js"
export { viewPrelude } from "./protocol/view-name.js"
export { VIEW_BUNDLE_DEDUPE } from "./view-bundle.js"

// The served fonts (owner order: unchanged), and the route host installFontAssets takes.
export type { HttpRouteHost } from "./health.js"
export {
  fontAssetsCsp,
  installFontAssets,
  type FontAsset,
  type FontAssetsOptions,
} from "./font-assets.js"
export { SERVED_FONT_FILES, SERVED_FONT_PATH, servedFontBaseUrl } from "./protocol/served-fonts.js"
