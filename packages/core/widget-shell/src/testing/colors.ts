import { readFileSync } from "node:fs"
import {
  lineOf,
  literalText,
  parseSource,
  relativePath,
  sourceFiles,
  walkNodes,
} from "./source-scan.js"

/**
 * brand-lint cannot see colours inside `.ts`/`.tsx`, so every widget package runs this.
 * Retired accents fail too: their variables left with the Miragon theme, so they would
 * now style nothing, silently.
 */

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
const UTILITY =
  "bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|placeholder|shadow|inset-shadow|inset-ring"

const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${UTILITY})(?:-[a-z]+)?-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|black|white)(?![\\w-])`,
  "g",
)

const RETIRED_ROLE_CLASS = new RegExp(
  `(?<![\\w-])(?:${UTILITY})(?:-[a-z]+)?-(?:m-(?:blue|green)(?:-(?:light|soft))?|critical(?:-(?:soft|ink))?)(?![\\w-])`,
  "g",
)

/** The variable no longer exists, so the colour falls back silently without a build error. */
const RETIRED_ROLE_VARIABLE =
  /(?<![\w-])--(?:color-)?(?:m-(?:blue|green)(?:-(?:light|soft))?|critical(?:-(?:soft|ink))?)(?![\w-])/g

/** Never part of an id like `#root`. */
const HEX = /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g

/** `color-mix(` over role variables stays allowed. */
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g

export interface ColorFinding {
  file: string
  line: number
  match: string
  text: string
}

export function colorFindings(source: string, file: string): ColorFinding[] {
  const sf = parseSource(source, file)
  const findings: ColorFinding[] = []
  walkNodes(sf, (node) => {
    const text = literalText(node)
    if (text === undefined) return
    const matches = [PALETTE_CLASS, RETIRED_ROLE_CLASS, RETIRED_ROLE_VARIABLE, HEX, COLOR_FUNCTION]
      .flatMap((pattern) => [...text.matchAll(pattern)])
      .sort((a, b) => a.index - b.index)
    for (const [match] of matches) {
      findings.push({ file, line: lineOf(sf, node), match, text: text.trim().slice(0, 80) })
    }
  })
  return findings
}

/** Newlines kept so line numbers stay true; a linear scan, not a lazy regex, since it reads consumer CSS. */
function blankComments(css: string): string {
  let out = ""
  let at = 0
  for (;;) {
    const open = css.indexOf("/*", at)
    if (open === -1) return out + css.slice(at)
    out += css.slice(at, open)
    const close = css.indexOf("*/", open + 2)
    const end = close === -1 ? css.length : close + 2
    out += css.slice(open, end).replace(/[^\n]/g, " ")
    if (close === -1) return out
    at = end
  }
}

/** Comments are skipped, so a commented-out example may hold values a customer fills in. */
export function stylesheetColorFindings(css: string, file: string): ColorFinding[] {
  const rules = blankComments(css)
  const findings: ColorFinding[] = []
  const lines = rules.split("\n")
  lines.forEach((text, index) => {
    const matches = [RETIRED_ROLE_VARIABLE, HEX, COLOR_FUNCTION]
      .flatMap((pattern) => [...text.matchAll(pattern)])
      .sort((a, b) => a.index - b.index)
    for (const [match] of matches) {
      findings.push({ file, line: index + 1, match, text: text.trim().slice(0, 80) })
    }
  })
  return findings
}

export interface ScanColorsOptions {
  /** Shrink-only: an entry whose file has no finding (or is gone) comes back as "unused allowance". */
  allow?: Readonly<Record<string, string>>
}

export function scanColors(dir: string, options: ScanColorsOptions = {}): ColorFinding[] {
  const allow = options.allow ?? {}
  for (const [file, reason] of Object.entries(allow)) {
    if (!reason.trim()) throw new Error(`The allowance for ${file} needs a reason`)
  }
  const perFile = sourceFiles(dir).map((path) => {
    const file = relativePath(dir, path)
    return { file, findings: colorFindings(readFileSync(path, "utf8"), file) }
  })
  const unused = Object.entries(allow)
    .filter(([file]) => !perFile.some((f) => f.file === file && f.findings.length > 0))
    .map(([file, reason]) => ({ file, line: 0, match: "unused allowance", text: reason }))
  return [...perFile.filter((f) => !(f.file in allow)).flatMap((f) => f.findings), ...unused]
}
