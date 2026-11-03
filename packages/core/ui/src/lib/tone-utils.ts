/**
 * Single source of truth for the semantic "tones" used across the tone-aware
 * components (`Pills`, `StatusBadge`, `KpiGrid`, `Badge`, …).
 *
 * ONE vocabulary: `success | warning | danger | info | neutral`
 * ({@link TONE_VARIANTS}). Retired or foreign names (`critical`, `error`,
 * `destructive`, …) map onto it through {@link resolveTone}, so a tone that
 * arrives as data (a server-built KPI cell) never renders without a colour.
 *
 * Every status tone has THREE roles (Miragon CI §3.3), each its own token in
 * `theme.css` with light and dark values:
 *
 * | Role                         | Token           | Map            |
 * | ---------------------------- | --------------- | -------------- |
 * | fill, dot, border, icon      | `--<tone>`      | `TONE_DOT`, `TONE_BORDER`, `TONE_ICON` |
 * | tint (badge/banner surface)  | `--<tone>-soft` | `TONE_SOFT`, `TONE_TINT` (text on it: the foreground) |
 * | text on a plain surface      | `--<tone>-ink`  | `TONE_INK`     |
 *
 * Status is never text in its own colour: success and warning reach only
 * 1.67:1 / 1.83:1 on white, so their ink is the foreground and the tone shows
 * as a dot, icon or border NEXT to the text. On a tint the text is always the
 * foreground (CI §3.3: "-soft: Text darauf --cd-schwarz, Rand in der
 * Statusfarbe"), so pair `TONE_SOFT` with `TONE_BORDER`. `TONE_INK` is for
 * a tone's words on a plain surface (a field error); figures (counts, KPI
 * values, trends) never take it: they stay in the foreground next to a
 * `TONE_DOT`. In dark mode the colours are the `-hell` values and the tints
 * are transparent (no tinted fills on dark). The `neutral` tone reuses the
 * muted ramp.
 *
 * Change a tone here, in one place, instead of hand-rolling
 * `tone === "x" ? "…" : "…"` ternaries at every call site.
 */
export type ToneVariant = "neutral" | "info" | "success" | "warning" | "danger"

/** Every tone, in severity order (for loops, pickers and validation). */
export const TONE_VARIANTS: readonly ToneVariant[] = [
  "danger",
  "warning",
  "success",
  "info",
  "neutral",
]

/**
 * Retired or foreign tone names and the tone each one means. One red and one
 * amber (CI §3.3): `critical`, `error` and `destructive` are `danger`; there
 * is no separate severity above it. The names on the left are deprecated:
 * write the {@link ToneVariant} on the right. The map stays so data written
 * against an older vocabulary (an earlier `critical`, a shadcn
 * `destructive`) keeps its colour.
 */
export const TONE_ALIASES = {
  critical: "danger",
  error: "danger",
  destructive: "danger",
  failure: "danger",
  warn: "warning",
  ok: "success",
  positive: "success",
  notice: "info",
  default: "neutral",
  muted: "neutral",
  secondary: "neutral",
} as const satisfies Record<string, ToneVariant>

/** A name {@link resolveTone} maps onto a tone (see {@link TONE_ALIASES}). */
export type ToneAlias = keyof typeof TONE_ALIASES

/**
 * What a tone-aware component accepts: a {@link ToneVariant}, or a retired
 * name that {@link resolveTone} maps onto one.
 */
export type ToneName = ToneVariant | ToneAlias

const TONE_SET: ReadonlySet<string> = new Set(TONE_VARIANTS)

/** Whether `value` is one of the five tones (a type guard for data from the wire). */
export function isToneVariant(value: unknown): value is ToneVariant {
  return typeof value === "string" && TONE_SET.has(value)
}

/**
 * Map any tone name onto the vocabulary: a {@link ToneVariant} as is, a
 * retired name ({@link TONE_ALIASES}, case-insensitive) onto its tone, and
 * anything else (unknown, empty, not a string) onto `fallback` (default
 * `"neutral"`, the tone without a state).
 */
export function resolveTone(name: unknown, fallback: ToneVariant = "neutral"): ToneVariant {
  if (typeof name !== "string") return fallback
  const key = name.trim().toLowerCase()
  if (TONE_SET.has(key)) return key as ToneVariant
  return Object.hasOwn(TONE_ALIASES, key) ? TONE_ALIASES[key as ToneAlias] : fallback
}

/**
 * Tinted surface + its text (the foreground: CI §3.3) for badges, pills,
 * banners. Pair it with {@link TONE_BORDER}: the rim carries the tone, and in
 * dark mode (no tints) it is all that does. The neutral tint is the muted
 * surface, its text the foreground too (a count on it is a figure).
 */
export const TONE_SOFT: Record<ToneVariant, string> = {
  neutral: "bg-muted text-foreground",
  info: "bg-info-soft text-foreground",
  success: "bg-success-soft text-foreground",
  warning: "bg-warning-soft text-foreground",
  danger: "bg-danger-soft text-foreground",
}

/** The tint alone, for a surface that sets its text itself (a soft KPI card). */
export const TONE_TINT: Record<ToneVariant, string> = {
  neutral: "bg-muted",
  info: "bg-info-soft",
  success: "bg-success-soft",
  warning: "bg-warning-soft",
  danger: "bg-danger-soft",
}

/** Solid dot colour: a status dot next to a label, a bar, a meter fill. */
export const TONE_DOT: Record<ToneVariant, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
}

/**
 * The tone's TEXT colour (its `-ink` role) for words on a plain surface: a
 * field error, a "missing" label. Success and warning resolve to the
 * foreground on light: pair the text with a {@link TONE_DOT} or
 * {@link TONE_ICON} to show the tone. Never on a tint (use {@link TONE_SOFT})
 * and never for figures (they stay in the foreground next to a dot).
 */
export const TONE_INK: Record<ToneVariant, string> = {
  neutral: "text-foreground",
  info: "text-info-ink",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
}

/** Border colour in the tone: the rim of a tinted badge, banner or toast. */
export const TONE_BORDER: Record<ToneVariant, string> = {
  neutral: "border-border",
  info: "border-info",
  success: "border-success",
  warning: "border-warning",
  danger: "border-danger",
}

/**
 * Icon colour in the tone (SVG `currentColor`). For icons only, never for
 * text: an icon next to its label carries the tone, the label stays readable.
 */
export const TONE_ICON: Record<ToneVariant, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
}
