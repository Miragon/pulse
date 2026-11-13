/// <reference types="node" />
import { readFileSync } from "node:fs"
import { scopedTokens } from "./vendored-tokens.test-support.js"

/**
 * theme.css parsed for its two suites (`theme-css.test.ts`, `theme-contrast.test.ts`): its
 * blocks and declarations, and the colour maths over the vendored `--cd-*` values.
 */

export const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
export const themeCss = read("../theme.css")
export const globalsCss = read("../globals.css")
export const fontsCss = read("../fonts.css")
const cdCss = read("../tokens/cd-tokens.generated.css")

export const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "")
export const rules = stripComments(themeCss)

/** The dark scopes: the host's (`.dark`, `data-theme`), a dark container and the guide's own switch. */
export const DARK_SCOPES =
  '.dark, [data-theme="dark"], [data-theme-mode="dark"], [data-cd-theme="dark"]'
/** The light islands a dark scope may hold. */
export const LIGHT_ISLANDS = '[data-theme-mode="light"], [data-cd-theme="light"]'
export const LIGHT_SELECTOR = `:root, :where(${DARK_SCOPES}) :is(${LIGHT_ISLANDS})`
/** High contrast on the mode's element, and the light island inside it. */
const KONTRAST_SELECTOR = `[data-cd-kontrast="hoch"], [data-cd-kontrast="hoch"] :is(${LIGHT_ISLANDS})`
const DARK_KONTRAST_SELECTOR = `:is(${DARK_SCOPES})[data-cd-kontrast="hoch"], [data-cd-kontrast="hoch"] :is(${DARK_SCOPES}), :is(${DARK_SCOPES}) [data-cd-kontrast="hoch"]`
export const norm = (s: string) =>
  s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim()

/** Every innermost block of theme.css: its normalized selector, offset and declarations. */
export const BLOCKS = [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
  // The prelude runs back to the previous brace; drop finished statements
  // (`@import …;`, `@custom-variant …;`) in front of the selector.
  const selector = norm(match[1].split(";").pop() ?? "")
  const decls: Record<string, string> = {}
  for (const decl of match[2].split(";")) {
    const at = decl.indexOf(":")
    if (at < 0) continue
    const name = decl.slice(0, at).trim()
    if (name.startsWith("--") || name === "color-scheme") decls[name] = norm(decl.slice(at + 1))
  }
  return { selector, offset: match.index, decls }
})

/** Declarations of the innermost block whose (normalized) selector is `selector`. */
function block(selector: string): Record<string, string> {
  const found = BLOCKS.find((b) => b.selector === norm(selector))
  if (!found) throw new Error(`theme.css has no block "${selector}"`)
  return found.decls
}

/** Declarations of the first block with `selector` inside the media query `media`. */
function blockIn(media: string, selector: string): Record<string, string> {
  const at = rules.indexOf(`@media ${media} {`)
  const found = BLOCKS.find((b) => at >= 0 && b.offset > at && b.selector === norm(selector))
  if (!found) throw new Error(`theme.css has no block "${selector}" in @media ${media}`)
  return found.decls
}

export const ROOT = block(":root")
export const LIGHT = block(LIGHT_SELECTOR)
export const DARK = block(DARK_SCOPES)
export const KONTRAST = block(KONTRAST_SELECTOR)
export const DARK_KONTRAST = block(DARK_KONTRAST_SELECTOR)
export const THEME_INLINE = block("@theme inline")
export const THEME_REFERENCE = block("@theme inline reference")
/** The comfortable density step: on a coarse pointer, and inside `data-density="comfortable"`. */
export const COARSE = blockIn("(any-pointer: coarse)", ":root")
export const COMFORTABLE = block('[data-density="comfortable"]')

const CD: Record<string, string> = {}
for (const m of cdCss.matchAll(/(--cd-[a-z0-9-]+):\s*([^;]+);/g)) CD[m[1]] = m[2]

/** A vendored `--cd-*` token's value (a mode-switched one: as the tokens declare it last). */
export function cdToken(name: string): string {
  const value = CD[name]
  if (!value) throw new Error(`the vendored tokens declare no ${name}`)
  return value
}

// ── Colour maths (sRGB, WCAG 2.x relative luminance) ──────────────────────────

type Rgba = { r: number; g: number; b: number; a: number }

function hex(value: string): Rgba {
  const h = value.trim().replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a #rrggbb colour: ${value}`)
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 1,
  }
}

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }

/**
 * A role value → colour. theme.css uses var(--cd-*), color-mix(in srgb, …) and
 * transparent; a brand may also use #rrggbb.
 */
export function colour(value: string): Rgba {
  const v = value.trim()
  if (v === "transparent") return TRANSPARENT
  const ref = /^var\((--cd-[a-z0-9-]+)\)$/.exec(v)
  if (ref) {
    const cd = CD[ref[1]]
    if (!cd) throw new Error(`unknown token ${ref[1]}`)
    return hex(cd)
  }
  if (v.startsWith("#")) return hex(v)
  const mix = /^color-mix\(in srgb, (.+) (\d+(?:\.\d+)?)%, (.+)\)$/.exec(v)
  if (mix) {
    const a = colour(mix[1])
    const b = colour(mix[3])
    const p = Number(mix[2]) / 100
    // Premultiplied interpolation (CSS Color 5): mixing with transparent keeps
    // the colour and scales its alpha.
    const alpha = a.a * p + b.a * (1 - p)
    if (alpha === 0) return TRANSPARENT
    const ch = (k: "r" | "g" | "b") => (a[k] * a.a * p + b[k] * b.a * (1 - p)) / alpha
    return { r: ch("r"), g: ch("g"), b: ch("b"), a: alpha }
  }
  throw new Error(`value outside the token grammar: ${v}`)
}

const RGBA = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/

/** The vendored tokens by scope: the guide's light roles in `:root`, its dark ones under `data-cd-theme`. */
const GUIDE_SCOPES = scopedTokens(cdCss)
const GUIDE_SCOPE = { light: ":root", dark: '@media screen { [data-cd-theme="dark"] }' } as const

/** A `--cd-ui-*` role of the guide in `mode`, as the vendored tokens declare it (#rrggbb or rgba()). */
export function guideRole(name: string, mode: "light" | "dark"): Rgba {
  const value = GUIDE_SCOPES.get(GUIDE_SCOPE[mode])?.get(name)
  if (!value) throw new Error(`the vendored tokens declare no ${name} for ${mode}`)
  const rgba = RGBA.exec(value)
  if (!rgba) return hex(value)
  return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: Number(rgba[4]) }
}

/** A colour as 8-bit channels and an alpha in hundredths, the precision a browser paints at. */
export const painted = ({ r, g, b, a }: Rgba) =>
  [r, g, b, a * 100].map((c) => Math.round(c)).join(",")

/** `top` painted over an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  }
}

function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

export type Mode = "light" | "dark"
export const MODES: Mode[] = ["light", "dark"]

/** A role's value in `mode`: theme.css, dark falling back to light/root where not redeclared. */
export function role(name: string, mode: Mode): string {
  const value = (mode === "dark" ? DARK[name] : undefined) ?? LIGHT[name] ?? ROOT[name]
  if (!value) throw new Error(`role ${name} is not defined for ${mode}`)
  return value
}

/** A surface role resolved to an opaque colour: translucent surfaces sit on --background. */
function surface(name: string, mode: Mode): Rgba {
  const ground = colour(role("--background", mode))
  return over(colour(role(name, mode)), ground)
}

/** Contrast of a foreground role on a surface role (the surface itself may be a tint). */
export function ratio(fg: string, bg: string, mode: Mode): number {
  const back = surface(bg, mode)
  return contrast(over(colour(role(fg, mode)), back), back)
}
