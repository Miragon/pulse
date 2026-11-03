import { blankComments, stylesheetColorFindings } from "./colors.js"

/** A consumer stylesheet's rules with its comments blanked, so a comment may name what it forbids. */
export const stylesheetRules = (css: string): string => blankComments(css)

/** A retired accent declared again (`--m-blue: …`, `--critical-soft: …`) would style nothing. */
const RETIRED_ACCENT_DECLARATION = /^\s*--(?:color-)?(?:m-(?:blue|green)|critical)[\w-]*\s*:/

/** A `--cd-*` token declared in the stylesheet. */
const CD_TOKEN_DECLARATION = /^\s*--cd-[\w-]+\s*:/

/**
 * The stylesheet cut at every `;`, `{` and `}`: each piece holds at most one declaration, so the
 * declaration patterns stay anchored and linear (unanchored, they backtrack on repeated names).
 */
const declarations = (rules: string): string[] => rules.split(/[;{}]/)

/** `font-family … !important` within one declaration. */
function forcesFont(declaration: string): boolean {
  const name = declaration.indexOf("font-family")
  return name >= 0 && declaration.lastIndexOf("!important") >= name + "font-family".length
}

/**
 * Every innermost block as `{ prelude, body }`: each piece before a `}` that holds a `{` is a
 * block, its prelude running back to the previous `{` or `}`. Brace by brace, never a regex
 * over a long run without braces.
 */
function innermostBlocks(rules: string): { prelude: string; body: string }[] {
  const blocks: { prelude: string; body: string }[] = []
  for (const piece of rules.split("}").slice(0, -1)) {
    const open = piece.lastIndexOf("{")
    const prelude = open < 0 ? "" : piece.slice(piece.lastIndexOf("{", open - 1) + 1, open)
    if (prelude) blocks.push({ prelude, body: piece.slice(open + 1) })
  }
  return blocks
}

/**
 * Every rule block whose selector list targets html, body or #root, as `selector { body }`. The
 * selector runs back to the previous brace, so a finished statement in front of it (`@import …;`)
 * is dropped first.
 */
function documentRules(rules: string): string[] {
  return innermostBlocks(rules)
    .map(({ prelude, body }) => ({ selector: (prelude.split(";").pop() ?? "").trim(), body }))
    .filter(({ selector }) => selector.split(",").some((s) => /^\s*(html|body|#root)\s*$/.test(s)))
    .map(({ selector, body }) => `${selector} { ${body.trim().replace(/\s+/g, " ")} }`)
}

/**
 * The view's shape (#339) in a stylesheet every view document inlines (a host app's or a
 * consumer's brand): no `min-height` floor on html, body or #root (auto-resize measures the
 * document, so every inline view would be that tall in the chat); no forced font
 * (`font-family … !important` beats the host's font and every `font-mono`) and no inlined one
 * (`@fontsource`, pulse-ui's `fonts.css`, `@font-face`: base64 in every view, while Geist arrives by
 * URL from the server's font route); no raw colour or retired accent (`stylesheetColorFindings`)
 * and no `--cd-*` token of its own (pulse-ui vendors them once).
 * @returns one `<file>: …` line per finding; empty when the stylesheet keeps the shape
 */
export function stylesheetShapeFindings(css: string, file: string): string[] {
  const rules = stylesheetRules(css)
  const findings = documentRules(rules)
    .filter((rule) => /min-height/.test(rule))
    .map((rule) => `${file}: a min-height floor on html, body or #root: ${rule}`)
  const pieces = declarations(rules)
  if (pieces.some(forcesFont)) {
    findings.push(`${file}: a forced font (font-family with !important)`)
  }
  if (/@fontsource|pulse-ui\/fonts\.css|@font-face/.test(rules)) {
    findings.push(`${file}: an inlined font (@fontsource, pulse-ui/fonts.css or @font-face)`)
  }
  if (pieces.some((piece) => CD_TOKEN_DECLARATION.test(piece))) {
    findings.push(`${file}: declares a --cd-* token`)
  }
  if (pieces.some((piece) => RETIRED_ACCENT_DECLARATION.test(piece))) {
    findings.push(`${file}: declares a retired accent (--m-*, --critical)`)
  }
  for (const { line, match } of stylesheetColorFindings(css, file)) {
    findings.push(`${file}:${line}: a raw colour or retired accent, ${match}`)
  }
  return findings
}
