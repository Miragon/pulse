import ts from "typescript"

/**
 * Parameter names a source text QUOTES for a tool it names (#329): the
 * Ask-AI / hand-off prompts, model-facing summaries and tool descriptions
 * tell the model which filters to pass, and a name the tool does not take
 * used to be stripped silently, turning a "filtered" answer engine-wide.
 *
 * Recognized quoting forms, directly after a `<module>_…` tool name:
 *   - an argument list: `tool(a=1, b="x")`, `tool({ a: 1, b })`,
 *     `tool (a 1)`, `` `tool` tool (a "x") ``: every top-level entry's
 *     leading identifier is a parameter (so prose in those parentheses is
 *     read as arguments too, so keep it out of them);
 *   - prose: `tool with a=…, b=…`, `tool for processDefinitionKey …`,
 *     `tool filtered by activityId …`: the identifier after the connector,
 *     when it is followed by `=`/`:` or is camelCase, plus every further
 *     `, name=` pair of a `name=value` run.
 *
 * String concatenations (`"…tool(" + "{ a: 1 })"`) are read as ONE text. An
 * interpolation is read as the text it adds where that text is known, so a
 * parameter cannot hide behind one: a same-file `const` holding a text, a
 * conditional fragment (`${x ? `, a: "${x}"` : ""}`: the text is read once
 * with every conditional's `true` side and once with its `false` side, so
 * each branch is checked in place), a call of a one-line text helper
 * (`engineArg(id)`). Anything else is a value placeholder, and an
 * argument-list entry that STARTS with one (its name is interpolated) is
 * reported as {@link OPAQUE_ARGUMENT}, which no tool takes: write the
 * parameter names literally instead.
 */

/**
 * @typedef {object} ParamRef
 * @property {string} tool
 * @property {string} param
 * @property {string} at repo-relative `file:line`
 */

/** @typedef {ReadonlyMap<string, import("typescript").Expression>} TextHelpers one-line text helpers by function name, e.g. `engineArg` → its return expression */

/** Reported for an argument-list entry whose NAME is an unresolvable interpolation. */
export const OPAQUE_ARGUMENT = "${…}"

const PLACEHOLDER = "\u0000"

/**
 * @typedef {object} FlattenContext
 * @property {import("typescript").Node[]} embedded expressions left as placeholders, scanned on their own
 * @property {ReadonlyMap<string, import("typescript").Expression>} consts same-file `const` text initializers, by name (names declared once only)
 * @property {TextHelpers} helpers
 * @property {Set<string>} resolving names being inlined right now (a self-referencing text stays a placeholder)
 * @property {"whenTrue" | "whenFalse"} branch the side every conditional is read with in this pass
 */

function isPlus(node) {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
}

function isStringish(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  )
}

/** A `+` chain that joins at least one string literal: a concatenated text. */
function isConcat(node) {
  if (!isPlus(node)) return false
  const hasText = (n) => isStringish(n) || (isPlus(n) && (hasText(n.left) || hasText(n.right)))
  return hasText(node)
}

/** The expression inside parentheses and `as`/`!` wrappers. */
function unwrap(node) {
  let inner = node
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isNonNullExpression(inner)
  ) {
    inner = inner.expression
  }
  return inner
}

/** A text the scanner can read: a string, a concatenation or a conditional with a text branch. */
function isTextual(node) {
  const expr = unwrap(node)
  if (isStringish(expr) || isConcat(expr)) return true
  return ts.isConditionalExpression(expr) && (isTextual(expr.whenTrue) || isTextual(expr.whenFalse))
}

/** The literal text of a string-ish node or concat; unknown interpolations become placeholders. */
function flatten(node, ctx) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce(
      (text, span) => text + interpolate(span.expression, ctx) + span.literal.text,
      node.head.text,
    )
  }
  if (isPlus(node)) return flatten(node.left, ctx) + flatten(node.right, ctx)
  return interpolate(node, ctx)
}

/** The text an embedded expression adds: resolved when known, else a placeholder. */
function interpolate(node, ctx) {
  const text = resolveText(unwrap(node), ctx)
  if (text !== null) return text
  ctx.embedded.push(node)
  return PLACEHOLDER
}

function resolveText(node, ctx) {
  if (isStringish(node) || isConcat(node)) return flatten(node, ctx)
  if (ts.isConditionalExpression(node)) {
    // This pass's side when it is a text, else the other side's text.
    const [side, otherSide] =
      ctx.branch === "whenTrue" ? [node.whenTrue, node.whenFalse] : [node.whenFalse, node.whenTrue]
    const [read, other] = isTextual(side) ? [side, otherSide] : [otherSide, side]
    if (!isTextual(read)) return null
    ctx.embedded.push(node.condition, other)
    return flatten(unwrap(read), ctx)
  }
  if (ts.isIdentifier(node))
    return inlineNamed(node.text, ctx.consts.get(node.text), ctx, ctx.consts)
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text
    // A helper's parameters are its own, never the caller's consts.
    return inlineNamed(name, ctx.helpers.get(name), ctx, new Map())
  }
  return null
}

function inlineNamed(name, target, ctx, consts) {
  if (!target || ctx.resolving.has(name)) return null
  ctx.resolving.add(name)
  try {
    // The text lives elsewhere (scanned there): its own interpolations are
    // not re-scanned, and its line breaks must not shift this text's lines.
    const inner = { ...ctx, embedded: [], consts }
    return flatten(unwrap(target), inner).replaceAll("\n", " ")
  } finally {
    ctx.resolving.delete(name)
  }
}

/** `const name = <text>` declarations of one file, for the names declared exactly once. */
function textConsts(source) {
  const found = new Map()
  const visit = (node) => {
    if (
      ts.isVariableDeclarationList(node) &&
      (node.flags & ts.NodeFlags.Const) !== 0 &&
      node.declarations.length > 0
    ) {
      for (const decl of node.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const name = decl.name.text
        const text = decl.initializer && isTextual(decl.initializer) ? decl.initializer : null
        found.set(name, found.has(name) ? null : text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return new Map([...found].filter((entry) => entry[1] !== null))
}

/**
 * The one-line text helpers a source file declares: top-level functions whose
 * whole body returns a text (`function engineArg(id) { return id ? … : "" }`).
 */
export function collectTextHelpers(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  return source.statements.flatMap((statement) => {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) return []
    const [only, ...rest] = statement.body.statements
    if (rest.length > 0 || !only || !ts.isReturnStatement(only) || !only.expression) return []
    return isTextual(only.expression) ? [[statement.name.text, only.expression]] : []
  })
}

const QUOTE_OPENS = /['"`]/

/** Content between the paren at `open` and its match; null when it never closes. */
function balanced(text, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    // An apostrophe inside a word ("instance's") is prose, not a quote.
    if (QUOTE_OPENS.test(ch) && !/[A-Za-z]/.test(text[i - 1] ?? "")) quote = ch
    else if (ch === "(") depth++
    else if (ch === ")" && --depth === 0) return text.slice(open + 1, i)
  }
  return null
}

/** Splits on top-level commas (outside brackets and quotes). */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let quote = null
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (QUOTE_OPENS.test(ch) && !/[A-Za-z]/.test(text[i - 1] ?? "")) quote = ch
    else if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch)) depth--
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** The leading parameter name of each entry of an argument list. */
export function argumentNames(list) {
  let body = list.trim()
  if (body.startsWith("{") && body.endsWith("}")) body = body.slice(1, -1)
  return splitTopLevel(body).flatMap((part) => {
    const raw = part.trim()
    if (raw === "") return []
    // The entry's NAME is interpolated: which parameters it sends is unknown.
    if (raw.startsWith(PLACEHOLDER)) return [OPAQUE_ARGUMENT]
    const entry = raw.replaceAll(PLACEHOLDER, " ").trim()
    const named = /^([A-Za-z_$][\w$]*)(?:\s*[:=]|\s|$)/.exec(entry)
    // A positional value or prose is still reported, as the name the model reads.
    return [named ? named[1] : entry.split(/\s+/)[0]]
  })
}

const CALL = /^`?(?:\s+tool)?\s*\(/

const PROSE =
  /^`?\s+(?:with|for|by|filtered (?:by|to|on)|filter (?:by|on))\s+([A-Za-z_][\w]*)(\s*[=:])?/

/** One more pair of a prose `name=value, name=value` run: the value, then the next name. */
const NEXT_PAIR = /^\s*(?:"[^"]*"|'[^']*'|[^\s,]+)\s*,\s*([A-Za-z_]\w*)\s*[=:]/

/** Every further `, name=` of a prose `name=value` run (`rest` = text after the first `=`). */
function followingPairs(rest) {
  const names = []
  for (let next = NEXT_PAIR.exec(rest); next; next = NEXT_PAIR.exec(rest)) {
    names.push(next[1])
    rest = rest.slice(next[0].length)
  }
  return names
}

/** The parameter names quoted right after a tool name (`rest` = the text after it). */
export function quotedParams(rest) {
  const call = CALL.exec(rest)
  if (call) {
    const list = balanced(rest, call[0].length - 1)
    return list === null ? [] : argumentNames(list)
  }
  const prose = PROSE.exec(rest)
  if (!prose) return []
  if (prose[2]) return [prose[1], ...followingPairs(rest.slice(prose[0].length))]
  return /[a-z][A-Z]/.test(prose[1]) ? [prose[1]] : []
}

/** Every (tool, quoted parameter) pair in the string texts of one source file. */
export function findParamRefs(file, text, prefixes, helpers = new Map()) {
  const toolName = new RegExp(
    `(?<![A-Za-z0-9_])(?:${prefixes.join("|")})_[a-z0-9_]+(?![A-Za-z0-9_])`,
    "g",
  )
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const consts = textConsts(source)
  const refs = []
  const scan = (node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart())
    const seen = new Set()
    const embedded = []
    for (const branch of ["whenTrue", "whenFalse"]) {
      // The second pass only re-reads conditionals; its leftovers are the first's.
      const pass = branch === "whenTrue" ? embedded : []
      const content = flatten(node, {
        embedded: pass,
        consts,
        helpers,
        resolving: new Set(),
        branch,
      })
      for (const match of content.matchAll(toolName)) {
        const at = `${file}:${line + 1 + content.slice(0, match.index).split("\n").length - 1}`
        for (const param of quotedParams(content.slice(match.index + match[0].length))) {
          const key = `${match[0]}.${param}@${at}`
          if (seen.has(key)) continue
          seen.add(key)
          refs.push({ tool: match[0], param, at })
        }
      }
    }
    embedded.forEach(visit)
  }
  const visit = (node) => {
    if (isConcat(node) || isStringish(node)) scan(node)
    else ts.forEachChild(node, visit)
  }
  visit(source)
  return refs
}
