import { readFileSync } from "node:fs"
import ts from "typescript"
import { literalText, parseSource, relativePath, sourceFiles, walkNodes } from "./source-scan.js"

/** 16 px in chrome, 24 px for previews. A kit `Button`'s `size` is a string variant and stays out of it. */
export const CI_ICON_SIZES: readonly number[] = [16, 24]

/**
 * The named deviation of the density section (root CLAUDE.md): 12 px beside dense text and on
 * 20 px badges, only in the files a gate lists with a reason (`allowDense`).
 */
export const DENSE_ICON_SIZE = 12

export interface IconSizeFinding {
  file: string
  /** 0 for an allowance nothing needs. */
  line: number
  size: number
  /** What sets it: `size={14}`, `[&>svg]:size-3!`, `size-5`, `dense`, or `unused allowance`. */
  match: string
}

/** Tailwind's `--spacing` step and the root size, so `size-3` is 12 px and `size-[1.25rem]` 20. */
const ROOT_PX = 16
const SPACING_PX = 4
const SIZE_CLASS = /^!?size-(?:(\d*\.?\d+)|\[(\d*\.?\d+)(px|rem)\])!?$/
/** An arbitrary variant that selects the svg (or a Lucide icon) below the element it sits on. */
const SVG_VARIANT = /^\[&[_>~+]*(?:svg|\.lucide)(?![\w-])/

interface Sized {
  at: number
  size: number
  match: string
}

function classPx(utility: string): number | undefined {
  const m = SIZE_CLASS.exec(utility)
  if (!m) return undefined
  if (m[1] !== undefined) return Number(m[1]) * SPACING_PX
  return m[3] === "px" ? Number(m[2]) : Number(m[2]) * ROOT_PX
}

/** The variants and the utility of a class, split on the colons outside brackets and parentheses. */
function classParts(token: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === "[" || c === "(") depth++
    else if (c === "]" || c === ")") depth--
    else if (c === ":" && depth === 0) {
      parts.push(token.slice(start, i))
      start = i + 1
    }
  }
  parts.push(token.slice(start))
  return parts
}

/** `onSvg`: the classes an svg selector applies; otherwise the ones on the element itself. */
function sizeClasses(text: string, onSvg: boolean): Sized[] {
  const out: Sized[] = []
  for (const m of text.matchAll(/\S+/g)) {
    const parts = classParts(m[0])
    const utility = parts.pop() ?? ""
    const size = classPx(utility)
    if (size === undefined || parts.some((v) => SVG_VARIANT.test(v)) !== onSvg) continue
    out.push({ at: m.index, size, match: m[0] })
  }
  return out
}

/** The local names of the Lucide components a file imports. */
function lucideNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of sf.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "lucide-react"
    ) {
      continue
    }
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.add(element.name.text)
    }
  }
  return names
}

function isIconElement(attribute: ts.JsxAttribute, icons: Set<string>, sf: ts.SourceFile): boolean {
  const element = attribute.parent.parent
  const tag = element.tagName.getText(sf)
  return tag === "Icon" || icons.has(tag)
}

/** The literal texts in an expression, each with its offset in the file. */
function literalsIn(node: ts.Node, sf: ts.SourceFile): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = []
  const step = (child: ts.Node) => {
    const text = literalText(child)
    if (text !== undefined) out.push({ text, at: child.getStart(sf) + 1 })
    ts.forEachChild(child, step)
  }
  step(node)
  return out
}

/** The numbers a `size={…}` sets, a conditional's branches included. */
function numericSizes(expression: ts.Expression, sf: ts.SourceFile): Sized[] {
  if (ts.isParenthesizedExpression(expression)) return numericSizes(expression.expression, sf)
  if (ts.isConditionalExpression(expression)) {
    return [...numericSizes(expression.whenTrue, sf), ...numericSizes(expression.whenFalse, sf)]
  }
  if (!ts.isNumericLiteral(expression)) return []
  const size = Number(expression.text)
  return [{ at: expression.getStart(sf), size, match: `size={${expression.text}}` }]
}

/** The kit `Icon`'s `dense` (12 px), unless it is a literal `dense={false}`. */
function denseSize(node: ts.JsxAttribute, sf: ts.SourceFile): Sized[] {
  if (node.parent.parent.tagName.getText(sf) !== "Icon") return []
  const value = node.initializer
  if (value && ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.FalseKeyword) {
    return []
  }
  return [{ at: node.getStart(sf), size: DENSE_ICON_SIZE, match: "dense" }]
}

function attributeSizes(node: ts.JsxAttribute, icons: Set<string>, sf: ts.SourceFile): Sized[] {
  const name = node.name.getText(sf)
  if (name === "dense") return denseSize(node, sf)
  const value = node.initializer
  if (name === "size" && value && ts.isJsxExpression(value) && value.expression) {
    return numericSizes(value.expression, sf)
  }
  if (name !== "className" || !value || !isIconElement(node, icons, sf)) return []
  return literalsIn(value, sf).flatMap(({ text, at }) =>
    sizeClasses(text, false).map((sized) => ({ ...sized, at: at + sized.at })),
  )
}

/**
 * Every place a file sets an icon's size: a numeric `size` on any element (both branches of a
 * conditional), a `size-*` class on an svg selector (`[&>svg]:size-3`, `[&_svg]:size-5`)
 * anywhere in the file, a `size-*` class on `Icon` or on a Lucide component the file
 * imports, and the kit `Icon`'s `dense` (12 px; a `dense={…}` that may be true counts). A class
 * handed in through a variable is left to review.
 */
export function iconSizeFindings(source: string, file: string): IconSizeFinding[] {
  const sf = parseSource(source, file)
  const icons = lucideNames(sf)
  const sized: Sized[] = []
  walkNodes(sf, (node) => {
    if (ts.isJsxAttribute(node)) {
      sized.push(...attributeSizes(node, icons, sf))
      return
    }
    const text = literalText(node)
    if (text === undefined) return
    const at = node.getStart(sf) + 1
    sized.push(...sizeClasses(text, true).map((s) => ({ ...s, at: at + s.at })))
  })
  return sized
    .filter(({ size }) => !CI_ICON_SIZES.includes(size))
    .sort((a, b) => a.at - b.at)
    .map(({ at, size, match }) => ({
      file,
      line: sf.getLineAndCharacterOfPosition(at).line + 1,
      size,
      match,
    }))
}

export interface ScanIconSizesOptions {
  /**
   * The files that may draw icons at {@link DENSE_ICON_SIZE}, each with its reason. Shrink-only:
   * a listed file without a 12 px icon (or gone) comes back as an "unused allowance".
   */
  allowDense?: Readonly<Record<string, string>>
}

export function scanIconSizes(dir: string, options: ScanIconSizesOptions = {}): IconSizeFinding[] {
  const allow = options.allowDense ?? {}
  for (const [file, reason] of Object.entries(allow)) {
    if (!reason.trim()) throw new Error(`The allowance for ${file} needs a reason`)
  }
  const findings = sourceFiles(dir).flatMap((path) =>
    iconSizeFindings(readFileSync(path, "utf8"), relativePath(dir, path)),
  )
  const isDense = (f: IconSizeFinding) => f.size === DENSE_ICON_SIZE && f.file in allow
  const unused = Object.keys(allow)
    .filter((file) => !findings.some((f) => f.file === file && f.size === DENSE_ICON_SIZE))
    .map((file) => ({ file, line: 0, size: DENSE_ICON_SIZE, match: "unused allowance" }))
  return [...findings.filter((f) => !isDense(f)), ...unused]
}
