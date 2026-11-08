/**
 * Node test aids, never bundled: the product glossary every widget package checks its catalogs
 * against (the generic brand gates are `@miragon/pulse-ui/testing`) and the recording
 * `ModuleServer` a module's tests register on.
 */
export {
  blindGlossaryRules,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  unnamedGlossaryTerms,
  type GlossaryFinding,
  type GlossaryRule,
} from "./glossary.js"
export {
  recordingModuleServer,
  testServerContext,
  type RecordedConfig,
  type RecordedPromptResult,
  type RecordedResource,
  type RecordedToolResult,
  type RecordingModuleServer,
  type Registration,
} from "./module-server.js"
