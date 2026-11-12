// `@miragon/pulse-ui/tones`: the tone vocabulary and the one table of situations, framework-free
// (no React, no DOM, no import outside this folder: `ui-foundation-entries-import-nothing` in
// .dependency-cruiser.cjs), so a UI on another framework (the VS Code webview on Preact) reads the
// same tones. The root entry exports the same names for the React kit.
export {
  TONE_VARIANTS,
  TONE_ALIASES,
  resolveTone,
  isToneVariant,
  type ToneVariant,
  type ToneAlias,
  type ToneName,
} from "./tone-variant.js"
export { SITUATION_TONES, type Situation } from "./situations.js"
export { countTone, severityTone } from "./count-tone.js"
