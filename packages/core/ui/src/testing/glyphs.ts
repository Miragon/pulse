import { readFileSync } from "node:fs"
import ts from "typescript"
import {
  lineOf,
  literalText,
  parseSource,
  relativePath,
  sourceFiles,
  walkNodes,
} from "./source-scan.js"

/** No Unicode glyphs or emoji as icons: they render in the host's font (⚙ and ⏱ came out as colour emoji) and carry no accessible name. ✦ is the AI sparkle the CI rules out. */
export const FORBIDDEN_GLYPHS: readonly string[] = [
  "✦",
  "⊡",
  "▦",
  "↗",
  "›",
  "⚠",
  "⚙",
  "⏱",
  "⤧",
  "▶",
  "✓",
  "✕",
  "▤",
  "⊞",
  "↻",
  "×",
]

/** Emoji minus the Arrows block: ↔ ↕ ↩ are pictographic only as emoji; an arrow icon is caught as a lone symbol. */
const EMOJI = /(?![←-⇿])\p{Extended_Pictographic}/u

/** A lone symbol as an element's whole content is the glyph-as-icon signature; in running text it is typography. */
const LONE_SYMBOL = /^[\p{Sm}\p{So}\p{Pi}\p{Pf}!?]+$/u

/** CI U4: never the AI affordance. */
const SPARKLE_IMPORT = /^(Lucide)?(Sparkles?|WandSparkles|Wand2)(Icon)?$/
/** …and as a deep import (`lucide-react/icons/sparkles`). */
const SPARKLE_PATH = /^lucide-react\/(?:.*\/)?(sparkles?|wand-sparkles|wand-2)(?:\.js)?$/

export interface GlyphFinding {
  file: string
  line: number
  glyph: string
  text: string
}

function offendingGlyph(text: string): string | undefined {
  return FORBIDDEN_GLYPHS.find((g) => text.includes(g)) ?? EMOJI.exec(text)?.[0]
}

function isOnlyJsxChild(node: ts.Node): boolean {
  const parent = node.parent
  if (!(ts.isJsxElement(parent) || ts.isJsxFragment(parent))) return false
  const meaningful = parent.children.filter((child) =>
    ts.isJsxText(child)
      ? child.text.trim() !== ""
      : !(ts.isJsxExpression(child) && !child.expression),
  )
  return meaningful.length === 1 && meaningful[0] === node
}

const VALUE_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

/** Whether a literal renders as its JSX element's whole content: `{"×"}`, `{open ? "▲" : "▼"}`. */
function rendersAsWholeElement(literal: ts.Node): boolean {
  let current = literal
  for (;;) {
    const parent = current.parent
    const passesValueThrough =
      ts.isParenthesizedExpression(parent) ||
      (ts.isConditionalExpression(parent) && parent.condition !== current) ||
      (ts.isBinaryExpression(parent) &&
        parent.right === current &&
        VALUE_OPERATORS.has(parent.operatorToken.kind))
    if (!passesValueThrough) return ts.isJsxExpression(parent) && isOnlyJsxChild(parent)
    current = parent
  }
}

function loneSymbolIcon(node: ts.Node, text: string): string | undefined {
  const symbol = text.trim()
  if (!LONE_SYMBOL.test(symbol)) return undefined
  const whole = ts.isJsxText(node) ? isOnlyJsxChild(node) : rendersAsWholeElement(node)
  return whole ? symbol : undefined
}

type SparkleHit = [glyph: string, at: ts.Node]

/** The module a lucide-react import or re-export names, with the icon of a deep path. */
function lucideSpecifier(node: ts.Node): { from: string; deep?: string } | undefined {
  if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) return undefined
  const spec = node.moduleSpecifier
  if (!spec || !ts.isStringLiteral(spec)) return undefined
  const deep = SPARKLE_PATH.exec(spec.text)?.[1]
  return deep || spec.text === "lucide-react" ? { from: spec.text, deep } : undefined
}

/** Named bindings that pick a sparkle: `import { Sparkles as X }`, `export { Sparkles as X } from`. */
function namedSparkles(elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>) {
  return elements
    .map((el): SparkleHit => [(el.propertyName ?? el.name).text, el])
    .filter(([name]) => SPARKLE_IMPORT.test(name))
}

/**
 * The sparkle in an import or re-export of lucide-react: a named binding, a deep path, or
 * `export *` (which hands every sparkle on under another module's name). A namespace import
 * is no finding by itself; its sparkle member is (`namespaceSparkle`).
 */
function sparkleImports(node: ts.Node): SparkleHit[] {
  const lucide = lucideSpecifier(node)
  if (!lucide) return []
  if (lucide.deep) return [[lucide.deep, node]]
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause
    if (!clause || ts.isNamespaceExport(clause)) return [["*", node]]
    return namedSparkles(clause.elements)
  }
  const named = (node as ts.ImportDeclaration).importClause?.namedBindings
  return named && ts.isNamedImports(named) ? namedSparkles(named.elements) : []
}

/** Local names of `import * as Icons from "lucide-react"`. */
function lucideNamespaces(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of sf.statements) {
    const lucide = lucideSpecifier(statement)
    const named = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined
    if (lucide && !lucide.deep && named && ts.isNamespaceImport(named)) {
      names.add(named.name.text)
    }
  }
  return names
}

/** A sparkle read off a lucide-react namespace: `Icons.Sparkles`, `<Icons.Sparkles />`, `Icons["Sparkles"]`. */
function namespaceSparkle(node: ts.Node, namespaces: Set<string>): string | undefined {
  let target: ts.Expression
  let member: string
  if (ts.isPropertyAccessExpression(node)) {
    target = node.expression
    member = node.name.text
  } else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    target = node.expression
    member = node.argumentExpression.text
  } else return undefined
  const fromLucide = ts.isIdentifier(target) && namespaces.has(target.text)
  return fromLucide && SPARKLE_IMPORT.test(member) ? member : undefined
}

/** Comments are not scanned: a comment may name what it bans. */
export function glyphFindings(source: string, file: string): GlyphFinding[] {
  const sf = parseSource(source, file)
  const findings: GlyphFinding[] = []
  const namespaces = lucideNamespaces(sf)
  walkNodes(sf, (node) => {
    for (const [glyph, at] of sparkleImports(node)) {
      findings.push({ file, line: lineOf(sf, at), glyph, text: node.getText(sf).slice(0, 80) })
    }
    const member = namespaceSparkle(node, namespaces)
    if (member) {
      findings.push({ file, line: lineOf(sf, node), glyph: member, text: node.getText(sf) })
    }
    const text = literalText(node) ?? (ts.isJsxText(node) ? node.text : undefined)
    if (text === undefined) return
    const glyph = offendingGlyph(text) ?? loneSymbolIcon(node, text)
    if (glyph)
      findings.push({ file, line: lineOf(sf, node), glyph, text: text.trim().slice(0, 80) })
  })
  return findings
}

export function scanGlyphs(dir: string): GlyphFinding[] {
  return sourceFiles(dir).flatMap((path) =>
    glyphFindings(readFileSync(path, "utf8"), relativePath(dir, path)),
  )
}
