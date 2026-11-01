import ts from "typescript"

/**
 * Source readers for the hand-off guard (#338). Every Ask-AI prompt and model
 * context is assembled by widget-shell's `askAiPrompt`/`modelContextText` from
 * a typed spec — an object literal with an `intent` (hand-off) or `summary`
 * (view context) next to its `ids` and the `tools` it may name. These readers
 * find those specs and every way around the primitive, so the guard can check
 * them against the booted server.
 */

export interface HandOffSpec {
  kind: "hand-off" | "context"
  /** Repo-relative `file:line`. */
  at: string
  /** The tool names, or null when the list is not written literally. */
  tools: string[] | null
  /** The `ids` keys, or null when the object is not written literally. */
  ids: string[] | null
  /** `toolIds`: each tool's own id keys, or null when not written literally. */
  toolIds: Record<string, string[]> | null
  /** Whether the `intent`/`summary` is static text (literals, `+`, `?:`, same-file consts). */
  staticText: boolean
  /** Tool names written anywhere in the spec but its `tools`/`toolIds` (summary, facts, …). */
  namedOutsideTools: string[]
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart()).line + 1
}

/** `const NAME = <initializer>` declarations of a file, by name. */
function constInitializers(source: ts.SourceFile): Map<string, ts.Expression> {
  const consts = new Map<string, ts.Expression>()
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const) !== 0) {
      for (const decl of node.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          consts.set(decl.name.text, decl.initializer)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return consts
}

/**
 * The text of a STATIC expression — string literals joined by `+`, both arms
 * of a `?:` (the condition may be anything), a same-file `const` of such
 * text — or null when any part is data (an interpolation, a call, a prop).
 */
function staticTextOf(expr: ts.Expression, consts: Map<string, ts.Expression>): string | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text
  if (ts.isParenthesizedExpression(expr)) return staticTextOf(expr.expression, consts)
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const [left, right] = [staticTextOf(expr.left, consts), staticTextOf(expr.right, consts)]
    return left !== null && right !== null ? left + right : null
  }
  if (ts.isConditionalExpression(expr)) {
    const [yes, no] = [staticTextOf(expr.whenTrue, consts), staticTextOf(expr.whenFalse, consts)]
    return yes !== null && no !== null ? `${yes} ${no}` : null
  }
  if (ts.isIdentifier(expr)) {
    const initializer = consts.get(expr.text)
    return initializer ? staticTextOf(initializer, consts) : null
  }
  return null
}

/** `{ tool: { id: … } }` → tool → id keys; null for anything not literal. */
function literalToolIds(expr: ts.Expression): Record<string, string[]> | null {
  if (!ts.isObjectLiteralExpression(expr)) return null
  const out: Record<string, string[]> = {}
  for (const prop of expr.properties) {
    const tool = propertyName(prop)
    if (tool === null || !ts.isPropertyAssignment(prop)) return null
    const keys = literalKeys(prop.initializer)
    if (keys === null) return null
    out[tool] = keys
  }
  return out
}

/** Every `<module>_…` tool name in the string literals and templates under `node`. */
function toolNamesUnder(node: ts.Node, prefixes: readonly string[]): string[] {
  const names: string[] = []
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      names.push(...toolNamesIn(n.text, prefixes))
    } else if (ts.isTemplateExpression(n)) {
      for (const part of [n.head, ...n.templateSpans.map((span) => span.literal)]) {
        names.push(...toolNamesIn(part.text, prefixes))
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return names
}

const TOOL_PREFIXES = ["camunda7", "analytics"]

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (!node.name) return null
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text
  return null
}

/** `[...]` or `[...].filter(...)` of string literals → the names; anything else → null. */
function literalToolList(expr: ts.Expression): string[] | null {
  let list: ts.Expression = expr
  if (
    ts.isCallExpression(list) &&
    ts.isPropertyAccessExpression(list.expression) &&
    list.expression.name.text === "filter"
  ) {
    list = list.expression.expression
  }
  if (!ts.isArrayLiteralExpression(list)) return null
  const names = list.elements.map((element) =>
    ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)
      ? element.text
      : null,
  )
  return names.every((name) => name !== null) ? names : null
}

/** The keys of an `ids: { … }` literal (shorthand included); null for a spread or non-literal. */
function literalKeys(expr: ts.Expression): string[] | null {
  if (!ts.isObjectLiteralExpression(expr)) return null
  const keys = expr.properties.map(propertyName)
  return keys.every((key) => key !== null) ? keys : null
}

/**
 * Every hand-off / view-context spec (an object literal with `tools` and
 * `intent`/`summary`). Its `intent`/`summary` must be static text and no
 * part of it but `tools`/`toolIds` may name a tool: a tool travels through
 * `tools` only, where the live surface filters it.
 */
export function findHandOffSpecs(file: string, text: string): HandOffSpec[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const consts = constInitializers(source)
  const specs: HandOffSpec[] = []
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map(
        node.properties.flatMap((p) => {
          const name = propertyName(p)
          return name !== null && ts.isPropertyAssignment(p) ? [[name, p.initializer] as const] : []
        }),
      )
      const names = new Set(node.properties.map(propertyName))
      const kind = names.has("intent") ? "hand-off" : names.has("summary") ? "context" : null
      const tools = props.get("tools")
      if (kind && names.has("tools")) {
        const ids = props.get("ids")
        const toolIds = props.get("toolIds")
        const lead = props.get(kind === "hand-off" ? "intent" : "summary")
        const leadText = lead ? staticTextOf(lead, consts) : null
        specs.push({
          kind,
          at: `${file}:${lineOf(source, node)}`,
          tools: tools ? literalToolList(tools) : null,
          ids: ids ? literalKeys(ids) : names.has("ids") ? null : [],
          toolIds: toolIds ? literalToolIds(toolIds) : names.has("toolIds") ? null : {},
          staticText: leadText !== null,
          // The lead's resolved text covers a summary held in a const.
          namedOutsideTools: [
            ...new Set([
              ...(leadText ? toolNamesIn(leadText, TOOL_PREFIXES) : []),
              ...node.properties
                // `surface` only narrows the listed tools; it names nothing new.
                .filter((p) => !["tools", "toolIds", "surface"].includes(propertyName(p) ?? ""))
                .flatMap((p) => toolNamesUnder(p, TOOL_PREFIXES)),
            ]),
          ],
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specs
}

/** A top-level function's verdict: does every return hand back `modelContextText(…)`? */
export interface ContextFunction {
  name: string
  /** Repo-relative `file:line`. */
  at: string
  returnsModelContext: boolean
}

/** The values a function returns: an arrow's expression body, else its own `return`s. */
function returnedExpressions(fn: ts.SignatureDeclaration): ts.Expression[] {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body]
  const out: ts.Expression[] = []
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return // a nested function's returns are not ours
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression)
    ts.forEachChild(node, visit)
  }
  const body = (fn as ts.FunctionLikeDeclarationBase).body
  if (body) ts.forEachChild(body, visit)
  return out
}

const isModelContextCall = (expr: ts.Expression): boolean => {
  const inner = ts.isParenthesizedExpression(expr) ? expr.expression : expr
  return (
    ts.isCallExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    inner.expression.text === "modelContextText"
  )
}

function verdictOf(fn: ts.SignatureDeclaration): boolean {
  const returned = returnedExpressions(fn)
  return returned.length > 0 && returned.every(isModelContextCall)
}

/** Every top-level `const f = (…) => …` / `function f(…)` with its {@link ContextFunction} verdict. */
export function findContextFunctions(file: string, text: string): ContextFunction[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found: ContextFunction[] = []
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      found.push({
        name: statement.name.text,
        at: `${file}:${lineOf(source, statement)}`,
        returnsModelContext: verdictOf(statement),
      })
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        const init = decl.initializer
        if (!ts.isIdentifier(decl.name) || !init) continue
        if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue
        found.push({
          name: decl.name.text,
          at: `${file}:${lineOf(source, decl)}`,
          returnsModelContext: verdictOf(init),
        })
      }
    }
  }
  return found
}

export interface SourceRef {
  name: string
  /** Repo-relative `file:line`. */
  at: string
}

/**
 * Every identifier named `names` — calls, property accesses, imports and
 * destructurings alike (comments and strings are not identifiers).
 */
export function findIdentifiers(
  file: string,
  text: string,
  names: ReadonlySet<string>,
): SourceRef[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const refs: SourceRef[] = []
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && names.has(node.text)) {
      refs.push({ name: node.text, at: `${file}:${lineOf(source, node)}` })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return refs
}

/**
 * The value of every `<HostModelContext content={…}>`: the callee's name when
 * it is a call, else `null` (a literal, template or concatenation written in
 * place).
 */
export function findModelContextContents(
  file: string,
  text: string,
): Array<SourceRef & { callee: string | null }> {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found: Array<SourceRef & { callee: string | null }> = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "HostModelContext"
    ) {
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || attr.name.getText(source) !== "content") continue
        const expr =
          attr.initializer && ts.isJsxExpression(attr.initializer)
            ? attr.initializer.expression
            : undefined
        const callee =
          expr && ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)
            ? expr.expression.text
            : null
        found.push({ name: "content", at: `${file}:${lineOf(source, attr)}`, callee })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/**
 * Every `<module>_…` tool name inside a server-instructions text — a family
 * wildcard (`camunda7_show_*`) names no single tool and is skipped.
 */
export function toolNamesIn(text: string, prefixes: readonly string[]): string[] {
  const shape = new RegExp(
    `(?<![A-Za-z0-9_])(?:${prefixes.join("|")})_[a-z0-9_]*[a-z0-9](?![A-Za-z0-9_*])`,
    "g",
  )
  return [...new Set(text.match(shape) ?? [])]
}

/**
 * Tool names inside PROSE — a string or template text with whitespace in it,
 * i.e. something a model reads (a prompt, a description, a summary), never a
 * bare identifier like a feed constant.
 */
export function findProseToolNames(
  file: string,
  text: string,
  prefixes: readonly string[],
): SourceRef[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const refs: SourceRef[] = []
  const check = (node: ts.Node, prose: string) => {
    if (!/\s/.test(prose)) return
    for (const name of toolNamesIn(prose, prefixes)) {
      refs.push({ name, at: `${file}:${lineOf(source, node)}` })
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      check(node, node.text)
    } else if (ts.isTemplateExpression(node)) {
      check(
        node,
        [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" "),
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return refs
}
