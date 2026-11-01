import { readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"
import ts from "typescript"

/** Never visits comments: a comment may name what a gate bans. */

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"])

/** Name order, so findings come out the same on every file system. */
export function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  // Names are unique within a directory: never equal.
  entries.sort((a, b) => (a.name < b.name ? -1 : 1))
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path)
    const isSource = /\.tsx?$/.test(entry.name) && !/\.(test|spec|d)\.tsx?$/.test(entry.name)
    return isSource ? [path] : []
  })
}

/** Stable keys for allow lists on every OS. */
export function relativePath(dir: string, path: string): string {
  return relative(dir, path).split(sep).join("/")
}

export function parseSource(source: string, file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
}

/** The text of a string or template literal (each template part on its own). */
export function literalText(node: ts.Node): string | undefined {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text
  }
  return undefined
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

export function walkNodes(sf: ts.SourceFile, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node) => {
    visit(node)
    ts.forEachChild(node, step)
  }
  step(sf)
}
