import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { POINTER_ROLES } from "../theme/role-tokens.js"

/**
 * WCAG contrast over the THEME as written, resolved the way the browser would, so a brand
 * override that drops a role below AA fails a test, not a screenshot review.
 */

/**
 * The kit's shipped theme: the vendored `--cd-*` tokens, then the roles (`theme.css`). Pass first,
 * then a consumer's brand: `parseThemeVariables(...themeStylesheets(), brandCss)`. The tokens are
 * the file `theme.css` imports, read next to it, as its `@import` resolves them.
 */
export function themeStylesheets(): string[] {
  const theme = createRequire(import.meta.url).resolve("@miragon/pulse-ui/theme.css")
  const tokens = new URL("./tokens/cd-tokens.generated.css", pathToFileURL(theme))
  return [readFileSync(tokens, "utf8"), readFileSync(theme, "utf8")]
}

export type ThemeMode = "light" | "dark"

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export interface ThemeVariables {
  light: Map<string, string>
  dark: Map<string, string>
  /**
   * The dark of a page whose root names no mode, on a dark OS: everything the dark scopes set,
   * then the blocks for the OS's dark root (`@media (prefers-color-scheme: dark)` on
   * `:root:where(:not([data-theme], [data-cd-theme], [data-theme-mode]))`), in their order.
   * `parseThemeVariables` fills it; `measureContrast` measures it where it differs from `dark`.
   */
  os?: Map<string, string>
}

/** What a contrast result was measured in: a mode, or the OS's dark (`ThemeVariables.os`). */
export type ContrastMode = ThemeMode | "os-dark"

/** A comment may quote a rule it forbids; a linear scan, not a lazy regex, since it reads consumer CSS. */
function stripComments(css: string): string {
  let out = ""
  let at = 0
  for (;;) {
    const open = css.indexOf("/*", at)
    if (open === -1) return out + css.slice(at)
    out += css.slice(at, open)
    const close = css.indexOf("*/", open + 2)
    if (close === -1) return out
    at = close + 2
  }
}

interface RuleBlock {
  prelude: string
  parents: string[]
  declarations: [string, string][]
}

function customProperties(body: string): [string, string][] {
  const declarations: [string, string][] = []
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":")
    if (colon === -1) continue
    const name = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).trim()
    if (value && /^--[\w-]+$/.test(name)) declarations.push([name, value])
  }
  return declarations
}

function selectorList(prelude: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i]
    if (ch === "(" || ch === "[") depth++
    else if (ch === ")" || ch === "]") depth--
    else if (ch === "," && depth === 0) {
      out.push(prelude.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(prelude.slice(start).trim())
  return out
}

function ruleBlocks(css: string): RuleBlock[] {
  const blocks: RuleBlock[] = []
  const open: { block: RuleBlock; body: string }[] = []
  let text = ""
  for (const ch of css) {
    if (ch === "{") {
      // Statements before a prelude (`@import …;`) end in ";".
      const cut = text.lastIndexOf(";") + 1
      if (open.length > 0) open[open.length - 1].body += text.slice(0, cut)
      const block = {
        prelude: text.slice(cut).trim(),
        parents: open.map((o) => o.block.prelude),
        declarations: [],
      }
      blocks.push(block)
      open.push({ block, body: "" })
      text = ""
    } else if (ch === "}") {
      const closing = open.pop()
      if (!closing) throw new Error("Unbalanced stylesheet: a } without its {")
      closing.block.declarations = customProperties(closing.body + text)
      text = ""
    } else {
      text += ch
    }
  }
  if (open.length > 0) throw new Error("Unbalanced stylesheet: a { is never closed")
  return blocks
}

const ROOT_THEME = /:root|^html(?![\w-])|\.dark(?![\w-])|\[data-(?:theme|mode)|:host/

/**
 * useApplyTheme puts `.dark` AND `data-theme="dark"` on `<html>`, an editor host the guide's
 * `data-cd-theme="dark"`; all share `.dark`'s specificity.
 */
const DARK_ROOT_SCOPES: ReadonlySet<string> = new Set([
  ".dark",
  '[data-theme="dark"]',
  '[data-theme-mode="dark"]',
  '[data-cd-theme="dark"]',
])

const DENSITY: ReadonlySet<string> = new Set(POINTER_ROLES)

/**
 * The density roles and the field's text hold no colour: their comfortable step switches under a
 * media query.
 */
const switchesDensityOnly = (block: RuleBlock) =>
  block.declarations.every(([name]) => DENSITY.has(name))

/** The OS's dark mode, as a block's one parent names it (whitespace folded). */
const OS_DARK_MEDIA = "@media(prefers-color-scheme:dark)"

/**
 * The OS's dark root, a root that names no mode (whitespace folded): as theme.css writes it, its
 * `:where()` keeping the dark scopes' specificity, or as a plain `:not()`.
 */
const OS_DARK_ROOTS: readonly string[] = [
  ":root:where(:not([data-theme],[data-cd-theme],[data-theme-mode]))",
  ":root:not([data-theme],[data-cd-theme],[data-theme-mode])",
]

const folded = (text: string) => text.replace(/\s+/g, "")

/** A selector with what its parentheses and brackets hold left out: `:not(a, b)` is no combinator. */
function outsideGroups(selector: string): string {
  let depth = 0
  let out = ""
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth++
    if (depth === 0) out += ch
    if (ch === ")" || ch === "]") depth--
  }
  return out
}

interface Scope {
  light: boolean
  dark: boolean
  /** The OS's dark root (`ThemeVariables.os`). */
  os: boolean
}

const NO_SCOPE: Scope = { light: false, dark: false, os: false }

/**
 * A block for the OS's dark root: its one parent the OS's dark mode, every selector that root
 * alone (its scope), or that root with more (a light island inside it, its high contrast: the
 * copies of rules the plain scopes skip as well, so they are skipped too).
 */
function osDarkScope(block: RuleBlock, selectors: readonly string[]): Scope | null {
  if (block.parents.length !== 1 || folded(block.parents[0] ?? "") !== OS_DARK_MEDIA) return null
  const roots = selectors.map((s) => {
    const f = folded(s)
    return OS_DARK_ROOTS.find((root) => f.startsWith(root)) === undefined
      ? null
      : OS_DARK_ROOTS.includes(f)
  })
  if (roots.some((root) => root === null)) return null
  return roots.some(Boolean) ? { light: false, dark: false, os: true } : NO_SCOPE
}

/**
 * Descendant scopes reach no root variable and are skipped; the OS's dark root is the `os`
 * scope; any other root-theme rule (higher specificity, media query, layer) throws instead of
 * measuring the wrong colour, unless it is nested and sets density roles only
 * (`@media (any-pointer: coarse)`). In a nested block a space inside a group (`:not(a, b)`) is
 * no combinator, so no root rule escapes the throw by the spaces of its own selector.
 */
function rootScope(block: RuleBlock): Scope {
  const selectors = selectorList(block.prelude)
  const unsupported = () =>
    new Error(
      `Unsupported theme rule "${[...block.parents, block.prelude].join(" { ")}": declare theme variables in plain :root and .dark blocks`,
    )
  if (block.parents.length > 0) {
    const os = osDarkScope(block, selectors)
    if (os) return os
    const reachesRoot = selectors.some(
      (s) => ROOT_THEME.test(s) && !/[\s>+~]/.test(outsideGroups(s)),
    )
    if (reachesRoot && !switchesDensityOnly(block)) throw unsupported()
    return NO_SCOPE
  }
  let light = false
  let dark = false
  for (const selector of selectors) {
    if (selector === ":root") light = dark = true
    else if (DARK_ROOT_SCOPES.has(selector.replaceAll("'", '"'))) dark = true
    else if (ROOT_THEME.test(selector) && !/[\s>+~]/.test(selector) && selector !== ":host") {
      throw unsupported()
    }
  }
  return { light, dark, os: dark }
}

const isThemeBlock = (block: RuleBlock) => /^@theme\b/.test(block.prelude)

/**
 * `@theme` blocks sit below every unlayered rule. Dark reads `:root` AND `.dark`, so a
 * later light-only `:root` override reaches dark too, as in the browser. The OS's dark (`os`)
 * reads what dark reads and the blocks for the OS's dark root on top, in their order, so a
 * brand's dark values are measured in both places it writes them.
 */
export function parseThemeVariables(...stylesheets: string[]): ThemeVariables {
  const blocks = stylesheets.flatMap((css) => ruleBlocks(stripComments(css)))
  const light = new Map<string, string>()
  const dark = new Map<string, string>()
  const os = new Map<string, string>()
  for (const block of blocks.filter((b) => isThemeBlock(b) && b.parents.length === 0)) {
    for (const [name, value] of block.declarations) {
      light.set(name, value)
      dark.set(name, value)
      os.set(name, value)
    }
  }
  for (const block of blocks) {
    if (block.declarations.length === 0 || isThemeBlock(block)) continue
    const scope = rootScope(block)
    for (const [name, value] of block.declarations) {
      if (scope.light) light.set(name, value)
      if (scope.dark) dark.set(name, value)
      if (scope.os) os.set(name, value)
    }
  }
  return { light, dark, os }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function parseHex(hex: string): Rgba {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
  const channel = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255
  return { r: channel(0), g: channel(2), b: channel(4), a: h.length === 8 ? channel(6) : 1 }
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c: number): number {
  const x = clamp01(c)
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
}

function oklabToRgb(L: number, a: number, b: number, alpha: number): Rgba {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  }
}

function rgbToOklab({ r, g, b }: Rgba): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fraction(token: string): number {
  return token.endsWith("%") ? parseFloat(token) / 100 : parseFloat(token)
}

function parseOklch(args: string): Rgba {
  const [channels, alpha] = args.split("/").map((s) => s.trim())
  const [L, C, H] = channels.split(/\s+/)
  const hue = (parseFloat(H) * Math.PI) / 180
  const c = parseFloat(C)
  return oklabToRgb(fraction(L), c * Math.cos(hue), c * Math.sin(hue), alpha ? fraction(alpha) : 1)
}

function topLevelArgs(args: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "(") depth++
    else if (args[i] === ")") depth--
    else if (args[i] === "," && depth === 0) {
      out.push(args.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(args.slice(start).trim())
  return out
}

function mix(space: string, a: Rgba, wa: number, b: Rgba, wb: number): Rgba {
  const alpha = a.a * wa + b.a * wb
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const blend = (x: number, y: number) => (x * a.a * wa + y * b.a * wb) / alpha
  if (space === "oklab") {
    const [la, aa, ba] = rgbToOklab(a)
    const [lb, ab, bb] = rgbToOklab(b)
    return oklabToRgb(blend(la, lb), blend(aa, ab), blend(ba, bb), alpha)
  }
  return { r: blend(a.r, b.r), g: blend(a.g, b.g), b: blend(a.b, b.b), a: alpha }
}

const NAMED: Readonly<Record<string, Rgba>> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 1, g: 1, b: 1, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
}

function resolveVar(
  name: string,
  fallback: string | undefined,
  vars: Map<string, string>,
  seen: Set<string>,
): Rgba {
  if (seen.has(name)) throw new Error(`Circular theme variable ${name}`)
  const next = vars.get(name)
  if (next !== undefined) return resolveColor(next, vars, new Set([...seen, name]))
  if (fallback) return resolveColor(fallback, vars, seen)
  throw new Error(`Undefined theme variable ${name}`)
}

function resolveColorMix(args: string, vars: Map<string, string>, seen: Set<string>): Rgba {
  const [space, first, second] = topLevelArgs(args)
  const term = (t: string) => {
    const pct = /\s(\d+(?:\.\d+)?)%$/.exec(t)
    return {
      color: resolveColor(pct ? t.slice(0, pct.index) : t, vars, seen),
      weight: pct ? parseFloat(pct[1]) / 100 : undefined,
    }
  }
  const x = term(first)
  const y = term(second)
  const wx = x.weight ?? (y.weight === undefined ? 0.5 : 1 - y.weight)
  return mix(space.replace(/^in\s+/, "").trim(), x.color, wx, y.color, y.weight ?? 1 - wx)
}

function parseVarReference(value: string): { name: string; fallback?: string } | undefined {
  if (!value.startsWith("var(") || !value.endsWith(")")) return undefined
  const inner = value.slice(4, -1)
  const comma = inner.indexOf(",")
  const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
  if (!/^--[\w-]+$/.test(name)) return undefined
  if (comma === -1) return { name }
  const fallback = inner.slice(comma + 1).trim()
  return fallback ? { name, fallback } : { name }
}

/** Only the shapes the theme uses; anything else throws so a new shape fails loudly, not as garbage. */
export function resolveColor(
  value: string,
  vars: Map<string, string>,
  seen = new Set<string>(),
): Rgba {
  const v = value.trim()
  const varRef = parseVarReference(v)
  if (varRef) return resolveVar(varRef.name, varRef.fallback, vars, seen)
  if (v.startsWith("#")) return parseHex(v)
  if (v in NAMED) return NAMED[v]
  const fn = /^(oklch|color-mix)\((.+)\)$/.exec(v)
  if (fn?.[1] === "oklch") return parseOklch(fn[2])
  if (fn?.[1] === "color-mix") return resolveColorMix(fn[2], vars, seen)
  throw new Error(`Unsupported colour value: ${v}`)
}

export function composite(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A translucent `bg` is painted over `over` (default `--card`) first, a translucent `fg` over that. */
export interface ContrastPair {
  label: string
  fg: string
  bg: string
  over?: string
  /** 4.5 for text, 3 for non-text (borders, dots, icons, focus rings). */
  min: number
}

export interface ContrastResult {
  mode: ContrastMode
  label: string
  ratio: number
  min: number
}

function ratioOf(vars: Map<string, string>, pair: ContrastPair): number {
  const color = (name: string) => resolveColor(`var(${name})`, vars)
  const base = composite(color(pair.over ?? "--card"), { r: 1, g: 1, b: 1, a: 1 })
  const bg = composite(color(pair.bg), base)
  const fg = composite(color(pair.fg), bg)
  return contrastRatio(fg, bg)
}

/**
 * Each pair in light and dark, and in the OS's dark (`os-dark`) where that resolves the pair to
 * another ratio than dark does: a theme that repeats its dark values for the OS, as the kit's
 * does, measures them once.
 */
export function measureContrast(
  theme: ThemeVariables,
  pairs: readonly ContrastPair[],
): ContrastResult[] {
  const results: ContrastResult[] = []
  for (const mode of ["light", "dark"] as const) {
    for (const pair of pairs) {
      results.push({ mode, label: pair.label, ratio: ratioOf(theme[mode], pair), min: pair.min })
    }
  }
  const { os } = theme
  if (os) {
    for (const pair of pairs) {
      const ratio = ratioOf(os, pair)
      if (Math.abs(ratio - ratioOf(theme.dark, pair)) > 1e-9) {
        results.push({ mode: "os-dark", label: pair.label, ratio, min: pair.min })
      }
    }
  }
  return results
}

export function contrastFindings(theme: ThemeVariables, pairs: readonly ContrastPair[]): string[] {
  return measureContrast(theme, pairs)
    .filter((r) => r.ratio < r.min)
    .map((r) => `${r.mode}: ${r.label}`)
}
