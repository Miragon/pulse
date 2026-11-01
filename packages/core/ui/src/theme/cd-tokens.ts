/**
 * The Miragon corporate-design tokens (`--cd-*`) as plain TypeScript, for code
 * that cannot read CSS variables — an SVG or canvas renderer (BPMN overlays,
 * chart marks), a server-side image, a test. Keys are the CSS names without the
 * `--cd-` prefix.
 *
 * The source of truth is the vendored `cd-tokens.generated.css` next to this
 * file (miragon-brand 1.8.0, copied unchanged from Miragon/corporate-identity).
 * This module mirrors it value for value; `cd-tokens.test.ts` fails on any
 * drift (modeler-tool-design §13). Never edit a value here without re-vendoring
 * the CSS first.
 *
 * UI code styles through the role tokens (`bg-primary`, `text-link`,
 * `border-danger`, …), never through these constants.
 */
export const CD_TOKENS = {
  blau: "#335DE5",
  gruen: "#00E676",
  grau: "#F9F7F7",
  schwarz: "#1D1D1D",
  weiss: "#FFFFFF",
  "blau-link": "#2B50D4",
  "blau-hell": "#6B8AFF",
  success: "#00E676",
  "success-soft": "#DAFBEB",
  "success-hell": "#00E676",
  warning: "#FFB000",
  "warning-soft": "#FFF1D2",
  "warning-hell": "#FFB000",
  danger: "#CD1839",
  "danger-soft": "#FBEEF0",
  "danger-hell": "#FB6D73",
  info: "#335DE5",
  "info-soft": "#EEF1FD",
  "info-hell": "#6B8AFF",
  linie: "#E6E2E2",
  kontur: "#8F8A8A",
  "text-leise": "#6B6666",
  "gradient-brand": "linear-gradient(120deg, #335DE5 30%, #00E676)",
  "gradient-format": "linear-gradient(135deg, #335DE5 0%, #00E676 140%)",
  "space-1": "4px",
  "space-2": "8px",
  "space-3": "16px",
  "space-4": "24px",
  "space-5": "32px",
  "space-6": "48px",
  "space-7": "64px",
  "space-8": "96px",
  "radius-sm": "6px",
  "radius-md": "12px",
  "radius-lg": "16px",
  "radius-pill": "999px",
  "shadow-1": "0 1px 2px rgba(29, 29, 29, 0.06), 0 1px 3px rgba(29, 29, 29, 0.10)",
  "shadow-2": "0 4px 12px rgba(29, 29, 29, 0.10)",
  "shadow-3": "0 12px 32px rgba(29, 29, 29, 0.16)",
  "motion-fast": "150ms",
  "motion-base": "250ms",
  "motion-slow": "400ms",
  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
  "ease-out": "cubic-bezier(0, 0, 0.2, 1)",
} as const

/** A key of {@link CD_TOKENS} — the `--cd-*` name without its prefix. */
export type CdTokenName = keyof typeof CD_TOKENS

/** The miragon-brand release the vendored tokens come from. */
export const CD_TOKENS_VERSION = "1.8.0"
