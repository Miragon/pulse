import { readFileSync } from "node:fs"
import {
  lineOf,
  literalText,
  parseSource,
  relativePath,
  sourceFiles,
  walkNodes,
} from "./source-scan.js"

/** Widget text sits on the toolkit's five TYPE_SCALE steps, nothing below 13 px; step names say what the text IS, so the scale changes in one place. */
export type TypeScaleRule = "below-floor" | "off-scale"

export interface TypeScaleFinding {
  file: string
  line: number
  rule: TypeScaleRule
  match: string
  text: string
}

/** The floor, in px (CI §4 "klein"); `0.8125rem` at the default 16 px root. */
const FLOOR_PX = 13
const ROOT_PX = 16

const BELOW_FLOOR_CLASS = /(?<![\w-])(?:[\w-]+:)*text-(?:2?xs)(?![\w-])/g
const OFF_SCALE_CLASS = /(?<![\w-])(?:[\w-]+:)*text-(?:sm|base|lg|[2-9]?xl)(?![\w-])/g
/** `text-[11px]`, `text-[0.8rem]`, `text-[length:12px]`. */
const ARBITRARY_SIZE = /(?<![\w-])(?:[\w-]+:)*text-\[(?:length:)?(\d*\.?\d+)(px|rem|em)\]/g

function px(value: string, unit: string): number {
  const n = Number(value)
  return unit === "px" ? n : n * ROOT_PX
}

function literalFindings(text: string): Array<{ rule: TypeScaleRule; match: string; at: number }> {
  const out: Array<{ rule: TypeScaleRule; match: string; at: number }> = []
  for (const m of text.matchAll(BELOW_FLOOR_CLASS)) {
    out.push({ rule: "below-floor", match: m[0], at: m.index })
  }
  for (const m of text.matchAll(OFF_SCALE_CLASS)) {
    out.push({ rule: "off-scale", match: m[0], at: m.index })
  }
  for (const m of text.matchAll(ARBITRARY_SIZE)) {
    const rule = px(m[1], m[2]) < FLOOR_PX ? "below-floor" : "off-scale"
    out.push({ rule, match: m[0], at: m.index })
  }
  return out.sort((a, b) => a.at - b.at)
}

export function typeScaleFindings(source: string, file: string): TypeScaleFinding[] {
  const sf = parseSource(source, file)
  const findings: TypeScaleFinding[] = []
  walkNodes(sf, (node) => {
    const text = literalText(node)
    if (text === undefined) return
    for (const { rule, match } of literalFindings(text)) {
      findings.push({ file, line: lineOf(sf, node), rule, match, text: text.trim().slice(0, 80) })
    }
  })
  return findings
}

export interface ScanTypeScaleOptions {
  /** A package still migrating its widgets starts with `["below-floor"]`. */
  rules?: readonly TypeScaleRule[]
}

export function scanTypeScale(dir: string, options: ScanTypeScaleOptions = {}): TypeScaleFinding[] {
  const rules = new Set<TypeScaleRule>(options.rules ?? ["below-floor", "off-scale"])
  return sourceFiles(dir)
    .flatMap((path) => typeScaleFindings(readFileSync(path, "utf8"), relativePath(dir, path)))
    .filter((finding) => rules.has(finding.rule))
}
