import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "node:test"
import ts from "typescript"
import { TEST_FILE } from "./pack-contents.mjs"
import { REPO_ROOT } from "./source-scan.mjs"
import { isNpmPublished, isPublishedLibrary, readWorkspace } from "./workspace-packages.mjs"

/**
 * Every published entry holds its list of exports. knip never reports what an entry file exports
 * (includeEntryExports is off in knip.jsonc), yet an entry's names are a promise to every
 * consumer: a name added is new API, a name dropped a breaking change, and either is decided in
 * review. So a test of the package holds each entry's sorted runtime names (types are erased at
 * runtime), and this guard holds every JS entry of every published workspace package (not
 * private, no VS Code extension: workspace-packages.mjs) to such a test, so that no entry, a new
 * one included, goes without its list.
 *
 * An entry is an exports subpath (the `main` of a package without an exports map; none without
 * either: the CLI publishes a bin). Its targets are the values of every condition but `types`
 * (a fallback array read whole, `null` none), and each is a JS target unless it names a
 * declaration file, a stylesheet or a JSON file (./package.json, the profile's schema): a target
 * of any other kind, one without an extension included, counts as JS, so it fails until a test
 * holds it. A pattern subpath with a JS target (`"./*": "./dist/*"`) fails: it makes every file
 * it matches an entry, which no list holds.
 *
 * The guard reads the tests and runs none (pnpm test runs them). A JS target is held when a test
 * file vitest runs in its package (by the `test.include` and `test.exclude` of the package's
 * vitest.config.ts, lists of string literals; a config the guard cannot read fails):
 *
 * 1. imports the target's source as a namespace by its path, `import * as x from "./index.js"`
 *    (the package's own name would read the built dist). The source is the target with dist/
 *    read as src/ and .js as .ts or .tsx (.mjs as .mts, .cjs as .cts): ./dist/testing/index.js
 *    is src/testing/index.ts; a target under src/ is its own. The file binds `x` nowhere else,
 *    mocks no module it reads as a namespace (vi.mock, vi.doMock; one whose path the guard
 *    cannot read counts as every module) and binds `it`, `test`, `describe`, `expect` and
 *    `Object` only by an import from vitest;
 * 2. compares that namespace's names with an exact list, `expect(Object.keys(x).sort())` (the
 *    `.sort()` optional) `.toEqual(list)` or `.toStrictEqual(list)`, as a statement of a test's
 *    own callback (or its arrow body) with no return, throw or `.skip()` before it there. The
 *    test is a plain `it` or `test` at the top level or in plain `describe`s: no modifier (skip,
 *    each, skipIf, …), a name before the callback (vitest reads a test without one as todo),
 *    every other argument a timeout or options that set no skip, todo or fails. The list is an array literal of strings (`.sort()` after it
 *    allowed) or, for a list too long for its test's line budget, a constant the same file reads
 *    from a JSON array of strings, `const LIST = JSON.parse(readFileSync(new
 *    URL("./test-support/list.json", import.meta.url), "utf8"))`, which stands where
 *    pack-contents.mjs knows test files and keeps them out of the tarball (its TEST_FILE: a
 *    test-support/ folder or a `*.test-support.json`).
 *
 * It checks the form, not what runs: a mock of a module the entry re-exports, an `.only` beside
 * the test, a setup file or a plugin that changes a module passes it, and review holds those.
 * Its planted violations below prove the guard.
 */

/** A module by its extension: JS and TS, JSX and TSX. */
const MODULE = /\.(?:[cm]?[jt]s|[jt]sx)$/
/** A target that is no module: a declaration file, a stylesheet or a JSON file. */
const NO_MODULE = /(?:\.d\.[cm]?ts|\.css|\.json)$/
/** The source extensions tsc builds each JS extension from. */
const BUILT_FROM = { ".js": [".ts", ".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] }
/** The runners a held list runs under: a test, in suites. */
const TESTS = new Set(["it", "test"])
const SUITES = new Set(["describe"])
/** The test options under which a test or suite does not run, or runs inverted. */
const NOT_RUN = new Set(["skip", "todo", "fails"])
/** The names a held list reads, which the file binds only by an import from vitest. */
const RUNNER_NAMES = ["Object", "describe", "expect", "it", "test"]
/** The declarations that bind a name. */
const DECLARATIONS = [
  ts.isVariableDeclaration,
  ts.isParameter,
  ts.isBindingElement,
  ts.isFunctionDeclaration,
  ts.isFunctionExpression,
  ts.isClassDeclaration,
  ts.isClassExpression,
  ts.isEnumDeclaration,
  ts.isImportSpecifier,
  ts.isImportClause,
  ts.isNamespaceImport,
  ts.isImportEqualsDeclaration,
]

/** The import targets of an exports value: every condition but `types`, fallbacks whole. */
function targetsOf(value) {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(targetsOf)
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([condition, nested]) =>
    condition === "types" ? [] : targetsOf(nested),
  )
}

/** Each `{ subpath, targets }` a manifest exports; its main without an exports map. */
function exportsOf({ exports, main }) {
  if (exports === undefined) return main ? [{ subpath: ".", targets: [main] }] : []
  const subpaths =
    typeof exports === "object" && exports !== null && !Array.isArray(exports)
      ? Object.keys(exports)
      : []
  if (!subpaths.some((key) => key.startsWith("."))) {
    return [{ subpath: ".", targets: targetsOf(exports) }]
  }
  return subpaths.map((subpath) => ({ subpath, targets: targetsOf(exports[subpath]) }))
}

/**
 * Every JS entry of the published workspace packages at `root`, as `{ dir, name, specifier,
 * subpath, targets }`: its distinct JS targets, `dir` relative to `root`.
 */
function publishedEntries(root) {
  return readWorkspace(root)
    .filter(({ manifest }) => isNpmPublished(manifest))
    .flatMap(({ dir, manifest }) =>
      exportsOf(manifest)
        .map(({ subpath, targets }) => ({
          dir,
          name: manifest.name,
          specifier: `${manifest.name}${subpath.slice(1)}`,
          subpath,
          targets: [...new Set(targets.filter((target) => !NO_MODULE.test(target)))],
        }))
        .filter(({ targets }) => targets.length > 0),
    )
}

const isFile = (file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true

/**
 * The source of a JS target, relative to its package, or undefined if none is on disk: a target
 * under src/ is its own, a dist/ one is read under src/ with the extension tsc builds it from.
 */
function sourceOf(packageDir, target) {
  const rel = path.posix.normalize(target)
  const ext = path.posix.extname(rel)
  const built = rel.startsWith("dist/") ? (BUILT_FROM[ext] ?? []) : []
  const candidates = rel.startsWith("src/")
    ? [rel]
    : built.map((source) => `src/${rel.slice("dist/".length, -ext.length)}${source}`)
  return candidates.find((candidate) => isFile(path.join(packageDir, candidate)))
}

/** A member's static name: an identifier or a string literal key, else undefined. */
const keyOf = (member) =>
  member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
    ? member.name.text
    : undefined

/**
 * The `test.include` (null when absent) and `test.exclude` of a vitest config, or `{ problem }`
 * when the guard cannot read them: one `test` block, an object literal of plain members, each
 * list an array of string literals, and no other member that changes which files run.
 */
function vitestLists(file) {
  if (!isFile(file)) return { problem: "is missing" }
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  )
  const blocks = []
  let computed = false
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && keyOf(node) === "test") blocks.push(node.initializer)
    computed ||= ts.isComputedPropertyName(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (computed) return { problem: "has a computed key, which could be its test block" }
  if (blocks.length !== 1 || !ts.isObjectLiteralExpression(blocks[0])) {
    return { problem: "has no one test block that is an object literal" }
  }
  const lists = { include: null, exclude: [] }
  for (const member of blocks[0].properties) {
    const key = ts.isPropertyAssignment(member) ? keyOf(member) : undefined
    if (key === undefined) return { problem: `reads test's ${member.getText()} from elsewhere` }
    if (key === "projects" || key === "dir") return { problem: `sets test.${key}` }
    if (key !== "include" && key !== "exclude") continue
    const list = member.initializer
    if (!ts.isArrayLiteralExpression(list) || !list.elements.every(ts.isStringLiteralLike)) {
      return { problem: `has a test.${key} that is no array of string literals` }
    }
    lists[key] = list.elements.map((element) => element.text.replace(/^\.\//, ""))
  }
  return lists
}

/** The files under `dir` as posix paths relative to it, without node_modules and dot folders. */
function filesUnder(dir, rel = "") {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((entry) => {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name.startsWith(".")
        ? []
        : filesUnder(dir, child)
    }
    return entry.isFile() ? [child] : []
  })
}

/**
 * The test files vitest runs in the package at `dir` (absolute), by its vitest.config.ts, and a
 * problem when the guard cannot read which.
 */
function testFiles(root, dir) {
  const config = `${dir}/vitest.config.ts`
  const lists = vitestLists(path.join(root, config))
  const problem = lists.problem ?? (lists.include === null ? "names no test.include" : undefined)
  if (problem !== undefined) {
    return {
      files: [],
      problem: `${config} ${problem}: the guard reads which tests run from its test.include and test.exclude, lists of string literals`,
    }
  }
  const matches = (file, globs) => globs.some((glob) => path.matchesGlob(file, glob))
  return {
    files: filesUnder(path.join(root, dir))
      .filter((file) => MODULE.test(file) && matches(file, lists.include))
      .filter((file) => !matches(file, lists.exclude))
      .map((file) => path.join(root, dir, file)),
  }
}

/** A module's path without its extension: an import names `./index.js`, the source is index.ts. */
const moduleKey = (file) => file.replace(MODULE, "")

/** `x.sort()` as `x`, anything else as itself. */
const unsorted = (node) =>
  ts.isCallExpression(node) &&
  node.arguments.length === 0 &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === "sort"
    ? node.expression.expression
    : node

/** The namespace `Object.keys(x)` (or its sort) reads, or undefined. */
function keysOf(node) {
  const call = unsorted(node)
  const callee = ts.isCallExpression(call) ? call.expression : undefined
  const isKeys =
    callee !== undefined &&
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Object" &&
    callee.name.text === "keys" &&
    call.arguments.length === 1 &&
    ts.isIdentifier(call.arguments[0])
  return isKeys ? call.arguments[0].text : undefined
}

/** The relative path of `JSON.parse(readFileSync(new URL("<path>", import.meta.url), …))`. */
function jsonListPath(initializer) {
  let node = initializer
  while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))) {
    node = node.expression
  }
  const isCall = (call, name) =>
    call !== undefined && ts.isCallExpression(call) && call.expression.getText() === name
  if (!isCall(node, "JSON.parse") || !isCall(node.arguments[0], "readFileSync")) return undefined
  const url = node.arguments[0].arguments[0]
  const isUrl =
    url !== undefined &&
    ts.isNewExpression(url) &&
    url.expression.getText() === "URL" &&
    url.arguments?.length === 2 &&
    ts.isStringLiteralLike(url.arguments[0]) &&
    url.arguments[1].getText() === "import.meta.url"
  return isUrl ? url.arguments[0].text : undefined
}

/**
 * Where `node` runs: `{ callback, statement }` when it is a statement of a function's body (or
 * the arrow body itself), `{ statement }` at the top level, undefined anywhere else (inside an
 * if, a loop, a variable's initializer).
 */
function placeOf(node) {
  if (ts.isArrowFunction(node.parent) && node.parent.body === node) {
    return { callback: node.parent, statement: node }
  }
  const statement = node.parent
  if (!ts.isExpressionStatement(statement)) return undefined
  if (ts.isSourceFile(statement.parent)) return { statement }
  const callback = ts.isBlock(statement.parent) ? statement.parent.parent : undefined
  const isCallback =
    callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
  return isCallback ? { callback, statement } : undefined
}

/** Whether a return, a throw or a `.skip()` of `callback`'s own body comes before `statement`. */
function stopsBefore(callback, statement) {
  if (callback.body === statement) return false
  let stops = false
  const visit = (node) => {
    if (stops || node.pos >= statement.pos || ts.isFunctionLike(node)) return
    stops =
      ts.isReturnStatement(node) ||
      ts.isThrowStatement(node) ||
      (ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "skip")
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(callback.body, visit)
  return stops
}

/** Whether an argument of a runner beside its name and callback lets it run. */
const letsRun = (arg) =>
  ts.isNumericLiteral(arg) ||
  (ts.isObjectLiteralExpression(arg) &&
    arg.properties.every((member) => {
      const key = ts.isPropertyAssignment(member) ? keyOf(member) : undefined
      if (key === undefined) return false
      return !NOT_RUN.has(key) || member.initializer.kind === ts.SyntaxKind.FalseKeyword
    }))

/** Whether `call` is a plain runner of `names` that runs `callback`, an argument after its name. */
function isRunner(call, names, callback) {
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return false
  const at = call.arguments.indexOf(callback)
  return (
    names.has(call.expression.text) &&
    at >= 1 &&
    call.arguments.every((arg, index) => index === 0 || index === at || letsRun(arg))
  )
}

/** Whether `assertion` runs: in a test's own callback, the test in plain suites up to the top. */
function runs(assertion) {
  let place = placeOf(assertion)
  let names = TESTS
  while (place?.callback !== undefined) {
    const { callback, statement } = place
    if (stopsBefore(callback, statement) || !isRunner(callback.parent, names, callback)) {
      return false
    }
    names = SUITES
    place = placeOf(callback.parent)
  }
  return place !== undefined && names === SUITES
}

/** Every name the file binds, with the declarations that bind it. */
function bindingsOf(source) {
  const bindings = new Map()
  const visit = (node) => {
    const declaration = node.parent
    if (
      ts.isIdentifier(node) &&
      declaration?.name === node &&
      DECLARATIONS.some((is) => is(declaration))
    ) {
      bindings.set(node.text, [...(bindings.get(node.text) ?? []), declaration])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return bindings
}

/** `import { it } from "vitest"`: the name vitest exports, unrenamed. */
const fromVitest = (declaration) =>
  ts.isImportSpecifier(declaration) &&
  declaration.propertyName === undefined &&
  declaration.parent.parent.parent.moduleSpecifier.text === "vitest"

/**
 * The module keys the file mocks (vi.mock, vi.doMock), by path as its imports are read, "*" for
 * a path it cannot read.
 */
function mockedKeys(source, here) {
  const keys = new Set()
  const visit = (node) => {
    if (ts.isCallExpression(node) && ["vi.mock", "vi.doMock"].includes(node.expression.getText())) {
      let spec = node.arguments[0]
      if (
        spec &&
        ts.isCallExpression(spec) &&
        spec.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        spec = spec.arguments[0]
      }
      if (spec === undefined || !ts.isStringLiteralLike(spec)) keys.add("*")
      else keys.add(moduleKey(path.resolve(here, spec.text)))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return keys
}

/**
 * What one test file holds: the module keys (see moduleKey) whose namespace it compares with an
 * exact list, and a problem for each JSON list that is no array of strings or stands elsewhere.
 */
function listsOf(root, file) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  )
  const here = path.dirname(file)
  const bindings = bindingsOf(source)
  const mocked = mockedKeys(source, here)
  const namespaces = new Map()
  const jsonLists = new Map()
  for (const statement of source.statements) {
    const imported = ts.isImportDeclaration(statement) && statement.importClause?.namedBindings
    if (
      imported &&
      ts.isNamespaceImport(imported) &&
      !statement.importClause.isTypeOnly &&
      bindings.get(imported.name.text).length === 1
    ) {
      const key = moduleKey(path.resolve(here, statement.moduleSpecifier.text))
      if (!mocked.has(key) && !mocked.has("*")) namespaces.set(imported.name.text, key)
    }
    for (const declaration of ts.isVariableStatement(statement)
      ? statement.declarationList.declarations
      : []) {
      const json = jsonListPath(declaration.initializer)
      if (json !== undefined && ts.isIdentifier(declaration.name)) {
        jsonLists.set(declaration.name.text, path.resolve(here, json))
      }
    }
  }
  const held = new Set()
  const problems = []
  if (!RUNNER_NAMES.every((name) => (bindings.get(name) ?? []).every(fromVitest))) {
    return { held, problems }
  }
  const exactList = (node) => {
    const list = unsorted(node)
    if (ts.isArrayLiteralExpression(list)) return list.elements.every(ts.isStringLiteralLike)
    const json = ts.isIdentifier(list) ? jsonLists.get(list.text) : undefined
    if (json === undefined) return false
    const problem = jsonListProblem(root, json)
    if (problem !== undefined) problems.push(`${path.relative(root, file)}: ${problem}`)
    return problem === undefined
  }
  const visit = (node) => {
    const matcher = ts.isCallExpression(node) ? node.expression : undefined
    const subject =
      matcher !== undefined && ts.isPropertyAccessExpression(matcher)
        ? matcher.expression
        : undefined
    if (
      subject !== undefined &&
      ["toEqual", "toStrictEqual"].includes(matcher.name.text) &&
      node.arguments.length === 1 &&
      ts.isCallExpression(subject) &&
      subject.expression.getText() === "expect" &&
      subject.arguments.length > 0
    ) {
      const namespace = namespaces.get(keysOf(subject.arguments[0]))
      if (namespace !== undefined && runs(node) && exactList(node.arguments[0])) {
        held.add(namespace)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { held, problems }
}

/** Why a JSON list file does not hold a list, or undefined if it does. */
function jsonListProblem(root, file) {
  const rel = path.relative(root, file).split(path.sep).join("/")
  if (!TEST_FILE.test(rel)) {
    return `${rel} stands outside a test-support/ folder or a *.test-support.json, where pack-contents.mjs knows test files and keeps them out of the tarball`
  }
  let list
  try {
    list = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return `${rel} is missing or no JSON`
  }
  const isList = Array.isArray(list) && list.every((name) => typeof name === "string")
  return isList ? undefined : `${rel} is no JSON array of strings`
}

/** One line per JS target no test holds the list of, and per problem with a config or a list. */
function entryFindings(root) {
  const findings = []
  const tests = new Map()
  const heldIn = (dir) => {
    if (!tests.has(dir)) {
      const { files, problem } = testFiles(root, dir)
      if (problem !== undefined) findings.push(problem)
      const lists = files.map((file) => listsOf(root, file))
      findings.push(...lists.flatMap(({ problems }) => problems))
      tests.set(dir, new Set(lists.flatMap(({ held }) => [...held])))
    }
    return tests.get(dir)
  }
  for (const { dir, specifier, subpath, targets } of publishedEntries(root)) {
    if (subpath.includes("*")) {
      findings.push(`${specifier}: a pattern entry makes every file it matches an entry; name each`)
      continue
    }
    for (const target of targets) {
      const source = sourceOf(path.join(root, dir), target)
      if (source === undefined) {
        findings.push(
          `${specifier}: no source for its target ${target}: the guard reads ./dist/<x>.js as src/<x>.ts or .tsx (.mjs as .mts, .cjs as .cts) and a target under src/ as itself`,
        )
      } else if (!heldIn(dir).has(moduleKey(path.join(root, dir, source)))) {
        findings.push(
          `${specifier}: no test vitest runs in ${dir} holds the list of ${source}: import it as a namespace x and assert expect(Object.keys(x).sort()).toEqual([…the sorted names]) in an it or test`,
        )
      }
    }
  }
  return [...new Set(findings)].sort()
}

describe("every published entry of the tree holds its list of exports", () => {
  it("reads entries of every published library", () => {
    const read = new Set(publishedEntries(REPO_ROOT).map(({ name }) => name))
    const libraries = readWorkspace(REPO_ROOT)
      .filter(isPublishedLibrary)
      .map(({ manifest }) => manifest.name)
    assert.ok(libraries.length > 0, "no published library read: is the workspace still there?")
    assert.deepEqual(
      libraries.filter((name) => !read.has(name)),
      [],
    )
  })

  it("reads which tests run from each package's own config: the shared one names none", () => {
    // mergeConfig joins the lists of vitest.shared.ts with each package's.
    assert.deepEqual(vitestLists(path.join(REPO_ROOT, "vitest.shared.ts")), {
      include: null,
      exclude: [],
    })
  })

  it("finds a test of its package that holds the list of each entry", () => {
    assert.deepEqual(entryFindings(REPO_ROOT), [])
  })
})

describe("the guard on planted packages", () => {
  const roots = []
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  /** A temp repo from a { relPath: text } map; an undefined text leaves the file out. */
  function fixture(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "entry-lists-"))
    roots.push(root)
    for (const [rel, text] of Object.entries(files)) {
      if (text === undefined) continue
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      fs.writeFileSync(path.join(root, rel), text)
    }
    return root
  }

  const json = (value) => JSON.stringify(value)
  const KIT = "packages/kit"
  const EXPORTS = {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./testing": { types: "./dist/testing/index.d.ts", import: "./dist/testing/index.js" },
    "./widgets": "./src/widgets/index.ts",
    "./theme.css": "./src/theme.css",
    "./themes/*.css": "./src/themes/*.css",
    "./internal/*": null,
    "./types": { types: "./src/types.ts" },
    "./schema/kit.schema.json": "./schema/kit.schema.json",
    "./package.json": "./package.json",
  }
  const CONFIG = `${KIT}/vitest.config.ts`
  /** A vitest config whose test block is `test`. */
  const config = (test) => `export default mergeConfig(shared, defineConfig({ test: ${test} }))\n`
  const INCLUDE = 'include: ["src/**/*.test.{ts,tsx}", "./test/**/*.test.ts"]'
  const ROOT_TEST = `${KIT}/src/index.test.ts`
  /** The root's list, which the planted tests below weaken or misplace. */
  const LIST = '  expect(Object.keys(kit).sort()).toEqual(["a", "b"])'
  const IMPORTS = 'import * as kit from "./index.js"'
  /** The root's test: `body` as its one test's body, in the suites `wrap` adds. */
  const rootTest = (body, { imports = IMPORTS, wrap = (test) => test } = {}) =>
    [
      imports,
      'import { describe, expect, it, vi } from "vitest"',
      wrap(['it("lists", () => {', body, "})"].join("\n")),
    ].join("\n")
  /** `test` in a suite of `describe` (and its arguments). */
  const suite =
    (describe, args = "") =>
    (test) =>
      `${describe}("x", ${args}() => {\n${test}\n})`
  const LAYOUT = {
    "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  - "packages/*"\n',
    [`${KIT}/package.json`]: json({ name: "@x/kit", exports: EXPORTS }),
    [CONFIG]: config(`{ ${INCLUDE}, exclude: ["src/**/*.skip.test.ts"], coverage: {} }`),
    [`${KIT}/src/index.ts`]: "export const b = 1\nexport const a = 2\n",
    [ROOT_TEST]: rootTest(LIST),
    [`${KIT}/src/testing/index.ts`]: "export const fake = 1\n",
    [`${KIT}/test/entries.test.ts`]: [
      'import { readFileSync } from "node:fs"',
      'import * as testing from "../src/testing/index.js"',
      "const NAMES = JSON.parse(",
      '  readFileSync(new URL("./test-support/testing.json", import.meta.url), "utf8"),',
      ") as string[]",
      'test("lists", () => expect(Object.keys(testing).sort()).toStrictEqual(NAMES))',
    ].join("\n"),
    [`${KIT}/test/test-support/testing.json`]: json(["fake"]),
    [`${KIT}/src/widgets/index.ts`]: "export const views = {}\n",
    [`${KIT}/src/widgets/index.test.tsx`]: [
      'import * as widgets from "./index.js"',
      'describe("the entry", () => {',
      '  it("lists", () => expect(Object.keys(widgets)).toEqual(["views"].sort()))',
      "})",
    ].join("\n"),
    [`${KIT}/src/theme.css`]: ":root {}\n",
    "packages/secret/package.json": json({ name: "@x/secret", private: true, main: "./a.js" }),
    "apps/extension/package.json": json({
      name: "ext",
      engines: { vscode: "^1.101.0" },
      main: "./a.js",
    }),
    "apps/cli/package.json": json({ name: "@x/cli", bin: { x: "dist/x.js" } }),
  }
  const NO_TEST = /^@x\/kit: no test vitest runs in packages\/kit holds the list of src\/index\.ts/
  /** The findings of a fixture, each cut before its advice. */
  const findingsOf = (files) =>
    entryFindings(fixture({ ...LAYOUT, ...files })).map((line) =>
      line.replace(/: (?:import it as|the guard reads) .*$/, ""),
    )

  it("holds every JS entry and reads no other", () => {
    const root = fixture(LAYOUT)
    assert.deepEqual(
      publishedEntries(root).map(({ specifier }) => specifier),
      ["@x/kit", "@x/kit/testing", "@x/kit/widgets"],
    )
    assert.deepEqual(entryFindings(root), [])
  })

  it("fails an entry without a test, even one another package holds", () => {
    assert.deepEqual(
      findingsOf({
        [`${KIT}/src/widgets/index.test.tsx`]: undefined,
        "packages/other/package.json": json({ name: "@x/other", private: true }),
        "packages/other/src/kit.test.ts": [
          'import * as widgets from "../../kit/src/widgets/index.js"',
          'it("lists", () => expect(Object.keys(widgets).sort()).toEqual(["views"]))',
        ].join("\n"),
      }),
      [
        "@x/kit/widgets: no test vitest runs in packages/kit holds the list of src/widgets/index.ts",
      ],
    )
  })

  for (const [what, test] of [
    ["names one by one", rootTest('  expect(kit).toHaveProperty("a")')],
    ["a subset", rootTest('  expect(Object.keys(kit)).toEqual(expect.arrayContaining(["a"]))')],
    ["one member", rootTest('  expect(Object.keys(kit).sort()).toContain("a")')],
    ["the list in another matcher", rootTest(LIST.replace("toEqual", "toContain"))],
    ["the list inverted", rootTest(LIST.replace("toEqual", "not.toEqual"))],
    ["a list with a spread", rootTest('  expect(Object.keys(kit).sort()).toEqual([...more, "b"])')],
    ["the count", rootTest("  expect(Object.keys(kit)).toHaveLength(2)")],
    ["the list in a comment", rootTest(`  // ${LIST.trimStart()}`)],
    ["the values", rootTest(LIST.replace("Object.keys", "Object.values"))],
    ["the list in a check that is no expect", rootTest(LIST.replace("expect(", "check("))],
    ["the list of the built package", rootTest(LIST, { imports: 'import * as kit from "@x/kit"' })],
    [
      "the list of a type-only import",
      rootTest(LIST, { imports: IMPORTS.replace("import", "import type") }),
    ],
    ["the list of another module", rootTest(LIST, { imports: 'import * as kit from "./x.js"' })],
    ["the list in a skipped test", rootTest(LIST).replace("it(", "it.skip(")],
    ["the list in a failing test", rootTest(LIST).replace("it(", "it.fails(")],
    ["the list in a test of an empty table", rootTest(LIST).replace("it(", "it.each([])(")],
    [
      "the list in a test its options skip",
      rootTest(LIST).replace("() =>", "{ skip: true }, () =>"),
    ],
    [
      "the list in a suite its options mark todo",
      rootTest(LIST, { wrap: suite("describe", "{ todo: true }, ") }),
    ],
    [
      "the list in a conditional suite",
      rootTest(LIST, { wrap: suite("describe.skipIf(process.env.CI)") }),
    ],
    ["the list in a suite of an empty table", rootTest(LIST, { wrap: suite("describe.each([])") })],
    ["the list behind an if", rootTest(`  if (process.env.CI) ${LIST.trimStart()}`)],
    ["the list after a return", rootTest(`  return\n${LIST}`)],
    ["the list after a throw", rootTest(`  throw new Error("later")\n${LIST}`)],
    [
      "the list after the test skips itself",
      rootTest(`  ctx.skip()\n${LIST}`).replace("() =>", "(ctx) =>"),
    ],
    ["the list in a helper no test calls", rootTest(`  const never = () => ${LIST.trimStart()}`)],
    ["the list in a suite's own body", rootTest(LIST).replace("it(", "describe(")],
    [
      "the list in a test without a name, which vitest reads as todo",
      rootTest(LIST).replace('it("lists", ', "it("),
    ],
    [
      "the list in a test registered on a condition",
      rootTest(LIST, { wrap: (test) => `process.env.CI || ${test}` }),
    ],
    [
      "the list outside a test",
      `${IMPORTS}\nimport { expect } from "vitest"\n${LIST.trimStart()}\n`,
    ],
    [
      "the list of a local name over the namespace",
      rootTest(`  const kit = { a: 1, b: 2 }\n${LIST}`),
    ],
    [
      "the list of a mocked source",
      `${rootTest(LIST)}\nvi.mock("./index.js", () => ({ a: 1, b: 2 }))`,
    ],
    ["the list of a source a mock may hit", `${rootTest(LIST)}\nvi.doMock(PATH, () => ({}))`],
    [
      "the list under a runner of its own",
      rootTest(LIST, {
        imports: `${IMPORTS}\nconst it = (_: string, _f: () => void) => undefined`,
      }),
    ],
  ]) {
    it(`fails a test that imports the entry but holds ${what}, not its exact list`, () => {
      const [only, ...rest] = entryFindings(fixture({ ...LAYOUT, [ROOT_TEST]: test }))
      assert.match(only, NO_TEST)
      assert.deepEqual(rest, [])
    })
  }

  for (const [what, test] of [
    ["in a plain suite", rootTest(LIST, { wrap: suite("describe") })],
    [
      "in a suite and a test whose options skip nothing",
      rootTest(LIST, { wrap: suite("describe", "{ skip: false }, ") }).replace(
        'it("lists", ',
        'it("lists", { retry: 1, fails: false }, ',
      ),
    ],
    [
      "in a function with a timeout",
      rootTest(LIST).replace("() =>", "function ()").replace(/\}\)$/, "}, 5_000)"),
    ],
    [
      "after a function that returns and before a return",
      rootTest(`  const names = () => {\n    return ["a", "b"]\n  }\n${LIST}\n  return`),
    ],
  ]) {
    it(`holds the list ${what}`, () => {
      assert.deepEqual(entryFindings(fixture({ ...LAYOUT, [ROOT_TEST]: test })), [])
    })
  }

  for (const [what, files] of [
    [
      "in a .test.js, which its include does not name",
      { [`${KIT}/src/index.test.js`]: rootTest(LIST) },
    ],
    [
      "in a folder its include does not name",
      {
        [`${KIT}/scripts/index.test.ts`]: rootTest(LIST, {
          imports: 'import * as kit from "../src/index.js"',
        }),
      },
    ],
    ["in a file its exclude names", { [`${KIT}/src/index.skip.test.ts`]: rootTest(LIST) }],
  ]) {
    it(`fails a list ${what}`, () => {
      assert.deepEqual(findingsOf({ [ROOT_TEST]: undefined, ...files }), [
        "@x/kit: no test vitest runs in packages/kit holds the list of src/index.ts",
      ])
    })
  }

  for (const [what, text, problem] of [
    ["missing", undefined, "is missing"],
    ["without an include", config("{ coverage: {} }"), "names no test.include"],
    [
      "with an include from elsewhere",
      config("{ include: INCLUDE }"),
      "has a test.include that is no array of string literals",
    ],
    [
      "with an include entry from elsewhere",
      config("{ include: [...INCLUDES] }"),
      "has a test.include that is no array of string literals",
    ],
    [
      "with a spread in its test block",
      config(`{ ...base, ${INCLUDE} }`),
      "reads test's ...base from elsewhere",
    ],
    ["with projects", config(`{ ${INCLUDE}, projects: [] }`), "sets test.projects"],
    [
      "with two test blocks",
      `${config(`{ ${INCLUDE} }`)}export const other = { test: {} }\n`,
      "has no one test block that is an object literal",
    ],
    [
      "with a computed key",
      config(`{ ${INCLUDE}, [KEY]: [] }`),
      "has a computed key, which could be its test block",
    ],
  ]) {
    it(`fails a package whose vitest config is ${what}, and each of its entries`, () => {
      assert.deepEqual(findingsOf({ [CONFIG]: text }), [
        "@x/kit/testing: no test vitest runs in packages/kit holds the list of src/testing/index.ts",
        "@x/kit/widgets: no test vitest runs in packages/kit holds the list of src/widgets/index.ts",
        "@x/kit: no test vitest runs in packages/kit holds the list of src/index.ts",
        `${CONFIG} ${problem}`,
      ])
    })
  }

  it("fails an entry added to the exports map until a test holds the list of each target", () => {
    const grown = (exports, files = {}) =>
      findingsOf({
        [`${KIT}/package.json`]: json({ name: "@x/kit", exports: { ...EXPORTS, ...exports } }),
        [`${KIT}/src/extra.ts`]: "export const extra = 1\n",
        [`${KIT}/src/browser.ts`]: "export const browser = 1\n",
        ...files,
      })
    const EXTRA_TEST = {
      [`${KIT}/src/extra.test.ts`]: [
        'import * as extra from "./extra.js"',
        'it("lists", () => {\n  expect(Object.keys(extra)).toEqual(["extra"])\n})',
      ].join("\n"),
    }
    assert.deepEqual(grown({ "./extra": { import: "./dist/extra.js" } }), [
      "@x/kit/extra: no test vitest runs in packages/kit holds the list of src/extra.ts",
    ])
    assert.deepEqual(grown({ "./extra": "./dist/extra.js" }, EXTRA_TEST), [])
    assert.deepEqual(
      grown({ "./extra": { node: "./dist/extra.js", browser: "./dist/browser.js" } }, EXTRA_TEST),
      ["@x/kit/extra: no test vitest runs in packages/kit holds the list of src/browser.ts"],
    )
    assert.deepEqual(
      grown({ "./extra": { require: "./dist/extra.cjs", import: "./dist/extra.js" } }, EXTRA_TEST),
      ["@x/kit/extra: no source for its target ./dist/extra.cjs"],
    )
    const LEGACY = {
      [`${KIT}/src/legacy.cts`]: "export const legacy = 1\n",
      [`${KIT}/src/legacy.test.ts`]: [
        'import * as legacy from "./legacy.cjs"',
        'it("lists", () => expect(Object.keys(legacy)).toEqual(["legacy"]))',
      ].join("\n"),
    }
    assert.deepEqual(grown({ "./legacy": { require: "./dist/legacy.cjs" } }, LEGACY), [])
    assert.deepEqual(grown({ "./gone": "./dist/gone.js" }), [
      "@x/kit/gone: no source for its target ./dist/gone.js",
    ])
    assert.deepEqual(grown({ "./bare": "./dist/extra" }), [
      "@x/kit/bare: no source for its target ./dist/extra",
    ])
    for (const pattern of [
      { "./*": "./dist/*.js" },
      { "./*": "./dist/*" },
      { "./*": { types: "./dist/*.d.ts", import: "./dist/*" } },
    ]) {
      assert.deepEqual(grown(pattern), [
        "@x/kit/*: a pattern entry makes every file it matches an entry; name each",
      ])
    }
  })

  it("reads the main of a package without an exports map", () => {
    assert.deepEqual(
      findingsOf({
        "packages/plain/package.json": json({ name: "@x/plain", main: "dist/index.js" }),
        "packages/plain/vitest.config.ts": config(`{ ${INCLUDE} }`),
        "packages/plain/src/index.ts": "export const plain = 1\n",
      }),
      ["@x/plain: no test vitest runs in packages/plain holds the list of src/index.ts"],
    )
  })

  for (const [what, list, text, problem] of [
    [
      "outside test-support",
      "testing.json",
      json(["fake"]),
      "stands outside a test-support/ folder or a *.test-support.json, where pack-contents.mjs knows test files and keeps them out of the tarball",
    ],
    [
      "no list of strings",
      "test-support/names.json",
      json({ fake: 1 }),
      "is no JSON array of strings",
    ],
    ["missing", "test-support/gone.json", undefined, "is missing or no JSON"],
  ]) {
    it(`fails a JSON list that is ${what}`, () => {
      const test = `${KIT}/test/entries.test.ts`
      assert.deepEqual(
        findingsOf({
          [`${KIT}/test/${list}`]: text,
          [test]: LAYOUT[test].replace("./test-support/testing.json", `./${list}`),
        }),
        [
          "@x/kit/testing: no test vitest runs in packages/kit holds the list of src/testing/index.ts",
          `${test}: ${KIT}/test/${list} ${problem}`,
        ],
      )
    })
  }
})
