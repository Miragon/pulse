/** The brand gates every widget package runs in its own test suite (Node, never bundled). The scanners parse sources with `typescript`, an optional peer. */
export {
  catalogTextFindings,
  type CatalogAllowance,
  type CatalogLanguage,
  type CatalogRule,
  type CatalogTextFinding,
  type CatalogTextOptions,
} from "./catalog-text.js"
export { FORBIDDEN_GLYPHS, glyphFindings, scanGlyphs, type GlyphFinding } from "./glyphs.js"
export {
  CI_ICON_SIZES,
  iconSizeFindings,
  scanIconSizes,
  type IconSizeFinding,
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
export { ROLE_CONTRAST_PAIRS, toneContrastPairs } from "./tone-pairs.js"
