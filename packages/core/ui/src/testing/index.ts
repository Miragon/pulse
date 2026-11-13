/** The brand gates and the product's words every Pulse UI runs in its own test suite (Node, never bundled): the MCP widget packages over their catalogs, the VS Code extension over its sources. The scanners parse sources with `typescript`, an optional peer. */
export {
  catalogTextFindings,
  type CatalogAllowance,
  type CatalogLanguage,
  type CatalogRule,
  type CatalogTextFinding,
  type CatalogTextOptions,
} from "./catalog-text.js"
export { COUNT_TERMS, type CountTerm } from "./count-terms.js"
export {
  BARE_PAUSE_RULE_EN,
  blindGlossaryRules,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  unnamedGlossaryTerms,
  type GlossaryFinding,
  type GlossaryRule,
} from "./glossary.js"
export { sourceTexts } from "./source-texts.js"
export { FORBIDDEN_GLYPHS, glyphFindings, scanGlyphs, type GlyphFinding } from "./glyphs.js"
export {
  CI_ICON_SIZES,
  DENSE_ICON_SIZE,
  iconSizeFindings,
  scanIconSizes,
  type IconSizeFinding,
  type ScanIconSizesOptions,
} from "./icon-sizes.js"
export {
  scanTypeScale,
  typeScaleFindings,
  type ScanTypeScaleOptions,
  type TypeScaleFinding,
  type TypeScaleRule,
} from "./type-scale.js"
export {
  colorFindings,
  scanColors,
  stylesheetColorFindings,
  type ColorFinding,
  type ScanColorsOptions,
} from "./colors.js"
export {
  composite,
  contrastFindings,
  contrastRatio,
  measureContrast,
  parseThemeVariables,
  resolveColor,
  themeStylesheets,
  type ContrastPair,
  type ContrastResult,
  type Rgba,
  type ThemeMode,
  type ThemeVariables,
} from "./contrast.js"
export { LIGHT_STATUS_EXEMPTION, ROLE_CONTRAST_PAIRS, toneContrastPairs } from "./tone-pairs.js"
export { stylesheetRules, stylesheetShapeFindings } from "./stylesheet-shape.js"
