/** The `/server` import path for module tools and composition roots. */
export type {
  ComposedViewEntry,
  ComposedViewInput,
  SingleWidgetViewInput,
} from "@miragon/mcp-toolkit-core"
export { withToolErrors } from "@miragon/mcp-toolkit-core/tools"
export { createShellPlugin, shellDefinition, type ShellPluginOptions } from "./shell-catalogue.js"
export {
  SHELL_SAVE_SETTINGS,
  SHELL_SETTINGS_DATA,
  SHELL_SETTINGS_PAGE_WIDGET,
  SHELL_SETTINGS_WIDGET,
  SHELL_SHOW_SETTINGS,
  type ShellSettingsReadOnlyReason,
  type ShellSettingsView,
} from "./shell-settings-contract.js"
export { createBuilderTexts, type BuilderTexts } from "./builder-texts.js"
export {
  ANONYMOUS_PROFILE_KEY,
  resolveAuthUserId,
  resolveProfileKey,
  withoutDefaults,
  type ProfileSlice,
  type ProfileSource,
} from "./profile.js"
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
  honorWidgetMetaDefaults,
  withWidgetMetaDefaults,
  type WidgetMetaDefaults,
} from "./widget-meta-defaults.js"
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
  explicitLocale,
  LANGUAGES,
  LOCALES,
  PROFILE_SCHEMA_VERSION,
  type LanguagePref,
  type Locale,
} from "./profile-constants.js"
export {
  defaultProfileRecord,
  profileRecordSchema,
  type ProfileRecord,
  type ProfileRecordSaveInput,
} from "./profile-record.js"
export { parseStoredProfile } from "./profile-migrations.js"
export {
  createFileSystemProfileStore,
  createInMemoryProfileStore,
  mergeStoredProfile,
  type MergedProfile,
  type ProfileSaveOptions,
  type ProfileStore,
} from "./profile-store.js"
export { readProfileAdvisory } from "./profile-advisory.js"
export { createPostgresProfileStore, PROFILE_STORE_MIGRATIONS } from "./profile-store-postgres.js"
export {
  createPostgresDashboardStore,
  DASHBOARD_STORE_MIGRATIONS,
} from "./dashboard-store-postgres.js"
export { createSql, postgresReadinessCheck, runMigrations, type Migration } from "./postgres.js"
export { appOnly, showToolBinding, strictToolInput } from "./widget-tool-bindings.js"
export {
  composeModules,
  frameworkWritesAllowed,
  type ActiveModuleRef,
  type ComposableModule,
  type EffectiveToolset,
  type ModuleComposition,
  type ResolveBootOptions,
  type ResolvedBoot,
} from "./composition.js"
export {
  announcePersistence,
  persistenceFromEnv,
  profileStoreFromEnv,
  type PersistenceBackend,
  type PersistenceSelection,
} from "./profile-store-env.js"
export {
  createToolsetVocabulary,
  type EffectiveSelection,
  type ToolsetSource,
  type ToolsetVocabulary,
} from "./toolsets.js"
export {
  createLocalizeFor,
  createLocalizeViewFor,
  createViewLocaleOf,
  resolveProfileLocale,
  type ServerT,
  type Translator,
  type ViewLocale,
} from "./server-locale.js"
export { parseModuleSlice, requireProfileKey, saveModuleSlice } from "./profile-slice.js"
export { registerSettingsSection } from "./settings-section.js"
export { catalogueSyncIssues } from "./catalogue-sync.js"
export {
  bpmnProcessNameOf,
  parseBpmnNames,
  readBpmnNames,
  type BpmnModelNames,
  type BpmnNames,
} from "./bpmn-names.js"

export { buildComposedView, buildDataFeedResult, buildSingleWidgetView } from "./view-results.js"
