import ts from "typescript"
import { metricVocabulary } from "./tool-surface.mjs"

/**
 * Source readers for the hand-off guard (#338). Every Ask-AI prompt and model
 * context is assembled by widget-shell's `askAiPrompt`/`modelContextText` from
 * a typed spec: an object literal with an `intent` (hand-off) or `summary`
 * (view context) next to its `ids`, `facts` and `untrusted` engine text. These
 * readers find those specs and every way around the primitive, so the guard
 * can hold them to static text that names no tool.
 */

/**
 * @typedef {object} HandOffSpec
 * @property {"hand-off" | "context"} kind
 * @property {string} at repo-relative `file:line`
 * @property {boolean} staticText whether the `intent`/`summary` is static text (literals, `+`, `?:`, same-file consts)
 * @property {string[]} namedTools every `<module>_…` tool name in the spec: its resolved lead or any member
 * @property {string[]} extraMembers members besides `intent`/`summary`, `ids`, `facts` and `untrusted` (a `tools` list, say)
 */

/**
 * A top-level function's verdict: does every return hand back `modelContextText(…)`?
 * @typedef {object} ContextFunction
 * @property {string} name
 * @property {string} at
 * @property {boolean} returnsModelContext
 */

/**
 * @typedef {object} SourceRef
 * @property {string} name
 * @property {string} at repo-relative `file:line`
 */

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart()).line + 1
}

/** `const NAME = <initializer>` declarations of a file, by name. */
function constInitializers(source) {
  const consts = new Map()
  const visit = (node) => {
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
 * The text of a STATIC expression (string literals joined by `+`, both arms
 * of a `?:` whatever the condition, a same-file `const` of such text), or
 * null when any part is data (an interpolation, a call, a prop).
 */
function staticTextOf(expr, consts) {
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

/** Every `<module>_…` tool name in the string literals and templates under `node`. */
function toolNamesUnder(node, prefixes) {
  const names = []
  const visit = (n) => {
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

const TOOL_PREFIXES = ["engine", "analytics"]

function propertyName(node) {
  if (!node.name) return null
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text
  return null
}

/** The members a spec is made of; any other member on an object with a lead is a finding. */
const SPEC_MEMBERS = new Set(["intent", "summary", "ids", "facts", "untrusted"])

/** The caller's own keys around a spec (`askAiPrompt({ ...handOff, intent, locale })`). */
const PLUMBING_MEMBERS = new Set(["locale", "isError"])

/** Members the hand-off API once had: an object with a lead that carries one is always a spec. */
const RETIRED_MEMBERS = new Set(["tools", "toolIds", "surface"])

/** A spread or a caller's key makes an object plumbing that passes a spec on, not a spec. */
function isPlumbing(node) {
  return node.properties.some((p) => {
    if (ts.isSpreadAssignment(p)) return true
    const name = propertyName(p)
    return name !== null && PLUMBING_MEMBERS.has(name)
  })
}

/** An object or array literal, directly or through a same-file const: data, never a lead's text. */
function isDataLiteral(expr, consts) {
  if (ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)) return true
  if (ts.isParenthesizedExpression(expr)) return isDataLiteral(expr.expression, consts)
  const initializer = ts.isIdentifier(expr) ? consts.get(expr.text) : undefined
  return initializer !== undefined && isDataLiteral(initializer, consts)
}

/** Text, static or not: a string or template literal, `+` or `?:` over one, a const of one. */
function isTextShaped(expr, consts) {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return true
  if (ts.isTemplateExpression(expr)) return true
  if (ts.isParenthesizedExpression(expr)) return isTextShaped(expr.expression, consts)
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isTextShaped(expr.left, consts) || isTextShaped(expr.right, consts)
  }
  if (ts.isConditionalExpression(expr)) {
    return isTextShaped(expr.whenTrue, consts) || isTextShaped(expr.whenFalse, consts)
  }
  const initializer = ts.isIdentifier(expr) ? consts.get(expr.text) : undefined
  return initializer !== undefined && isTextShaped(initializer, consts)
}

/**
 * Whether an object with a lead is a spec. A lead holding data (a nav intent's `{ type }`, a
 * view model's `summary: { … }`) is not one. A summary that is no text and stands without
 * `ids`/`facts`/`untrusted` is a data field too (`{ query, summary, … }`), unless the object
 * carries a retired member.
 */
function isSpec(kind, lead, members, extraMembers, consts) {
  if (isDataLiteral(lead, consts)) return false
  if (kind === "hand-off" || isTextShaped(lead, consts)) return true
  const parts = ["ids", "facts", "untrusted"].some((name) => members.has(name))
  return parts || extraMembers.some((name) => RETIRED_MEMBERS.has(name))
}

/** The value of a spec member: an assignment's initializer, a shorthand's own name. */
function memberValue(p) {
  if (ts.isPropertyAssignment(p)) return p.initializer
  if (ts.isShorthandPropertyAssignment(p)) return p.name
  return null
}

/**
 * Every hand-off / view-context spec: an object literal with an `intent`
 * (hand-off) or a `summary` (context) next to its `ids`, `facts` and
 * `untrusted`. Only a spread or a caller's key (`locale`, `isError`) makes it
 * plumbing (`{ ...handOff, intent, locale }`, `{ isError, summary }`); any
 * other member stays a spec and is reported (`extraMembers`), so a spec that
 * regains a `tools` list fails the guard instead of leaving it. Its
 * `intent`/`summary` must be static text, and no part of it may name a tool:
 * the instructions and the tool descriptions steer the model.
 */
export function findHandOffSpecs(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const consts = constInitializers(source)
  const specs = []
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node) && !isPlumbing(node)) {
      const members = new Map()
      const extraMembers = []
      for (const p of node.properties) {
        const name = propertyName(p)
        const value = memberValue(p)
        if (name !== null && value !== null && SPEC_MEMBERS.has(name)) members.set(name, value)
        else extraMembers.push(name ?? "<computed>")
      }
      const kind = members.has("intent") ? "hand-off" : members.has("summary") ? "context" : null
      const lead = kind && members.get(kind === "hand-off" ? "intent" : "summary")
      const leadText = lead ? staticTextOf(lead, consts) : null
      if (kind && lead && isSpec(kind, lead, members, extraMembers, consts)) {
        specs.push({
          kind,
          at: `${file}:${lineOf(source, node)}`,
          staticText: leadText !== null,
          // The lead's resolved text covers a summary held in a const.
          namedTools: [
            ...new Set([
              ...(leadText ? toolNamesIn(leadText, TOOL_PREFIXES) : []),
              ...node.properties.flatMap((p) => toolNamesUnder(p, TOOL_PREFIXES)),
            ]),
          ],
          extraMembers,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specs
}

/** The values a function returns: an arrow's expression body, else its own `return`s. */
function returnedExpressions(fn) {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body]
  const out = []
  const visit = (node) => {
    if (ts.isFunctionLike(node)) return // a nested function's returns are not ours
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression)
    ts.forEachChild(node, visit)
  }
  const body = fn.body
  if (body) ts.forEachChild(body, visit)
  return out
}

const isModelContextCall = (expr) => {
  const inner = ts.isParenthesizedExpression(expr) ? expr.expression : expr
  return (
    ts.isCallExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    inner.expression.text === "modelContextText"
  )
}

function verdictOf(fn) {
  const returned = returnedExpressions(fn)
  return returned.length > 0 && returned.every(isModelContextCall)
}

/** Every top-level `const f = (…) => …` / `function f(…)` with its {@link ContextFunction} verdict. */
export function findContextFunctions(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found = []
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

/**
 * Every identifier named `names`: calls, property accesses, imports and
 * destructurings alike (comments and strings are not identifiers).
 */
export function findIdentifiers(file, text, names) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const refs = []
  const visit = (node) => {
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
export function findModelContextContents(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found = []
  const visit = (node) => {
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

/** The contract's metric names and labels (`engine_id`, `engine_jobs_failed`): never a tool. */
const METRIC_VOCABULARY = metricVocabulary()

/**
 * Every `<module>_…` tool name inside a server-instructions text; a family
 * wildcard (`engine_query_historic_*`) names no single tool and is skipped, and
 * so is a metric name or label of the metrics contract, which shares the prefix.
 */
export function toolNamesIn(text, prefixes) {
  const shape = new RegExp(
    `(?<![A-Za-z0-9_])(?:${prefixes.join("|")})_[a-z0-9_]*[a-z0-9](?![A-Za-z0-9_*])`,
    "g",
  )
  return [...new Set(text.match(shape) ?? [])].filter((name) => !METRIC_VOCABULARY.has(name))
}

/**
 * Tool names inside PROSE: a string or template text with whitespace in it,
 * i.e. something a model reads (a prompt, a description, a summary), never a
 * bare identifier like a feed constant.
 */
export function findProseToolNames(file, text, prefixes) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const refs = []
  const check = (node, prose) => {
    if (!/\s/.test(prose)) return
    for (const name of toolNamesIn(prose, prefixes)) {
      refs.push({ name, at: `${file}:${lineOf(source, node)}` })
    }
  }
  const visit = (node) => {
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
