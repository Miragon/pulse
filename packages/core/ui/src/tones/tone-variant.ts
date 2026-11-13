/**
 * The tone vocabulary every Pulse UI speaks: `success | warning | danger | info | neutral`
 * ({@link TONE_VARIANTS}). Retired or foreign names (`critical`, `error`, `destructive`, …) map
 * onto it through {@link resolveTone}, so a tone that arrives as data (a server-built KPI cell)
 * never renders without a colour. Data only: how a tone looks is each UI's own (the kit's class
 * maps in `lib/tone-utils.ts`, the VS Code webview's stylesheets).
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
