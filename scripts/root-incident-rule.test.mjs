import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import ts from "typescript"
import { repoTextFiles } from "./check-package-scripts.mjs"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * Which Camunda 7 incident is a root incident has one home, c7-core's rule
 * (`packages/connectors/c7/c7-core/src/root-incident.ts`: `isRootIncident`, `rootIdOfCopy`), which
 * decides once how an incident without a `rootCauseIncidentId` reads: as a root. Its copies read
 * that case two ways (the composites behind `pulse status`, `pulse inspect`, `pulse retry` and
 * `engine_status` as a copy; the runtime, the engine connector's clusters and incident views and
 * the C7 adapter's retry as a root), so a count of root incidents could differ between two
 * surfaces. This guard reads every tracked code file that names the field and fails on an
 * equality comparison of an incident's id with its `rootCauseIncidentId` outside the home:
 * `incident.id === incident.rootCauseIncidentId`, `str(incident, "id") !== str(incident,
 * "rootCauseIncidentId")`, either side wrapped in a call, or held in a variable or a destructured
 * binding first (`const root = incident.rootCauseIncidentId`, then `root === incident.id`), each
 * name resolved in its own scope.
 */

const ROOT = "rootCauseIncidentId"
const ID = "id"

/**
 * Where a comparison may stand, each with its reason. An entry must hold one, so a copy routed
 * through the rule leaves no stale exemption behind.
 */
const ADMITTED = {
  "packages/connectors/c7/c7-core/src/root-incident.ts": "the rule's home",
  "apps/vscode/scripts/engine.mjs":
    "the VS Code extension's dev engine seed, a plain Node script that runs without a build, so " +
    "it cannot load c7-core's dist; it waits for the root incidents a real engine raised, which " +
    "always names the root",
  "apps/vscode/scripts/sandbox/seed.mjs":
    "the VS Code extension's sandbox seed, a plain Node script that runs without a build, so it " +
    "cannot load c7-core's dist; it counts the root incidents a real engine raised, which always " +
    "names the root",
}

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/

const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
])

/** `a ?? b` and `a || b` read as their left side, the value they stand for. */
const FALLBACKS = new Set([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken])

/** @param {string} file */
function scriptKindOf(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX
  return /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS
}

/** @param {ts.Node} node */
function isScope(node) {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isFunctionLike(node)
  )
}

/** @param {ts.Node} node */
function scopeOf(node) {
  let scope = node.parent
  while (scope !== undefined && !isScope(scope)) scope = scope.parent
  return scope
}

/**
 * Every name a file declares (a variable, a parameter, a destructured binding), each with the
 * scope it is visible in.
 * @param {ts.SourceFile} source
 */
function declarationsOf(source) {
  /** @type {Map<string, { declaration: ts.Node, scope: ts.Node }[]>} */
  const byName = new Map()
  const visit = (node) => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      ts.isIdentifier(node.name)
    ) {
      let owner = node
      while (ts.isBindingElement(owner) || ts.isObjectBindingPattern(owner)) owner = owner.parent
      const scope = ts.isParameter(owner) ? owner.parent : scopeOf(owner)
      const list = byName.get(node.name.text) ?? []
      list.push({ declaration: node, scope })
      byName.set(node.name.text, list)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return byName
}

/**
 * The declaration a name stands for where it is used: the one of the innermost scope around it.
 * @param {Map<string, { declaration: ts.Node, scope: ts.Node }[]>} declarations
 * @param {ts.Identifier} use
 */
function resolve(declarations, use) {
  const position = use.getStart()
  const around = (declarations.get(use.text) ?? []).filter(
    ({ scope }) => scope.pos <= position && position < scope.end,
  )
  around.sort(
    (left, right) => left.scope.end - left.scope.pos - (right.scope.end - right.scope.pos),
  )
  return around[0]?.declaration
}

/** @param {ts.Expression} node */
function unwrap(node) {
  let expression = node
  for (;;) {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isAwaitExpression(expression)
    ) {
      expression = expression.expression
    } else if (ts.isBinaryExpression(expression) && FALLBACKS.has(expression.operatorToken.kind)) {
      expression = expression.left
    } else {
      return expression
    }
  }
}

/** @param {ts.Node} node */
function propertyNameOf(node) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined
}

/**
 * Whether `node` stands for an incident's field `name`: the property itself, a call that reads it
 * (`str(incident, "id")`, `view.optionalString("rootCauseIncidentId")`, `idOf(incident.id)`) or a
 * name that holds one of these.
 * @param {ts.Expression} node
 * @param {string} name
 * @param {Map<string, { declaration: ts.Node, scope: ts.Node }[]>} declarations
 * @param {Set<ts.Node>} seen
 * @returns {boolean}
 */
function standsFor(node, name, declarations, seen = new Set()) {
  const expression = unwrap(node)
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === name
  if (ts.isElementAccessExpression(expression)) {
    return propertyNameOf(expression.argumentExpression) === name
  }
  if (ts.isCallExpression(expression)) {
    const callee = unwrap(expression.expression)
    return (
      expression.arguments.some(
        (argument) =>
          propertyNameOf(argument) === name || standsFor(argument, name, declarations, seen),
      ) ||
      (ts.isPropertyAccessExpression(callee) &&
        standsFor(callee.expression, name, declarations, seen))
    )
  }
  if (!ts.isIdentifier(expression)) return false
  if (expression.text === name) return true
  const declaration = resolve(declarations, expression)
  if (declaration === undefined || seen.has(declaration)) return false
  seen.add(declaration)
  if (ts.isBindingElement(declaration)) {
    return propertyNameOf(declaration.propertyName ?? declaration.name) === name
  }
  return (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    standsFor(declaration.initializer, name, declarations, seen)
  )
}

/**
 * The comparisons of an incident's id with its root incident's id in one file's code, as
 * `file:line: text`.
 * @param {string} file
 * @param {string} text
 */
function comparisonsIn(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file))
  const declarations = declarationsOf(source)
  const found = []
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind)) {
      const sides = [node.left, node.right]
      const [left, right] = sides.map((side) => ({
        root: standsFor(side, ROOT, declarations),
        id: standsFor(side, ID, declarations),
      }))
      if ((left.root && right.id) || (left.id && right.root)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line
        found.push(`${file}:${line + 1}: ${text.split("\n")[line].trim()}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/**
 * Every comparison outside ADMITTED, and every ADMITTED file of `files` that holds none.
 * @param {readonly { file: string, text: string }[]} files
 * @param {Readonly<Record<string, string>>} admitted
 */
function rawComparisons(files, admitted = ADMITTED) {
  return files
    .filter(({ file, text }) => CODE.test(file) && text.includes(ROOT))
    .flatMap(({ file, text }) => {
      const found = comparisonsIn(file, text)
      if (!Object.hasOwn(admitted, file)) return found
      return found.length > 0
        ? []
        : [`${file}: admitted (${admitted[file]}), but compares no incident's id with its root`]
    })
}

/** @param {string} text */
const hitsOf = (text, file = "packages/x/src/a.ts") => rawComparisons([{ file, text }])

describe("an incident's root is read by c7-core's rule alone", () => {
  for (const [form, text] of [
    ["two reads of the answer", `const r = (i) => str(i, "id") === str(i, "${ROOT}")`],
    ["two properties", `incidents.filter((i) => i.id === i.${ROOT}).length`],
    ["the root held first", `const root = i.${ROOT}\nreturn !root || root === i.id`],
    ["the root held first, unequal", `const rootId = i.${ROOT}\nreturn rootId && rootId !== i.id`],
    [
      "a checked view",
      `const rootId = v.optionalString("${ROOT}")\nif (rootId === undefined || rootId === v.requiredString("id")) {}`,
    ],
    ["a destructured binding", `const { id, ${ROOT}: root } = i\nif (root != id) go()`],
    ["element access", `if (i["${ROOT}"] == i["id"]) go()`],
    ["a wrapped side", `if (String(i.${ROOT}).trim() !== i?.id) go()`],
    ["a fallback", `if ((i.${ROOT} ?? "") === (i.id as string)) go()`],
    ["both sides held", `const a = i.${ROOT}\nconst b = idOf(i.id)\nreturn a === b`],
  ]) {
    it(`finds ${form}`, () => {
      assert.equal(hitsOf(`function f(i, v) {\n${text}\n}\n`).length, 1)
    })
  }

  for (const [form, text] of [
    [
      "the root incident's own id",
      `const root = byId.get(i.${ROOT})\nreturn root !== undefined && root.id === i.id`,
    ],
    ["a missing root", `return i.${ROOT} === undefined`],
    ["two incidents' ids", `return left.id === right.id`],
    [
      "a name of another scope",
      `function a(r) { const root = r.${ROOT}; return root }\nfunction b(r) { const root = r.parentId; return root === r.id }`,
    ],
    ["a comment", `// i.id === i.${ROOT}\nreturn 1`],
    ["a string", `return "i.id === i.${ROOT}"`],
    ["the rule", `return isRootIncident(i) || rootIdOfCopy(i) === undefined`],
  ]) {
    it(`leaves ${form} alone`, () => {
      assert.deepEqual(hitsOf(`function f(i, left, right) {\n${text}\n}\n`), [])
    })
  }

  it("names the file and the line of a hit", () => {
    const text = `const a = 1\n  const same = (i) =>   i.id === i.${ROOT}\n`
    assert.deepEqual(hitsOf(text, "apps/orca/src/x.mjs"), [
      `apps/orca/src/x.mjs:2: const same = (i) =>   i.id === i.${ROOT}`,
    ])
  })

  it("reads code files only", () => {
    assert.deepEqual(hitsOf(`i.id === i.${ROOT}`, "docs/x.md"), [])
  })

  it("admits a file it names, and fails on a name whose file compares nothing", () => {
    const admitted = { "a.ts": "the home", "b.ts": "gone" }
    const files = [
      { file: "a.ts", text: `const r = (i) => i.id === i.${ROOT}\n` },
      { file: "b.ts", text: `const r = (i) => isRootIncident(i) // ${ROOT}\n` },
    ]
    assert.deepEqual(rawComparisons(files, admitted), [
      "b.ts: admitted (gone), but compares no incident's id with its root",
    ])
  })

  for (const file of Object.keys(ADMITTED)) {
    it(`reads the comparison ${file} holds`, () => {
      const text = readFileSync(join(REPO_ROOT, file), "utf8")
      assert.notEqual(comparisonsIn(file, text).length, 0)
    })
  }

  it("no file of the tree compares an incident's id with its root outside the rule", () => {
    assert.deepEqual(rawComparisons(repoTextFiles(REPO_ROOT)), [])
  })
})
