import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

/**
 * WCAG contrast over the THEME as written, resolved the way the browser would, so a brand
 * override that drops a role below AA fails a test, not a screenshot review.
 */

/** Pass first, then a consumer's brand: `parseThemeVariables(...toolkitThemeStylesheets(), brandCss)`. */
export function toolkitThemeStylesheets(): string[] {
  const require = createRequire(import.meta.url)
  const read = (entry: string) => readFileSync(require.resolve(entry), "utf8")
  return [
    read("@miragon/mcp-toolkit-ui/cd-tokens.generated.css"),
    read("@miragon/mcp-toolkit-ui/theme.css"),
  ]
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
}

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

/** useApplyTheme puts `.dark` AND `data-theme="dark"` on `<html>`; all share `.dark`'s specificity. */
const DARK_ROOT_SCOPES: ReadonlySet<string> = new Set([
  ".dark",
  '[data-theme="dark"]',
  '[data-theme-mode="dark"]',
])

/**
 * Descendant scopes reach no root variable and are skipped; any other root-theme rule
 * (higher specificity, media query, layer) throws instead of measuring the wrong colour.
 */
function rootScope(block: RuleBlock): { light: boolean; dark: boolean } {
  const selectors = selectorList(block.prelude)
  const unsupported = () =>
    new Error(
      `Unsupported theme rule "${[...block.parents, block.prelude].join(" { ")}": declare theme variables in plain :root and .dark blocks`,
    )
  const reachesRoot = selectors.some((s) => ROOT_THEME.test(s) && !/[\s>+~]/.test(s))
  if (block.parents.length > 0) {
    if (reachesRoot) throw unsupported()
    return { light: false, dark: false }
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
  return { light, dark }
}

const isThemeBlock = (block: RuleBlock) => /^@theme\b/.test(block.prelude)

/**
 * `@theme` blocks sit below every unlayered rule. Dark reads `:root` AND `.dark`, so a
 * later light-only `:root` override reaches dark too, as in the browser.
 */
export function parseThemeVariables(...stylesheets: string[]): ThemeVariables {
  const blocks = stylesheets.flatMap((css) => ruleBlocks(stripComments(css)))
  const light = new Map<string, string>()
  const dark = new Map<string, string>()
  for (const block of blocks.filter((b) => isThemeBlock(b) && b.parents.length === 0)) {
    for (const [name, value] of block.declarations) {
      light.set(name, value)
      dark.set(name, value)
    }
  }
  for (const block of blocks) {
    if (block.declarations.length === 0 || isThemeBlock(block)) continue
    const scope = rootScope(block)
    for (const [name, value] of block.declarations) {
      if (scope.light) light.set(name, value)
      if (scope.dark) dark.set(name, value)
    }
  }
  return { light, dark }
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
  mode: ThemeMode
  label: string
  ratio: number
  min: number
}

export function measureContrast(
  theme: ThemeVariables,
  pairs: readonly ContrastPair[],
): ContrastResult[] {
  const results: ContrastResult[] = []
  for (const mode of ["light", "dark"] as const) {
    const vars = theme[mode]
    const color = (name: string) => resolveColor(`var(${name})`, vars)
    for (const pair of pairs) {
      const base = composite(color(pair.over ?? "--card"), { r: 1, g: 1, b: 1, a: 1 })
      const bg = composite(color(pair.bg), base)
      const fg = composite(color(pair.fg), bg)
      results.push({ mode, label: pair.label, ratio: contrastRatio(fg, bg), min: pair.min })
    }
  }
  return results
}

export function contrastFindings(theme: ThemeVariables, pairs: readonly ContrastPair[]): string[] {
  return measureContrast(theme, pairs)
    .filter((r) => r.ratio < r.min)
    .map((r) => `${r.mode}: ${r.label}`)
}
