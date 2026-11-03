/// <reference types="node" />
import { readFileSync } from "node:fs"

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

export const LIGHT_SELECTOR =
  ':root, :where(.dark, [data-theme="dark"], [data-theme-mode="dark"]) [data-theme-mode="light"]'
export const DARK_SELECTOR = '.dark, [data-theme="dark"], [data-theme-mode="dark"]'
export const norm = (s: string) => s.replace(/\s+/g, " ").trim()

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

export const ROOT = block(":root")
export const LIGHT = block(LIGHT_SELECTOR)
export const DARK = block(DARK_SELECTOR)
export const THEME_INLINE = block("@theme inline")
export const THEME_REFERENCE = block("@theme inline reference")

const CD: Record<string, string> = {}
for (const m of cdCss.matchAll(/(--cd-[a-z0-9-]+):\s*([^;]+);/g)) CD[m[1]] = m[2]

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
