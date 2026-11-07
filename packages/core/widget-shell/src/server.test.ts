import { describe, expect, it } from "vitest"
import * as server from "./server.js"

/**
 * The published entry, name by name: a name added here is a promise to every customer, a name
 * dropped a breaking change, so either is a decision made in review, not a side effect. Types are
 * erased at runtime: this locks the runtime names (knip does not report an entry's own exports).
 */
describe("the /server entry", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(server).sort()).toEqual([
      "SERVED_FONT_FILES",
      "SERVED_FONT_PATH",
      "VIEW_BUNDLE_DEDUPE",
      "VIEW_RESOURCE_URI_PREFIX",
      "appOnly",
      "bpmnProcessNameOf",
      "buildDataFeedResult",
      "buildViewResult",
      "callerCacheKey",
      "composedEnvVars",
      "createComposedServer",
      "createToolRegistrar",
      "createToolsetVocabulary",
      "createTranslator",
      "decodeToolResult",
      "fontAssetsCsp",
      "getMcpRequestInfo",
      "installFontAssets",
      "parseBpmnNames",
      "readBpmnNames",
      "retiredEnvVars",
      "runComposedServer",
      "runWithMcpRequestInfo",
      "servedFontBaseUrl",
      "showToolBinding",
      "strictToolInput",
      "viewBundleWatchPlugin",
      "viewPrelude",
      "viewResourceUri",
      "withToolErrors",
    ])
  })
})
