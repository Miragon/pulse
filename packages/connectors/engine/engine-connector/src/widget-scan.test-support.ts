import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

// The AST scan behind `widget-actions.test.ts` (#341). Outside `src/widgets`: it reads
// sources from disk and the widget tsconfig has no Node types.
const SRC_DIR = fileURLToPath(new URL("./", import.meta.url))
export const WIDGETS_DIR = join(SRC_DIR, "widgets")

/** How widget code can name a tool it calls. */
type Via = "action" | "mutation" | "callTool" | "read"

export interface ToolReference {
  file: string
  line: number
  via: Via
  /** The tool's name, or null when the expression is not a literal or a string constant. */
  name: string | null
}

export interface WidgetScan {
  references: ToolReference[]
  /** Files importing the view runtime's raw `useToolMutation`. */
  mutationImports: string[]
  /** Files calling the deployment gate directly. */
  canRunCalls: string[]
  /** Files obtaining the view host (`useViewHost()`), which holds a raw `callTool`. */
  callerHolders: Set<string>
  /** The first segment of every query key a read site uses. */
  keyRoots: Set<string>
}

function emptyScan(): WidgetScan {
  return {
    references: [],
    mutationImports: [],
    canRunCalls: [],
    callerHolders: new Set(),
    keyRoots: new Set(),
  }
}

/** A file's top-level `const NAME = "value"` declarations. */
function stringConstants(source: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer && ts.isStringLiteral(decl.initializer)) {
        constants.set(decl.name.text, decl.initializer.text)
      }
    }
  }
  return constants
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true)
}

function widgetFiles(): string[] {
  return readdirSync(WIDGETS_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test(-support)?\.tsx?$/.test(f))
    .map((f) => f.split("\\").join("/"))
}

/** Which positional argument of which call names the tool it calls. */
const POSITIONAL_TOOL_ARG = new Map<string, { via: Via; index: number }>([
  ["useToolMutation", { via: "mutation", index: 0 }],
  ["callTool", { via: "callTool", index: 0 }],
  ["useToolQuery", { via: "read", index: 1 }],
  ["useViewData", { via: "read", index: 2 }],
])

/** Which positional argument of which read hook is its query key. */
const KEY_ARG = new Map<string, number>([
  ["useToolQuery", 0],
  ["useViewData", 1],
])

/** Hooks handing out the view host, which holds one as `callTool`. */
const BRIDGE_HOOKS = new Set(["useViewHost"])

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

/** `expr` without parentheses and non-null assertions. */
function bare(expr: ts.Expression): ts.Expression {
  let inner = expr
  while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner)) {
    inner = inner.expression
  }
  return inner
}

function callsHook(expr: ts.Expression, hooks: ReadonlySet<string>): boolean {
  const inner = bare(expr)
  return ts.isCallExpression(inner) && hooks.has(calleeName(inner) ?? "")
}

function declarationsOf(source: ts.SourceFile): ts.VariableDeclaration[] {
  const found: ts.VariableDeclaration[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Every local name bound to a raw tool caller, aliases included. */
function rawCallers(source: ts.SourceFile): Set<string> {
  const callers = new Set<string>()
  const bridges = new Set<string>()
  const named = (expr: ts.Expression, names: Set<string>) => {
    const inner = bare(expr)
    return ts.isIdentifier(inner) && names.has(inner.text)
  }
  const isBridge = (expr: ts.Expression) => callsHook(expr, BRIDGE_HOOKS) || named(expr, bridges)
  const isCaller = (expr: ts.Expression) => {
    const inner = bare(expr)
    if (ts.isPropertyAccessExpression(inner)) return inner.name.text === "callTool"
    return named(inner, callers)
  }
  const bindingsOf = ({
    name,
    initializer,
  }: ts.VariableDeclaration): Array<[Set<string>, string]> => {
    if (!initializer) return []
    if (ts.isIdentifier(name)) {
      if (isCaller(initializer)) return [[callers, name.text]]
      return isBridge(initializer) ? [[bridges, name.text]] : []
    }
    if (!ts.isObjectBindingPattern(name) || !isBridge(initializer)) return []
    return name.elements
      .filter((e) => (e.propertyName ?? e.name).getText(source) === "callTool")
      .flatMap((e) =>
        ts.isIdentifier(e.name) ? [[callers, e.name.text] as [Set<string>, string]] : [],
      )
  }
  // To a fixed point: an alias may come before the binding it aliases is known.
  const declarations = declarationsOf(source)
  for (let grew = true; grew;) {
    grew = false
    for (const [names, name] of declarations.flatMap(bindingsOf)) {
      if (names.has(name)) continue
      names.add(name)
      grew = true
    }
  }
  return callers
}

/**
 * The call's positional tool argument. A call through a raw tool caller
 * (`rawCallers`) — or any other `*CallTool(…)` — counts as a raw call too.
 */
function positionalTool(
  call: ts.CallExpression,
  callers: ReadonlySet<string>,
): { via: Via; arg: ts.Expression } | null {
  const name = calleeName(call)
  if (name === null) return null
  const raw = (ts.isIdentifier(call.expression) && callers.has(name)) || /callTool$/i.test(name)
  const known =
    POSITIONAL_TOOL_ARG.get(name) ?? (raw ? { via: "callTool" as const, index: 0 } : null)
  const arg = known ? call.arguments[known.index] : undefined
  return known && arg ? { via: known.via, arg } : null
}

/** What a file-local function returns — a key helper such as `feedKey(scope)`. */
function returnedBy(source: ts.SourceFile, name: string): ts.Expression[] {
  const returned: ts.Expression[] = []
  const visit = (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression)
    if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit)
  }
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) {
      ts.forEachChild(statement.body, visit)
    }
  }
  return returned
}

/** Only read-hook keys: an array that merely lists namespaces (the write policy's) is not a query. */
function queryKeys(node: ts.Node, source: ts.SourceFile): ts.Expression[] {
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "key") {
    return [node.initializer]
  }
  if (!ts.isCallExpression(node)) return []
  const index = KEY_ARG.get(calleeName(node) ?? "")
  const arg = index === undefined ? undefined : node.arguments[index]
  if (!arg) return []
  const key = bare(arg)
  const helper = ts.isCallExpression(key) && ts.isIdentifier(key.expression)
  return helper ? returnedBy(source, key.expression.text) : [key]
}

/** The first segment of a query-key literal. */
function keyRoot(key: ts.Expression): string | null {
  const first = ts.isArrayLiteralExpression(key) ? key.elements[0] : undefined
  if (!first) return null
  return ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) ? first.text : null
}

/**
 * A `{ tool: … }` option — of `useEngineAction` (the write) or of a read
 * hook (`useDetailView`, `usePagedViewData`, …).
 */
function toolOption(node: ts.Node): { via: Via; arg: ts.Expression } | null {
  if (!ts.isPropertyAssignment(node) || !ts.isIdentifier(node.name)) return null
  if (node.name.text !== "tool") return null
  const call = node.parent.parent
  const action = ts.isCallExpression(call) && calleeName(call) === "useEngineAction"
  return { via: action ? "action" : "read", arg: node.initializer }
}

function importsRawMutation(node: ts.Node): boolean {
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return false
  if (node.moduleSpecifier.text !== "@miragon/pulse-widget-shell/widgets") return false
  const bindings = node.importClause?.namedBindings
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.some((e) => (e.propertyName ?? e.name).text === "useToolMutation")
  )
}

function scanSource(
  file: string,
  source: ts.SourceFile,
  toolNames: Map<string, string>,
  scan: WidgetScan,
): void {
  // How widgets name tools: the tool-names.ts constants, or a constant of their own file.
  const constants = new Map([...toolNames, ...stringConstants(source)])
  const nameOf = (expr: ts.Expression): string | null => {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text
    return ts.isIdentifier(expr) ? (constants.get(expr.text) ?? null) : null
  }
  const record = (at: ts.Node, ref: { via: Via; arg: ts.Expression }) => {
    const { line } = source.getLineAndCharacterOfPosition(at.getStart(source))
    scan.references.push({ file, line: line + 1, via: ref.via, name: nameOf(ref.arg) })
  }
  const callers = rawCallers(source)
  const visit = (node: ts.Node) => {
    if (importsRawMutation(node)) scan.mutationImports.push(file)
    if (ts.isCallExpression(node)) {
      if (calleeName(node) === "useCanRun") scan.canRunCalls.push(file)
      if (callsHook(node, BRIDGE_HOOKS)) {
        scan.callerHolders.add(file)
      }
      const ref = positionalTool(node, callers)
      if (ref) record(node, ref)
    }
    const option = toolOption(node)
    if (option) record(node, option)
    for (const root of queryKeys(node, source).map(keyRoot)) {
      if (root !== null) scan.keyRoots.add(root)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const toolNameConstants = () => stringConstants(parse(join(SRC_DIR, "tool-names.ts")))

export function scanWidgets(): WidgetScan {
  const toolNames = toolNameConstants()
  const scan = emptyScan()
  for (const file of widgetFiles()) {
    scanSource(file, parse(join(WIDGETS_DIR, file)), toolNames, scan)
  }
  return scan
}

/** The scan of ONE source text — the guard's own self-tests. */
export function scanText(file: string, text: string): WidgetScan {
  const scan = emptyScan()
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  scanSource(file, source, toolNameConstants(), scan)
  return scan
}
