/**
 * The product's words as data, for any runtime: one word per thing in every Pulse UI (the MCP
 * widgets, the web app, the VS Code webview and a page on the kit), the words each replaces, the
 * one word per count, and the check a page or an agent runs over its own catalog. No import beyond
 * this folder, so a browser loads it as is (`ui-foundation-entries-import-nothing`); `./testing`
 * hands out the same bindings beside the brand gates. The table at
 * https://miragon.github.io/pulse/glossary is generated from it.
 */
export type { GlossaryLanguage } from "./catalog.js"
export { COUNT_TERMS, type CountTerm } from "./count-terms.js"
export {
  blindGlossaryRules,
  glossaryFindings,
  unnamedGlossaryTerms,
  type GlossaryFinding,
} from "./findings.js"
export { BARE_PAUSE_RULE_EN, PRODUCT_GLOSSARY, type GlossaryRule } from "./rules.js"
