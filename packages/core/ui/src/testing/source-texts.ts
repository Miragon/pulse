import { readFileSync } from "node:fs"
import ts from "typescript"
import { parseSource, relativePath, sourceFiles, walkNodes } from "./source-scan.js"

/** A template's substitution, as a catalog writes a placeholder (`glossaryFindings` drops it). */
const SUBSTITUTION = "{value}"

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    ts.isLiteralTypeNode(parent)
  )
}

/** A template with substitutions reads as one text, so a word on each side of a value stays one phrase. */
function textOf(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return isModuleSpecifier(node) ? undefined : node.text
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text + node.templateSpans.map((span) => SUBSTITUTION + span.literal.text).join("")
    )
  }
  if (ts.isJsxText(node)) {
    const text = node.text.replace(/\s+/g, " ").trim()
    return text === "" ? undefined : text
  }
  return undefined
}

function positionOf(node: ts.Node, sf: ts.SourceFile): string {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return `${String(line + 1)}:${String(character + 1)}`
}

/**
 * The words of a source tree as a catalog, for a UI that keeps its texts in code rather than in
 * a catalog (the VS Code webview): every string literal, template and JSX text, keyed
 * `file:line:column` relative to `dir`, so `glossaryFindings` reads them like catalog entries.
 * Module specifiers and string literal types are code, not words, and stay out.
 */
export function sourceTexts(dir: string): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const path of sourceFiles(dir)) {
    const sf = parseSource(readFileSync(path, "utf8"), path)
    walkNodes(sf, (node) => {
      const text = textOf(node)
      if (text === undefined) return
      texts[`${relativePath(dir, path)}:${positionOf(node, sf)}`] = text
    })
  }
  return texts
}
