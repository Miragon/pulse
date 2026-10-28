import { readFileSync } from "node:fs"
import ts from "typescript"
import { lineOf, parseSource, relativePath, sourceFiles, walkNodes } from "./source-scan.js"

/** 16 px in chrome, 24 px for previews. A toolkit `Button`'s `size` is a string variant and stays out of it. */
export const CI_ICON_SIZES: readonly number[] = [16, 24]

export interface IconSizeFinding {
  file: string
  line: number
  size: number
}

export function iconSizeFindings(source: string, file: string): IconSizeFinding[] {
  const sf = parseSource(source, file)
  const findings: IconSizeFinding[] = []
  walkNodes(sf, (node) => {
    if (
      !ts.isJsxAttribute(node) ||
      node.name.getText(sf) !== "size" ||
      !node.initializer ||
      !ts.isJsxExpression(node.initializer) ||
      !node.initializer.expression ||
      !ts.isNumericLiteral(node.initializer.expression)
    ) {
      return
    }
    const size = Number(node.initializer.expression.text)
    if (!CI_ICON_SIZES.includes(size)) findings.push({ file, line: lineOf(sf, node), size })
  })
  return findings
}

export function scanIconSizes(dir: string): IconSizeFinding[] {
  return sourceFiles(dir).flatMap((path) =>
    iconSizeFindings(readFileSync(path, "utf8"), relativePath(dir, path)),
  )
}
