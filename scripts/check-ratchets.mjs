#!/usr/bin/env node
/**
 * Ratchet self-protection — ported from mcp-toolkit's scripts/check-ratchets.mjs
 * (FITNESS.md phase 2b) and adapted to where this repo keeps its ratchets.
 *
 * The fastest way to turn a red gate green is to loosen the gate in the same
 * diff — a rule-shaped edit nobody reads as a regression. This check compares
 * every ratchet against the MERGE BASE of the target branch (never against
 * the PR's own files) and fails on any move in the forbidden direction:
 *
 *   <pkg>/vitest.config.ts          coverage thresholds raise-only, never removed:
 *   vitest.shared.ts                the global metrics AND every glob key's
 *                                   metrics (vitest's `100` shorthand expanded;
 *                                   a removed or renamed glob fails, since a
 *                                   glob that matches no file passes vacuously;
 *                                   a new glob only adds, because vitest 4
 *                                   still holds every file to the global
 *                                   floors); `perFile` never switched off; a
 *                                   count floor (-N) never traded for a
 *                                   percentage below 100; vitest.shared.ts
 *                                   carries no floors at all (mergeConfig lets
 *                                   a package key override them unseen);
 *                                   coverage `exclude` and test `exclude`
 *                                   shrink-only; coverage `include` and test
 *                                   `include` grow-only (a coverage `include`
 *                                   never appears: without one vitest measures
 *                                   every loaded file); `enabled` never
 *                                   switched off (incl. a package that stops
 *                                   merging sharedConfig); inline
 *                                   `test.projects` keyed by their literal
 *                                   name: none removed, each one's `include`
 *                                   grow-only and `exclude` shrink-only, its
 *                                   `extends` pinned, the list never appearing
 *                                   or disappearing; the one coverage block is
 *                                   the root `test.coverage` (vitest reads no
 *                                   other); every shape the AST cannot read (a
 *                                   spread, shorthand, accessor, computed key
 *                                   or non-literal value) frozen. A config the
 *                                   ratchet cannot read on the base is held to
 *                                   the rules of an introduced one, and one it
 *                                   cannot read on either side fails. An
 *                                   INTRODUCED <pkg>/vitest.config.ts is not
 *                                   free: it must be readable, measure (merge
 *                                   sharedConfig or set coverage.enabled: true)
 *                                   and carry all four global floors
 *   <pkg>/stryker.config.json       thresholds.break raise-only; `mutate`
 *                                   grow-only (an entry may leave only when
 *                                   break rises in the same diff, or when it
 *                                   names a file that no longer exists);
 *                                   mutator.excludedMutations shrink-only;
 *                                   every other option that decides which
 *                                   mutants exist or how they count pinned
 *   eslint.config.mjs               complexityRatchet / maxLinesRatchet
 *                                   shrink-only (no new entry, no raised value);
 *                                   the global complexity / max-lines budgets
 *                                   never raised or removed; no new override
 *                                   of either rule; no gate rule newly "off" or
 *                                   "warn"; `ignores` shrink-only per block
 *                                   scope; every shape the AST cannot read (a
 *                                   non-literal `rules`, a spread, a local
 *                                   import, Object.entries(…)) frozen — PLUS
 *                                   the effective config ESLint itself computes
 *                                   per source file, base vs working tree
 *                                   (scripts/eslint-effective-config.mjs)
 *   knip.jsonc                      every ignore list, the issue-type `exclude`,
 *                                   non-"error" `rules` and `entry` globs
 *                                   shrink-only; `include`/`project` never
 *                                   appear or shrink; never deleted
 *   apps/<app>/test/__golden__/char-budgets.json
 *                                   model-visible tool-surface budgets
 *                                   shrink-only, never removed
 *   apps/<app>/test/__golden__/bundle-budget.json
 *                                   widget-bundle gzip ceilings shrink-only,
 *                                   never removed
 *   package.json (root)             no gate drops out of `lint`/`test`, and the
 *                                   chains only gain plain `pnpm <script>`
 *                                   gates; every chained gate script and the
 *                                   gates CI runs directly are pinned (only an
 *                                   `--exclude` list may shrink); no `knip` key
 *   <pkg>/package.json              lint / typecheck / test / test:mutation pinned
 *   every workspace package.json    no `prettier` key (root, apps, packages,
 *                                   docs; also in a package.json the diff
 *                                   introduces): prettier reads it before any
 *                                   .prettierrc in the same directory
 *   shadowing configs               an eslint.config.* besides the root .mjs, a
 *                                   knip config besides knip.jsonc, a Stryker
 *                                   config besides stryker.config.json: each
 *                                   tool would load it INSTEAD of the ratchet.
 *                                   A vitest.config.{mts,cts,js,mjs,cjs} in a
 *                                   package (dead next to vitest.config.ts,
 *                                   loaded unratcheted without it). Any
 *                                   prettier config (.prettierrc*,
 *                                   prettier.config.*, package.yaml) besides
 *                                   the root .prettierrc.json and any
 *                                   .editorconfig besides the root one, in
 *                                   every directory (docs/, templates/,
 *                                   scripts/ as much as apps/ and packages/):
 *                                   prettier and editorconfig resolve the
 *                                   NEAREST config, so a nested one keeps a
 *                                   foreign style; per-directory style goes
 *                                   into the root .prettierrc.json
 *                                   `overrides`. Each fails whenever it exists
 *   inline suppressions             `eslint-disable` of a gate rule (or of every
 *                                   rule), inline gate-rule config, `v8|c8|
 *                                   istanbul ignore`, `Stryker disable` in
 *                                   apps/ and packages/ sources: shrink-only
 *
 * The SINGLE documented escape is a commit trailer in the branch range:
 *
 *   Ratchet-Exception: <reason>
 *
 * which downgrades the failures to loud warnings (CODEOWNERS review still
 * applies to every PR). There is no other bypass.
 *
 * Run: node scripts/check-ratchets.mjs [baseRef]   (`pnpm lint:ratchets`;
 * default origin/main. In CI the base is ALWAYS origin/$GITHUB_BASE_REF — a
 * positional ref is ignored there, and a pull request whose merge base is
 * HEAD fails instead of comparing the branch with itself; CI needs
 * fetch-depth: 0). The working tree is the "new" side, so uncommitted
 * loosening fails locally too.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const EXCEPTION_TRAILER = /^Ratchet-Exception: .+/m

const PKG = String.raw`(?:apps/[^/]+|packages/core/[^/]+|packages/connectors/[^/]+/[^/]+)`

/** The default message: the tool resolves the shadow first, the ratchet keeps reading `replaces`. */
const loadedInstead = (replaces) => (relPath) =>
  `${relPath} would be loaded INSTEAD of ${replaces} — the tool resolves it first, while this check (and mutation-diff.mjs) keep reading the ratcheted file, so every threshold, ignore list and gate in it could be swapped out unseen. Edit ${replaces} instead.`

/**
 * A directory prefix anywhere below the repo root that is not inside an
 * installed dependency: prettier and editorconfig resolve the nearest config
 * from every file `prettier --check .` reads, docs/ and templates/ included.
 */
const NESTED = String.raw`(?!(?:.*/)?node_modules/)(?:.+/)`
/** prettier's config file names besides package.json (the manifest check covers its key). */
const PRETTIER_CONFIG = String.raw`(?:package\.yaml|\.prettierrc(?:\.\w+)?|prettier\.config\.[cm]?[jt]s)`

// Config files a tool loads BEFORE (or instead of) the ratcheted one:
// ESLint resolves the nearest eslint.config.{js,mjs,cjs,ts,mts,cts} upward
// from each linted file (.js first); knip tries knip.json, knip.jsonc,
// .knip.json(c), knip.{ts,js}, knip.config.{ts,js} in the root; Stryker tries
// {,.}stryker.{conf,config}.{json,js,mjs,cjs} in the package dir, .conf first.
// vitest (4.1.11, CONFIG_NAMES x CONFIG_EXTENSIONS) tries vitest.config.{ts,
// mts,cts,js,mjs,cjs} in the package dir and loads the first it finds.
// prettier walks up from each file and takes the NEAREST directory that has a
// package.json with a `prettier` key, a package.yaml with one, .prettierrc,
// .prettierrc.json, .prettierrc.{yml,yaml,json5,js,ts,mjs,mts,cjs,cts,toml}
// or prettier.config.{js,ts,mjs,mts,cjs,cts}; it reads the nearest
// .editorconfig for every option the prettier config leaves open.
const SHADOW_CONFIGS = [
  {
    pattern: /^(?:(?:apps|packages)\/.+\/)?eslint\.config\.(?:[cm]?js|[cm]?ts)$/,
    message: loadedInstead("eslint.config.mjs"),
  },
  {
    pattern: /^\.?knip(?:\.config)?\.(?:jsonc?|[cm]?js|[cm]?ts)$/,
    message: loadedInstead("knip.jsonc"),
  },
  {
    pattern: new RegExp(`^${PKG}/\\.?stryker\\.(?:conf|config)\\.(?:json|[cm]?js)$`),
    message: loadedInstead("the package's stryker.config.json"),
  },
  {
    pattern: new RegExp(`^${PKG}/vitest\\.config\\.(?:mts|cts|[cm]?js)$`),
    message: (relPath) =>
      `${relPath} is a second vitest config next to the package's vitest.config.ts. vitest tries vitest.config.{ts,mts,cts,js,mjs,cjs} in that order and loads the first it finds: next to vitest.config.ts this file is dead code that reads like the config, and without vitest.config.ts vitest loads it with no ratchet reading its thresholds. Keep the package's config in vitest.config.ts and delete this file.`,
  },
  {
    // Any root prettier config but .prettierrc.json (package.yaml and
    // .prettierrc come BEFORE it, the others take over once it is gone), and
    // any prettier config in a directory below the root.
    pattern: new RegExp(
      `^(?!\\.prettierrc\\.json$)${PRETTIER_CONFIG}$|^${NESTED}${PRETTIER_CONFIG}$`,
    ),
    message: (relPath) =>
      `${relPath} is a prettier config of its own. prettier takes the NEAREST config walking up from each file, so every file below it would be formatted, and pass format:check, in a style the root .prettierrc.json does not set (\`requirePragma: true\` even skips every file without a pragma). Per-directory style goes into the root .prettierrc.json \`overrides\` (\`"files": ["apps/<app>/**"]\`); delete this file.`,
  },
  {
    pattern: new RegExp(`^${NESTED}\\.editorconfig$`),
    message: (relPath) =>
      `${relPath} overrides the root .editorconfig below it. prettier reads the nearest .editorconfig for every option .prettierrc.json leaves open (indentation, tab width, line endings), so format:check would accept a foreign style there. Add a section such as \`[apps/<app>/**]\` or \`[docs/**]\` to the root .editorconfig instead and delete this file.`,
  },
]

/** Which ratchet a repo-relative path carries, or null when it carries none. */
export function ratchetKind(relPath) {
  if (relPath === "vitest.shared.ts" || new RegExp(`^${PKG}/vitest\\.config\\.ts$`).test(relPath))
    return "vitest"
  if (new RegExp(`^${PKG}/stryker\\.config\\.json$`).test(relPath)) return "stryker"
  if (relPath === "eslint.config.mjs") return "eslint"
  if (relPath === "knip.jsonc") return "knip"
  if (SHADOW_CONFIGS.some(({ pattern }) => pattern.test(relPath))) return "shadow-config"
  if (/^apps\/[^/]+\/test\/__golden__\/char-budgets\.json$/.test(relPath)) return "char-budgets"
  if (/^apps\/[^/]+\/test\/__golden__\/bundle-budget\.json$/.test(relPath)) return "bundle-budget"
  if (relPath === "package.json") return "root-scripts"
  if (new RegExp(`^${PKG}/package\\.json$`).test(relPath)) return "package-scripts"
  // The docs workspace pins no gate script; only its `prettier` key is checked.
  if (relPath === "docs/package.json") return "workspace-manifest"
  return null
}

/** The ratchet kinds of a workspace package.json: each must carry no `prettier` key. */
const MANIFEST_KINDS = new Set(["root-scripts", "package-scripts", "workspace-manifest"])

// ── Source extraction (TypeScript AST — no evaluation, no imports) ──────────

/** Whitespace- and trailing-comma-insensitive source text: prettier-stable keys. */
const normalize = (text) => text.replace(/\s+/g, "").replace(/,([\]}])/g, "$1")

function scriptKind(relPath) {
  if (relPath.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (/\.[cm]?ts$/.test(relPath)) return ts.ScriptKind.TS
  if (relPath.endsWith(".jsx")) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

function parseSource(relPath, text) {
  return ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, scriptKind(relPath))
}

function propName(name) {
  if (
    name &&
    (ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isNoSubstitutionTemplateLiteral(name))
  )
    return name.text
  return undefined
}

/**
 * A key's static text, also for a computed key whose expression is a literal
 * (`["src/**"]: ...` is the same key to vitest), or undefined.
 */
function staticName(name) {
  if (name && ts.isComputedPropertyName(name)) {
    const value = literalValue(name.expression)
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined
  }
  return propName(name)
}

/** The last `name: value` member of an object literal (JS keeps the last duplicate). */
const lastProperty = (object, name) =>
  object.properties.findLast((p) => ts.isPropertyAssignment(p) && staticName(p.name) === name)

/** A property's static name — also for `{ name }` shorthand — or undefined. */
const memberName = (prop) =>
  ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)
    ? propName(prop.name)
    : undefined

function walk(node, visit) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

/** A literal's value: number (incl. negative), string or boolean; undefined otherwise. */
function literalValue(node) {
  if (!node) return undefined
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}

/**
 * Array-literal elements as comparable strings: literal values, else
 * normalized source. `consts` (name → array-literal node) resolves an
 * identifier or `...identifier` to the top-level array it names, so moving a
 * list into a constant is not read as new entries.
 */
function arrayEntries(node, consts = new Map(), depth = 0) {
  if (ts.isIdentifier(node) && consts.has(node.text) && depth < 8)
    return arrayEntries(consts.get(node.text), consts, depth + 1)
  if (!ts.isArrayLiteralExpression(node)) return null
  return node.elements.flatMap((element) => {
    if (ts.isSpreadElement(element) && depth < 8) {
      const spread = arrayEntries(element.expression, consts, depth + 1)
      if (spread) return spread
    }
    const value = literalValue(element)
    return [typeof value === "string" ? value : normalize(element.getText())]
  })
}

/** Top-level `const name = [ … ]` declarations of a source file. */
function topLevelArrays(sourceFile) {
  const consts = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer)
        if (ts.isArrayLiteralExpression(decl.initializer))
          consts.set(decl.name.text, decl.initializer)
    }
  }
  return consts
}

const COVERAGE_METRICS = ["statements", "branches", "functions", "lines"]

/** Entries of an `include`/`exclude` list: literal strings, else normalized source. */
const listEntries = (node) => arrayEntries(node) ?? [normalize(node.getText())]

/**
 * The floors of one thresholds object, the global one or a glob's, as
 * metric -> number. vitest's `100` shorthand is expanded the way vitest
 * expands it: any truthy literal at the top level (where it overrides the
 * explicit metrics), exactly `true` inside a glob (resolveGlobThresholds).
 * A member it cannot read (a spread, a shorthand, a method or accessor, a
 * metric or `100` whose value is no literal, a metric whose literal is no
 * number) lands in `opaque`: a spread written after the literals overrides
 * them at runtime, so reading around it would miss a loosening. Other keys
 * are the caller's (options, globs) or, inside a glob, ignored by vitest.
 */
function thresholdFloors(object, where, opaque, isGlob) {
  const floors = {}
  let hundred = false
  for (const member of object.properties) {
    const key = ts.isPropertyAssignment(member) ? staticName(member.name) : undefined
    if (key === undefined) {
      // A non-literal computed key is already opaque (extractVitestCoverage).
      if (!ts.isPropertyAssignment(member)) opaque.push(`${where}: ${normalize(member.getText())}`)
      continue
    }
    if (key !== "100" && !COVERAGE_METRICS.includes(key)) continue
    const value = literalValue(member.initializer)
    if (key === "100") {
      hundred = value === undefined ? false : isGlob ? value === true : Boolean(value)
      if (value === undefined)
        opaque.push(`${where}.100: ${normalize(member.initializer.getText())}`)
    } else if (typeof value === "number") {
      floors[key] = value
    } else {
      delete floors[key]
      opaque.push(`${where}.${key}: ${normalize(member.initializer.getText())}`)
    }
  }
  if (hundred) for (const metric of COVERAGE_METRICS) floors[metric] = 100
  return floors
}

/**
 * `coverage.thresholds`: the global floors, every glob key's floors (vitest
 * reads each key that is not a metric, `100`, `perFile` or `autoUpdate` as a
 * glob, and still holds EVERY file to the global floors, so a glob only adds)
 * and `perFile` (it applies to the global and every glob set). `autoUpdate`
 * stays free: it only ever writes RAISED floors into this file. A typo such
 * as `line: 90` is a glob to vitest too, one with no floors: opaque here.
 */
function readThresholds(node, opaque) {
  const read = { thresholds: {}, globThresholds: {}, perFile: undefined }
  if (!ts.isObjectLiteralExpression(node)) {
    opaque.push(`thresholds: ${normalize(node.getText())}`)
    return read
  }
  read.thresholds = thresholdFloors(node, "thresholds", opaque, false)
  for (const member of node.properties) {
    const key = ts.isPropertyAssignment(member) ? staticName(member.name) : undefined
    if (key === undefined || key === "100" || key === "autoUpdate") continue
    if (COVERAGE_METRICS.includes(key)) continue
    if (key === "perFile") {
      const value = literalValue(member.initializer)
      read.perFile = value === undefined ? undefined : Boolean(value)
      if (value === undefined)
        opaque.push(`thresholds.perFile: ${normalize(member.initializer.getText())}`)
      continue
    }
    const where = `thresholds[${JSON.stringify(key)}]`
    // `__proto__: {...}` sets the prototype, not a key.
    if (ts.isObjectLiteralExpression(member.initializer) && key !== "__proto__") {
      read.globThresholds[key] = thresholdFloors(member.initializer, where, opaque, true)
    } else {
      delete read.globThresholds[key]
      opaque.push(`${where}: ${normalize(member.initializer.getText())}`)
    }
  }
  return read
}

/**
 * Whether a `test` property is an inline project's: a direct member of an
 * object literal listed in a `projects` array (`projects: [{ test: {...} }]`).
 */
function isProjectTest(prop) {
  const element = prop.parent
  const list = element?.parent
  const owner = list?.parent
  return (
    ts.isObjectLiteralExpression(element) &&
    ts.isArrayLiteralExpression(list) &&
    ts.isPropertyAssignment(owner) &&
    staticName(owner.name) === "projects"
  )
}

/** Whether `node` sits inside an inline project's `test` block. */
function insideProjectTest(node) {
  for (let up = node.parent; up; up = up.parent)
    if (ts.isPropertyAssignment(up) && staticName(up.name) === "test" && isProjectTest(up))
      return true
  return false
}

/** An inline project's literal name: `name: "unit"` or `name: { label: "unit" }`. */
function projectName(test) {
  const prop = lastProperty(test, "name")
  if (!prop) return undefined
  const named = ts.isObjectLiteralExpression(prop.initializer)
    ? lastProperty(prop.initializer, "label")?.initializer
    : prop.initializer
  const value = literalValue(named)
  return typeof value === "string" ? value : undefined
}

const PROJECT_NAME_NEEDED =
  "the ratchet keys a project's include/exclude by its name: give every inline project a unique literal `test.name`"

/**
 * The inline projects of the root `test.projects`, as name -> `{ include,
 * exclude, extends }`, plus the project `test` properties it read (`reached`);
 * or `{ error }`. A list that is not an array literal, an element that is not
 * an object literal (a config-file path or glob, which loads an unratcheted
 * file; a function; a spread), an `extends` that is not a boolean literal (a
 * path loads another unratcheted file) and a spread or shorthand anywhere in
 * a project land in `opaque`.
 */
function readProjects(node, opaque) {
  const projects = {}
  const reached = new Set()
  if (!ts.isArrayLiteralExpression(node)) {
    opaque.push(`test.projects: ${normalize(node.getText())}`)
    return { projects, reached }
  }
  for (const element of node.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      opaque.push(`test.projects element ${normalize(element.getText())}`)
      continue
    }
    for (const member of element.properties)
      if (!ts.isPropertyAssignment(member))
        opaque.push(`test.projects element member ${normalize(member.getText())}`)
    const testProp = lastProperty(element, "test")
    if (!testProp || !ts.isObjectLiteralExpression(testProp.initializer))
      return { error: `an inline project without a literal \`test\` block: ${PROJECT_NAME_NEEDED}` }
    reached.add(testProp)
    const name = projectName(testProp.initializer)
    if (name === undefined)
      return { error: `an inline project without a literal name: ${PROJECT_NAME_NEEDED}` }
    if (Object.hasOwn(projects, name) || name === "__proto__")
      return {
        error: `the project name ${JSON.stringify(name)} is taken twice (or is __proto__): ${PROJECT_NAME_NEEDED}`,
      }
    const label = `test.projects[${JSON.stringify(name)}]`
    const project = { include: null, exclude: [], extends: false }
    const extendsProp = lastProperty(element, "extends")
    if (extendsProp) {
      const value = literalValue(extendsProp.initializer)
      if (typeof value === "boolean") project.extends = value
      else opaque.push(`${label}.extends: ${normalize(extendsProp.initializer.getText())}`)
    }
    for (const member of testProp.initializer.properties) {
      if (!ts.isPropertyAssignment(member)) {
        opaque.push(`${label}: ${normalize(member.getText())}`)
        continue
      }
      const key = staticName(member.name)
      if (key === "include") project.include = listEntries(member.initializer)
      else if (key === "exclude") project.exclude = listEntries(member.initializer)
    }
    projects[name] = project
  }
  return { projects, reached }
}

/**
 * The measured-surface ratchets of a vitest config: `{ thresholds,
 * globThresholds, perFile, exclude, include, enabled, testInclude,
 * testExclude, projects, opaque, usesShared }`, or `{ error }` when the file
 * cannot be read unambiguously (the comparison then fails closed).
 * `include`/`testInclude` are null when the key is absent, `projects` when
 * the root test has no `projects` list (else name -> `{ include, exclude,
 * extends }`, see readProjects). `opaque` holds every member the ratchet
 * cannot read: a spread or shorthand inside coverage or test, a non-literal
 * threshold, and every computed key of the file whose name is no literal
 * (`[KEY]: ...` could BE coverage, test, thresholds or enabled).
 * `usesShared`: the config passes `sharedConfig` (vitest.shared.ts — where
 * coverage is ENABLED) into a call such as `mergeConfig`; vitest's own
 * default is coverage off.
 */
export function extractVitestCoverage(relPath, text) {
  const blocks = []
  const testBlocks = []
  const computed = []
  let usesShared = false
  walk(parseSource(relPath, text), (node) => {
    if (ts.isPropertyAssignment(node) && staticName(node.name) === "coverage") blocks.push(node)
    if (ts.isPropertyAssignment(node) && staticName(node.name) === "test") testBlocks.push(node)
    if (ts.isComputedPropertyName(node) && staticName(node) === undefined)
      computed.push(`computed key ${normalize(node.getText())}`)
    if (
      ts.isCallExpression(node) &&
      node.arguments.some((arg) => ts.isIdentifier(arg) && arg.text === "sharedConfig")
    )
      usesShared = true
  })
  const result = {
    thresholds: null,
    globThresholds: {},
    perFile: undefined,
    exclude: [],
    include: null,
    enabled: undefined,
    testInclude: null,
    testExclude: [],
    projects: null,
    opaque: computed,
    usesShared,
  }
  const rootTests = testBlocks.filter((block) => !isProjectTest(block))
  if (rootTests.length > 1)
    return {
      error: `${rootTests.length} \`test\` blocks outside test.projects: the ratchet needs at most one`,
    }
  const rootTest = rootTests[0]?.initializer
  let reached = new Set()
  if (rootTest) {
    if (!ts.isObjectLiteralExpression(rootTest))
      return { error: "`test` is not an object literal — the ratchet cannot read it" }
    for (const prop of rootTest.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        // A spread or shorthand could carry include/exclude the AST cannot see.
        result.opaque.push(`test: ${normalize(prop.getText())}`)
        continue
      }
      const name = staticName(prop.name)
      if (name === "include") result.testInclude = listEntries(prop.initializer)
      else if (name === "exclude") result.testExclude = listEntries(prop.initializer)
      else if (name === "projects") {
        const read = readProjects(prop.initializer, result.opaque)
        if (read.error) return { error: read.error }
        result.projects = read.projects
        reached = read.reached
      }
    }
  }
  if (testBlocks.some((block) => isProjectTest(block) && !reached.has(block)))
    return {
      error:
        "a `test` block inside a `projects` list the ratchet does not read (not the root test.projects, or a duplicate key): keep inline projects in the root `test: { projects: [...] }`",
    }
  if (blocks.length === 0) return result
  if (blocks.length > 1)
    return { error: `${blocks.length} \`coverage\` blocks — the ratchet needs exactly one` }
  if (insideProjectTest(blocks[0]))
    return {
      error:
        "`coverage` inside an inline project: vitest reads coverage from the root config only, so its floors would never apply. Move them to the root `test.coverage`",
    }
  if (!rootTest || blocks[0].parent !== rootTest)
    return {
      error:
        "a `coverage` block outside the root `test` block: vitest reads only `test.coverage`, so floors anywhere else never apply",
    }
  const coverage = blocks[0].initializer
  if (!ts.isObjectLiteralExpression(coverage))
    return { error: "`coverage` is not an object literal — the ratchet cannot read it" }
  for (const prop of coverage.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      // A spread or shorthand could carry thresholds/exclude the AST cannot see.
      result.opaque.push(normalize(prop.getText()))
      continue
    }
    const name = staticName(prop.name)
    if (name === "thresholds") {
      Object.assign(result, readThresholds(prop.initializer, result.opaque))
    } else if (name === "exclude") {
      result.exclude = listEntries(prop.initializer)
    } else if (name === "include") {
      result.include = listEntries(prop.initializer)
    } else if (name === "enabled") {
      const value = literalValue(prop.initializer)
      result.enabled = typeof value === "boolean" ? value : normalize(prop.initializer.getText())
    }
  }
  return result
}

/**
 * Whether an `ignores` list exempts files from gates: a global-ignores block
 * (nothing but `ignores`/`name`) or a block that applies `rules`. A block
 * that only routes files to a parser project (`languageOptions`) partitions
 * rather than exempts, and stays out of the ratchet.
 */
function isExemptionBlock(block) {
  if (!block || !ts.isObjectLiteralExpression(block)) return false
  const keys = block.properties.map((p) => memberName(p) ?? null)
  return keys.includes("rules") || keys.every((k) => k === "ignores" || k === "name")
}

/**
 * What an `ignores` entry of `block` exempts its files FROM: every rule for
 * the global-ignores block, else the rules the block applies. An ignore is
 * keyed by this scope, so copying an exemption into a broader block (the
 * global ignores) reads as new even though the string already exists.
 */
function ignoresScope(block) {
  const rules = block.properties.find((p) => memberName(p) === "rules")
  if (!rules) return "every rule (global ignores)"
  if (ts.isPropertyAssignment(rules) && ts.isObjectLiteralExpression(rules.initializer)) {
    const names = rules.initializer.properties.map((r) => memberName(r) ?? normalize(r.getText()))
    return `rules ${names.sort().join(", ")}`
  }
  return `rules ${normalize(rules.getText())}`
}

/** The `files` of a config block as a comparable key ("<all files>" when absent). */
function blockFiles(block) {
  const filesProp = ts.isObjectLiteralExpression(block)
    ? block.properties.find((p) => ts.isPropertyAssignment(p) && propName(p.name) === "files")
    : undefined
  return filesProp ? normalize(filesProp.initializer.getText()) : "<all files>"
}

/**
 * The config blocks of `export default …`: the arguments of a
 * `tseslint.config(…)`/`defineConfig(…)` call (array arguments flattened) or
 * the elements of an array literal.
 */
function configElements(sourceFile) {
  const exported = sourceFile.statements.find(ts.isExportAssignment)
  if (!exported) return []
  const expression = exported.expression
  const items = ts.isCallExpression(expression) ? [...expression.arguments] : [expression]
  return items.flatMap((item) => (ts.isArrayLiteralExpression(item) ? [...item.elements] : [item]))
}

const isObjectEntriesCall = (node) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "Object" &&
  node.expression.name.text === "entries"

const isDynamicImport = (node) =>
  ts.isCallExpression(node) &&
  (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require"))

const BUDGET_RULES = ["complexity", "max-lines"]
/** The rules the architecture and budget gates set — never relaxed per file. */
const GATE_RULES = [...BUDGET_RULES, "no-restricted-syntax"]
const RATCHET_MAPS = ["complexityRatchet", "maxLinesRatchet"]
const LAX_SEVERITIES = new Set(["off", "warn", 0, 1])

/**
 * The ESLint ratchets of eslint.config.mjs:
 * - `maps`: the exported debt maps (file → frozen value);
 * - `budgets`: every gate-rule setting (complexity, max-lines,
 *   no-restricted-syntax), keyed by rule + `files` + value shape (numbers
 *   masked), with its numeric values and whether it is an exemption
 *   ("off"/"warn");
 * - `ignores`: every entry of every exempting `ignores` list, keyed by the
 *   scope it exempts from (see ignoresScope);
 * - `opaque`: every shape the AST cannot see into — a non-literal or spread
 *   `rules`, a computed rule key, a spread into a config block, a config
 *   element that is not an object literal, a local or dynamic import, the
 *   argument of each Object.entries(…). The comparison freezes them: a new
 *   one fails closed.
 */
export function extractEslintRatchets(relPath, text) {
  const sourceFile = parseSource(relPath, text)
  const maps = {}
  const errors = []
  const budgets = {}
  const ignores = []
  const opaque = []

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text
      if (specifier.startsWith(".")) opaque.push(`local import "${specifier}"`)
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      const name = ts.isIdentifier(decl.name) ? decl.name.text : undefined
      if (!RATCHET_MAPS.includes(name)) continue
      if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) {
        errors.push(`${name} is not an object literal — the ratchet cannot read it`)
        continue
      }
      maps[name] = {}
      for (const prop of decl.initializer.properties) {
        const key = ts.isPropertyAssignment(prop) ? propName(prop.name) : undefined
        const value = key ? literalValue(prop.initializer) : undefined
        if (key === undefined || typeof value !== "number") {
          errors.push(`${name}: entry \`${normalize(prop.getText())}\` is not "file": <number>`)
          continue
        }
        maps[name][key] = value
      }
    }
  }

  for (const element of configElements(sourceFile)) {
    if (!ts.isObjectLiteralExpression(element)) {
      opaque.push(`config element \`${normalize(element.getText())}\``)
      continue
    }
    for (const prop of element.properties)
      if (ts.isSpreadAssignment(prop))
        opaque.push(`spread into a config block \`${normalize(prop.getText())}\``)
  }

  const consts = topLevelArrays(sourceFile)
  walk(sourceFile, (node) => {
    if (isDynamicImport(node)) opaque.push(`dynamic import \`${normalize(node.getText())}\``)
    if (isObjectEntriesCall(node))
      opaque.push(`Object.entries(${normalize(node.arguments[0]?.getText() ?? "")})`)
    if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) return
    const name = propName(node.name)
    const block = node.parent
    const value = ts.isShorthandPropertyAssignment(node) ? node.name : node.initializer
    if (name === "ignores" && isExemptionBlock(block)) {
      const scope = ignoresScope(block)
      for (const entry of arrayEntries(value, consts) ?? [normalize(value.getText())])
        ignores.push(`${scope} :: ${entry}`)
    }
    if (name !== "rules") return
    const files = blockFiles(block)
    if (!ts.isObjectLiteralExpression(value)) {
      opaque.push(`rules \`${normalize(value.getText())}\` (files ${files})`)
      return
    }
    for (const rule of value.properties) {
      const ruleName = ts.isPropertyAssignment(rule) ? propName(rule.name) : undefined
      if (ruleName === undefined) {
        opaque.push(`rules entry \`${normalize(rule.getText())}\` (files ${files})`)
        continue
      }
      if (!GATE_RULES.includes(ruleName)) continue
      const valueText = normalize(rule.initializer.getText())
      const severityNode = ts.isArrayLiteralExpression(rule.initializer)
        ? rule.initializer.elements[0]
        : rule.initializer
      const numbers = []
      walk(rule.initializer, (n) => {
        if (ts.isNumericLiteral(n) && n !== severityNode) numbers.push(Number(n.text))
      })
      const key = `${ruleName} | files ${files} | ${valueText.replace(/\d+(\.\d+)?/g, "#")}`
      budgets[key] = {
        rule: ruleName,
        numbers,
        exemption: LAX_SEVERITIES.has(literalValue(severityNode)),
      }
    }
  })

  return { maps, budgets, ignores, opaque, errors }
}

/** knip ignore-like entries, flattened to `path.key: value` strings. */
export function collectKnipIgnores(node, prefix = "", into = new Set()) {
  if (!node || typeof node !== "object") return into
  for (const [key, value] of Object.entries(node)) {
    // `ignore*` lists/maps, the config-level issue-type `exclude`, `entry`
    // globs (an entry marks files as used) and `rules` switched to
    // "off"/"warn" all make knip report less.
    const lax = /^ignore/.test(key) || key === "exclude" || key === "entry"
    if (lax && Array.isArray(value)) {
      for (const item of value) into.add(`${prefix}${key}: ${String(item)}`)
    } else if (lax && typeof value === "string") {
      into.add(`${prefix}${key}: ${value}`)
    } else if (lax && value && typeof value === "object") {
      for (const [sub, subValue] of Object.entries(value))
        into.add(`${prefix}${key}.${sub}: ${JSON.stringify(subValue)}`)
    } else if (lax && value === true) {
      into.add(`${prefix}${key}: true`)
    } else if (key === "rules" && value && typeof value === "object") {
      for (const [rule, level] of Object.entries(value))
        if (level !== "error") into.add(`${prefix}rules.${rule}: ${String(level)}`)
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      collectKnipIgnores(value, `${prefix}${key}.`, into)
    }
  }
  return into
}

/**
 * knip's narrowing lists, by path: the issue-type `include` and a
 * workspace's `project` files. Absent, knip checks every issue type and every
 * project file — so these may never appear, and never shrink.
 */
export function collectKnipScopes(node, prefix = "", into = new Map()) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return into
  for (const [key, value] of Object.entries(node)) {
    if (key === "include" || key === "project")
      into.set(`${prefix}${key}`, [value].flat().map(String))
    else if (value && typeof value === "object" && !Array.isArray(value))
      collectKnipScopes(value, `${prefix}${key}.`, into)
  }
  return into
}

/** JSON with comments + trailing commas (knip.jsonc); throws on a syntax error. */
export function parseJsonc(relPath, text) {
  const { config, error } = ts.parseConfigFileTextToJson(relPath, text)
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"))
  return config
}

// ── Inline suppressions (comments that switch a gate off in place) ──────────

/** The rules a directive must not switch off: the architecture and budget gates. */
const GATE_RULE_NAMES = new Set(GATE_RULES)

/** Cheap pre-filter: a file without any of these carries no suppression. */
const SUPPRESSION_HINT = /eslint|(?:v8|c8|istanbul)\s+ignore|stryker\s+disable/i
/** The same pre-filter as a POSIX ERE for `git grep -i -E` on the merge base. */
const SUPPRESSION_GREP = "eslint|(v8|c8|istanbul)[[:space:]]+ignore|stryker[[:space:]]+disable"

/**
 * Every comment of a source file, once each: the leading and trailing trivia
 * of every token. JSX text and JSDoc nodes are skipped — their text is not
 * trivia, and scanning it would read prose as comments.
 */
function sourceComments(relPath, text) {
  const sourceFile = parseSource(relPath, text)
  const ranges = new Map()
  const collect = (pos) => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, pos) ?? []),
    ])
      ranges.set(range.pos, range)
  }
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText || ts.isJSDoc(node)) return
    const children = node.getChildren(sourceFile)
    if (children.length === 0) collect(node.pos)
    else children.forEach(visit)
  }
  visit(sourceFile)
  return [...ranges.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((range) => ({
      block: range.kind === ts.SyntaxKind.MultiLineCommentTrivia,
      value: text.slice(
        range.pos + 2,
        range.kind === ts.SyntaxKind.MultiLineCommentTrivia ? range.end - 2 : range.end,
      ),
      line: sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1,
    }))
}

/**
 * The suppressions one comment carries, normalized ([] for an ordinary
 * comment). ESLint reads a directive only at the start of the comment and
 * ends its rule list at a ` -- description`.
 */
function classifyComment({ block, value }) {
  const [head] = value.trim().split(/\s-{2,}\s/)
  const disable = /^(eslint-disable(?:-next-line|-line)?)(?:\s+([\s\S]*))?$/.exec(head.trim())
  if (disable) {
    const rules = (disable[2] ?? "")
      .split(",")
      .map((rule) => rule.trim())
      .filter(Boolean)
    if (rules.length === 0) return [`${disable[1]} (every rule)`]
    return rules.filter((rule) => GATE_RULE_NAMES.has(rule)).map((rule) => `${disable[1]} ${rule}`)
  }
  const inlineConfig = /^eslint\s+([\s\S]+)$/.exec(head.trim())
  if (inlineConfig && block) {
    return [...inlineConfig[1].matchAll(/(?:^|,)\s*["']?([@\w/-]+)["']?\s*:/g)]
      .map((match) => match[1])
      .filter((rule) => GATE_RULE_NAMES.has(rule))
      .map((rule) => `eslint ${rule}: … (inline rule config)`)
  }
  const coverage = /^(v8|c8|istanbul)\s+ignore(?:\s+([\w-]+))?/i.exec(head.trim())
  if (coverage && coverage[2]?.toLowerCase() !== "stop")
    return [`${coverage[1].toLowerCase()} ignore${coverage[2] ? ` ${coverage[2]}` : ""}`]
  const stryker = /^stryker\s+disable(?:\s+([\w-]+))?/i.exec(head.trim())
  if (stryker) return [`Stryker disable${stryker[1] ? ` ${stryker[1]}` : ""}`]
  return []
}

/**
 * The gate-suppressing comments of one source file: `eslint-disable*` naming
 * complexity / max-lines / no-restricted-syntax (or no rule — that is every
 * rule), inline `/* eslint <gate rule>: … *\/` config, coverage hints
 * (`v8|c8|istanbul ignore`) and `Stryker disable`.
 */
export function suppressionDirectives(relPath, text) {
  if (!SUPPRESSION_HINT.test(text)) return []
  return sourceComments(relPath, text).flatMap((comment) =>
    classifyComment(comment).map((directive) => ({ directive, line: comment.line })),
  )
}

/** Inline suppressions are shrink-only per file (null text = file absent). */
export function compareSuppressions(relPath, oldText, newText) {
  if (newText === null || newText === undefined) return []
  const before = new Map()
  for (const { directive } of oldText ? suppressionDirectives(relPath, oldText) : [])
    before.set(directive, (before.get(directive) ?? 0) + 1)
  const now = new Map()
  for (const { directive, line } of suppressionDirectives(relPath, newText))
    now.set(directive, [...(now.get(directive) ?? []), line])
  const violations = []
  for (const [directive, lines] of now) {
    const had = before.get(directive) ?? 0
    if (lines.length > had) {
      violations.push(
        `${relPath}:${lines.join(",")} -> new inline \`${directive}\` (${had} -> ${lines.length}). An inline suppression is an exemption the config ratchets cannot see — fix the code instead (split the function or file, register through the registrar, write the test).`,
      )
    }
  }
  return violations
}

// ── Direction policies ───────────────────────────────────────────────────────

/** An include list (null = absent) only grows; it never appears or vanishes. */
function includeChanges(relPath, key, before, after, why) {
  if (before === null) {
    return after === null ? [] : [`${relPath} -> ${key} appeared (${after.join(", ")}). ${why}`]
  }
  if (after === null) return [`${relPath} -> ${key} was removed (was ${before.join(", ")}). ${why}`]
  return before
    .filter((entry) => !after.includes(entry))
    .map(
      (entry) =>
        `${relPath} -> ${key} lost "${entry}". Include lists only grow — narrowing them measures less.`,
    )
}

/**
 * Whether a floor now admits less coverage. vitest reads X >= 0 as a minimum
 * percentage and -X as "at most X uncovered": the two kinds compare only
 * through 100 (nothing uncovered) and 0 (no floor at all).
 */
function floorLoosened(before, after) {
  if (before < 0 === after < 0) return after < before
  return before < 0 ? after !== 100 : before !== 0
}

/** Every floor of `before` must survive in `after` as a number literal, never looser. */
function floorChanges(relPath, label, before, after) {
  const violations = []
  for (const [metric, was] of Object.entries(before)) {
    const now = after[metric]
    if (typeof now !== "number") {
      violations.push(
        `${relPath} -> ${label}.${metric} was removed or is no longer a number literal (was ${was}). Coverage floors are raise-only and never deleted.`,
      )
    } else if (floorLoosened(was, now)) {
      const kinds =
        was < 0 === now < 0
          ? ""
          : " A negative floor caps the uncovered count, a positive one is a percentage: they compare only through 100."
      violations.push(
        `${relPath} -> ${label}.${metric}: ${was} -> ${now}. Ratchets are raise-only — write the missing tests instead (pnpm --filter <pkg> test prints the uncovered files).${kinds}`,
      )
    }
  }
  return violations
}

const hasFloors = (floors) => Object.keys(floors ?? {}).length > 0
/** Whether a read config holds anything a deletion would lose: a floor or perFile. */
const carriesFloors = (read) =>
  hasFloors(read.thresholds) ||
  Object.values(read.globThresholds).some(hasFloors) ||
  read.perFile === true
const hasCountFloor = (read) =>
  [read.thresholds ?? {}, ...Object.values(read.globThresholds)].some((floors) =>
    Object.values(floors).some((value) => value < 0),
  )

/** Floors in vitest.shared.ts: a package key would override them where no ratchet looks. */
function sharedFloorViolations(relPath, cur) {
  if (relPath !== "vitest.shared.ts" || !carriesFloors(cur)) return []
  return [
    `${relPath} -> coverage.thresholds carries floors. Floors belong in each package's vitest.config.ts: mergeConfig lets a package key override a shared floor, and the per-file ratchet reads that key as a new (stricter) floor.`,
  ]
}

/**
 * Inline projects: none removed, each one's include grow-only and exclude
 * shrink-only, `extends` pinned (with `true` a project inherits the root
 * config's test options, so switching it changes which tests run), and the
 * list never appears or disappears (with projects vitest runs them instead of
 * the root config, a change the ratchet cannot compare). A new project only
 * adds tests.
 */
function projectChanges(relPath, before, after) {
  if (before === null && after === null) return []
  const names = (projects) => Object.keys(projects).join(", ")
  if (before === null)
    return [
      `${relPath} -> test.projects appeared (${names(after)}). With projects vitest runs them instead of the root test block, so the ratchet cannot compare the tests that run before and after. A deliberate switch carries a Ratchet-Exception trailer that says why.`,
    ]
  if (after === null)
    return [
      `${relPath} -> test.projects was removed (was ${names(before)}). Without projects vitest runs the root test block instead, so the ratchet cannot compare the tests that run before and after. Keep the projects, or carry a Ratchet-Exception trailer that says why.`,
    ]
  const violations = []
  for (const [name, was] of Object.entries(before)) {
    const label = `test.projects[${JSON.stringify(name)}]`
    const now = Object.hasOwn(after, name) ? after[name] : undefined
    if (!now) {
      violations.push(
        `${relPath} -> ${label} was removed (a renamed project reads as removed). Its tests no longer run, so the code they cover is measured less: projects only grow.`,
      )
      continue
    }
    violations.push(
      ...includeChanges(
        relPath,
        `${label}.include`,
        was.include,
        now.include,
        "Tests that never run never load the code they cover.",
      ),
    )
    for (const entry of now.exclude.filter((e) => !was.exclude.includes(e)))
      violations.push(
        `${relPath} -> new ${label}.exclude entry "${entry}". Tests that never run never load the code they cover: the measured surface only grows.`,
      )
    if (was.extends !== now.extends)
      violations.push(
        `${relPath} -> ${label}.extends: ${was.extends} -> ${now.extends}. With \`extends: true\` a project inherits the root config's test options (include, exclude, setup), so switching it changes which tests run: pinned to the merge base.`,
      )
  }
  return violations
}

/**
 * The rules for a package vitest config with nothing to compare against (the
 * diff introduces it, or the ratchet could not read its base): from the next
 * diff on it IS the ratchet, so it must be readable (an unreadable base is
 * never compared), measure (sharedConfig or `enabled: true`; vitest's default
 * is off and the canonical `vitest run` passes no flag) and carry a floor for
 * each of the four metrics. vitest.shared.ts only must stay free of floors.
 */
function newVitestConfigViolations(relPath, cur) {
  const violations = cur.opaque.map(
    (entry) =>
      `${relPath} -> spread/shorthand or non-literal \`${entry}\` in a vitest config with nothing to compare against. The ratchet reads literals only: inline the values, or it can never see them change.`,
  )
  violations.push(...sharedFloorViolations(relPath, cur))
  if (relPath === "vitest.shared.ts") return violations
  const measures = cur.enabled === true || (cur.enabled === undefined && cur.usesShared)
  if (!measures)
    violations.push(
      `${relPath} neither merges sharedConfig nor sets coverage.enabled: true (enabled: ${String(cur.enabled)}): \`vitest run\` would never measure coverage, so no threshold could fail. Merge sharedConfig (mergeConfig(sharedConfig, defineConfig({ ... }))) and leave \`enabled\` alone.`,
    )
  const missing = COVERAGE_METRICS.filter((metric) => {
    const floor = cur.thresholds?.[metric]
    return typeof floor !== "number" || floor === 0
  })
  if (missing.length > 0)
    violations.push(
      `${relPath} carries no coverage floor for ${missing.join(", ")}. A new package starts with all four global floors (statements, branches, functions, lines) as number literals just under its measured baseline; 0 is no floor.`,
    )
  return violations
}

/** A vitest config the diff introduces: see newVitestConfigViolations. */
function introducedVitest(relPath, newText) {
  if (newText === null || newText === undefined) return []
  const cur = extractVitestCoverage(relPath, newText)
  if (cur.error)
    return [
      `${relPath}: ${cur.error}. A new vitest config must be readable by the ratchet from its first commit: an unreadable base is never compared again.`,
    ]
  return newVitestConfigViolations(relPath, cur)
}

/**
 * A vitest config the ratchet cannot read on the base: never compared, so
 * the new side must stand on its own like an introduced config, and a side
 * that is unreadable too (or a deletion) fails.
 */
function unreadableVitestBase(relPath, error, newText) {
  if (newText === null || newText === undefined)
    return [
      `${relPath} was removed while the ratchet could not read its base (${error}), so nothing shows it carried no coverage floors. Coverage floors are raise-only and never deleted.`,
    ]
  const cur = extractVitestCoverage(relPath, newText)
  if (cur.error)
    return [
      `${relPath}: ${cur.error}, on the base and in the working tree. A ratchet the gate cannot read is a disabled ratchet, and one unreadable on the base is never compared: make it readable (the literal \`test: { coverage: { thresholds: { ... } } }\` shape).`,
    ]
  return newVitestConfigViolations(relPath, cur)
}

function compareVitest(relPath, oldText, newText) {
  const old = extractVitestCoverage(relPath, oldText)
  if (old.error) return unreadableVitestBase(relPath, old.error, newText)
  if (newText === null || newText === undefined) {
    return carriesFloors(old)
      ? [
          `${relPath} was removed while it carried coverage thresholds. Coverage floors are raise-only and never deleted.`,
        ]
      : []
  }
  const cur = extractVitestCoverage(relPath, newText)
  if (cur.error)
    return [
      `${relPath}: ${cur.error}. A ratchet the gate cannot read is a disabled ratchet — keep the literal \`coverage: { thresholds: { … } }\` shape.`,
    ]
  const violations = floorChanges(
    relPath,
    "coverage.thresholds",
    old.thresholds ?? {},
    cur.thresholds ?? {},
  )
  for (const [glob, was] of Object.entries(old.globThresholds)) {
    const label = `coverage.thresholds[${JSON.stringify(glob)}]`
    const now = Object.hasOwn(cur.globThresholds, glob) ? cur.globThresholds[glob] : undefined
    if (now !== undefined) violations.push(...floorChanges(relPath, label, was, now))
    else if (hasFloors(was))
      violations.push(
        `${relPath} -> ${label} was removed or is no longer an object literal (was ${JSON.stringify(was)}). A glob's floors are raise-only and never deleted. A renamed glob reads as removed: vitest checks a glob that matches no file against nothing, and that always passes.`,
      )
  }
  if (old.perFile === true && cur.perFile !== true) {
    violations.push(
      `${relPath} -> coverage.thresholds.perFile is now ${String(cur.perFile)} (was true). Without it a well-covered file hides an uncovered one in the average.`,
    )
  } else if (old.perFile !== true && cur.perFile === true && hasCountFloor(cur)) {
    violations.push(
      `${relPath} -> coverage.thresholds.perFile switched on next to a negative floor: -N then allows N uncovered items in EVERY file instead of N in all files together.`,
    )
  }
  violations.push(...sharedFloorViolations(relPath, cur))
  for (const entry of cur.exclude) {
    if (!old.exclude.includes(entry)) {
      violations.push(
        `${relPath} -> new coverage.exclude entry "${entry}". The measured surface only grows — excluding code the default run CAN execute "raises" coverage by measuring less.`,
      )
    }
  }
  violations.push(
    ...includeChanges(
      relPath,
      "coverage.include",
      old.include,
      cur.include,
      "Without one vitest measures every file the tests load; an include list can drop files from that measurement (the ratchet cannot tell a narrowing from a widening).",
    ),
    ...includeChanges(
      relPath,
      "test.include",
      old.testInclude,
      cur.testInclude,
      "Tests that never run never load the code they cover.",
    ),
  )
  for (const entry of cur.testExclude) {
    if (!old.testExclude.includes(entry)) {
      violations.push(
        `${relPath} -> new test.exclude entry "${entry}". Tests that never run never load the code they cover — the measured surface only grows.`,
      )
    }
  }
  violations.push(...projectChanges(relPath, old.projects, cur.projects))
  // vitest's default is coverage OFF: an explicit `true` that disappears is as
  // much a switch-off as a `false` that appears.
  const switchedOff =
    (cur.enabled !== undefined && cur.enabled !== true) ||
    (old.enabled === true && cur.enabled !== true)
  if (old.enabled !== false && switchedOff) {
    violations.push(
      `${relPath} -> coverage.enabled is now ${String(cur.enabled)} (was ${String(old.enabled)}). Switching coverage off disables every threshold.`,
    )
  }
  if (old.usesShared && !cur.usesShared && cur.enabled !== true) {
    violations.push(
      `${relPath} no longer merges sharedConfig and does not enable coverage itself — the thresholds would never be enforced.`,
    )
  }
  for (const entry of cur.opaque) {
    if (!old.opaque.includes(entry)) {
      violations.push(
        `${relPath} -> new spread/shorthand or non-literal \`${entry}\` in the vitest config. The ratchet reads literals only: inline the values (a spread written after the literals overrides them at runtime).`,
      )
    }
  }
  return violations
}

/** Stryker options that only shape reports, caching or parallelism — free to change. */
const STRYKER_FREE_KEYS = new Set([
  "$schema",
  "allowConsoleColors",
  "cleanTempDir",
  "clearTextReporter",
  "concurrency",
  "dashboard",
  "fileLogLevel",
  "htmlReporter",
  "incremental",
  "incrementalFile",
  "jsonReporter",
  "logLevel",
  "reporters",
  "tempDirName",
])

/** Key-order-insensitive JSON (undefined stays undefined). */
const stableJson = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )

/**
 * The options of a Stryker config outside the dedicated policies (mutate,
 * thresholds.break, mutator.excludedMutations) and the free report/cache keys.
 */
function strykerPinnedView(json) {
  const view = {}
  for (const [key, value] of Object.entries(json ?? {})) {
    if (STRYKER_FREE_KEYS.has(key) || key === "mutate") continue
    if (key === "thresholds" || key === "mutator") {
      const {
        break: _break,
        high: _high,
        low: _low,
        excludedMutations: _excluded,
        ...rest
      } = value ?? {}
      if (Object.keys(rest).length > 0) view[key] = rest
      continue
    }
    view[key] = value
  }
  return view
}

function compareStryker(relPath, oldJson, newJson, fileExists) {
  const violations = []
  if (newJson === null) {
    return [
      `${relPath} was removed. The mutation gate needs it — removing it drops the package out of the diff gate.`,
    ]
  }
  const oldBreak = oldJson?.thresholds?.break
  const newBreak = newJson?.thresholds?.break
  const breakRaised =
    typeof newBreak === "number" && typeof oldBreak === "number" && newBreak > oldBreak
  if (typeof oldBreak === "number" && (typeof newBreak !== "number" || newBreak < oldBreak)) {
    violations.push(
      `${relPath} -> thresholds.break: ${oldBreak} -> ${String(newBreak)}. The mutation floor is raise-only — kill the surviving mutants (write the missing assertions) instead of lowering it.`,
    )
  }
  const oldMutate = Array.isArray(oldJson?.mutate) ? oldJson.mutate : []
  const newMutate = Array.isArray(newJson?.mutate) ? newJson.mutate : []
  const pkgDir = path.posix.dirname(relPath)
  // Negated globs invert the direction: removing "!x" or adding "x" GROWS the
  // measured surface (allowed); removing "x" or adding "!x" SHRINKS it. A
  // literal entry whose file is gone (deleted/renamed) may leave freely.
  const isLiteralPath = (p) => !/[*?[\]{}!]/.test(p)
  const shrinkers = [
    ...oldMutate.filter(
      (p) =>
        !p.startsWith("!") &&
        !newMutate.includes(p) &&
        !(isLiteralPath(p) && !fileExists(path.posix.join(pkgDir, p))),
    ),
    ...newMutate.filter((p) => p.startsWith("!") && !oldMutate.includes(p)),
  ]
  if (shrinkers.length > 0 && !breakRaised) {
    violations.push(
      `${relPath} -> mutate allowlist shrank (${shrinkers.join(", ")}) without raising thresholds.break. Shrinking the measured surface "improves" the score by measuring less — allowed ONLY together with a break raise for the remaining surface.`,
    )
  }
  const oldExcluded = oldJson?.mutator?.excludedMutations ?? []
  for (const mutation of newJson?.mutator?.excludedMutations ?? []) {
    if (!oldExcluded.includes(mutation)) {
      violations.push(
        `${relPath} -> new mutator.excludedMutations entry "${mutation}". Excluding mutators measures less — kill the mutants instead.`,
      )
    }
  }
  const before = strykerPinnedView(oldJson)
  const after = strykerPinnedView(newJson)
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = stableJson(before[key])
    const now = stableJson(after[key])
    if (was !== now) {
      violations.push(
        `${relPath} -> "${key}" changed (${was ?? "unset"} -> ${now ?? "unset"}). Outside mutate/thresholds every Stryker option decides which mutants exist or how they count (ignoreStatic, ignorers, mutator.plugins, the test runner and its config — and a timed-out mutant counts as killed, so timeoutMS too): pinned to the merge base.`,
      )
    }
  }
  return violations
}

function compareEslint(relPath, oldText, newText) {
  if (newText === null) return [`${relPath} was removed — every ESLint gate goes with it.`]
  const old = extractEslintRatchets(relPath, oldText)
  const cur = extractEslintRatchets(relPath, newText)
  const violations = cur.errors.map(
    (e) => `${relPath} -> ${e}. A ratchet the gate cannot read is a disabled ratchet.`,
  )
  for (const mapName of RATCHET_MAPS) {
    const oldMap = old.maps[mapName]
    const newMap = cur.maps[mapName]
    if (!oldMap) continue
    if (!newMap) {
      violations.push(
        `${relPath} -> \`export const ${mapName}\` is gone. Keep the (possibly empty) literal — the ratchet reads it.`,
      )
      continue
    }
    for (const [file, value] of Object.entries(newMap)) {
      if (!(file in oldMap)) {
        violations.push(
          `${relPath} -> new ${mapName} entry "${file}" (${value}). The debt list only shrinks — split/simplify the file instead of freezing new debt.`,
        )
      } else if (value > oldMap[file]) {
        violations.push(
          `${relPath} -> ${mapName} "${file}": ${oldMap[file]} -> ${value}. The debt list only shrinks — refactor the file back under its frozen value.`,
        )
      }
    }
  }
  for (const [key, setting] of Object.entries(cur.budgets)) {
    const before = old.budgets[key]
    if (!before) {
      if (BUDGET_RULES.includes(setting.rule)) {
        violations.push(
          `${relPath} -> new ${setting.rule} setting (${key}). New code gets the global budget; an override or exemption is new debt — fix the code instead.`,
        )
      } else if (setting.exemption) {
        violations.push(
          `${relPath} -> new ${setting.rule} exemption (${key}). Switching a gate rule off or to "warn" for some files exempts them from the gate — fix the code instead.`,
        )
      }
      // A new no-restricted-syntax "error" block may legitimately add a gate;
      // the effective-config comparison sees one that REPLACES another gate's
      // selectors for files both match.
      continue
    }
    setting.numbers.forEach((value, i) => {
      if (typeof before.numbers[i] === "number" && value > before.numbers[i]) {
        violations.push(
          `${relPath} -> ${key}: ${before.numbers[i]} -> ${value}. Budgets only tighten.`,
        )
      }
    })
  }
  for (const [key, setting] of Object.entries(old.budgets)) {
    if (
      BUDGET_RULES.includes(setting.rule) &&
      !cur.budgets[key] &&
      !setting.exemption &&
      setting.numbers.length > 0
    ) {
      violations.push(
        `${relPath} -> the budget setting "${key}" was removed. The global complexity/max-lines budgets are never dropped.`,
      )
    }
  }
  for (const entry of cur.opaque) {
    if (!old.opaque.includes(entry)) {
      violations.push(
        `${relPath} -> new ${entry}. The ratchet reads literals only — a non-literal rules object, a spread, an import or Object.entries(…) can carry an exemption it cannot see; inline the literal values instead.`,
      )
    }
  }
  for (const entry of cur.ignores) {
    if (!old.ignores.includes(entry)) {
      const [scope, glob] = entry.split(" :: ")
      violations.push(
        `${relPath} -> new \`ignores\` entry "${glob}" (exempts from: ${scope}). Ignore lists are shrink-only per block — an ignored file escapes every gate in that block, and the global ignores exempt it from every rule.`,
      )
    }
  }
  return violations
}

function compareKnip(relPath, oldJson, newJson) {
  if (newJson === null) {
    return [
      `${relPath} was removed — knip then runs on its defaults or on whichever knip.json/knip.ts it finds, and every ratcheted list goes with it.`,
    ]
  }
  const oldIgnores = collectKnipIgnores(oldJson)
  const violations = []
  for (const entry of collectKnipIgnores(newJson)) {
    if (!oldIgnores.has(entry)) {
      violations.push(
        `${relPath} -> new "${entry}". knip's ignore lists, issue-type excludes, relaxed rules and entry globs are shrink-only — each makes knip report less (an entry marks files as used). Delete the dead code / declare the dependency instead.`,
      )
    }
  }
  const oldScopes = collectKnipScopes(oldJson)
  for (const [key, entries] of collectKnipScopes(newJson)) {
    const before = oldScopes.get(key)
    if (!before) {
      violations.push(
        `${relPath} -> "${key.split(".").pop()}" appeared at ${key}. knip checks every issue type and every project file by default — an include/project list can only narrow that.`,
      )
      continue
    }
    for (const lost of before.filter((entry) => !entries.includes(entry)))
      violations.push(`${relPath} -> ${key} lost "${lost}". knip's measured scope only grows.`)
  }
  return violations
}

/** The growth message of each shrink-only budget file. */
const BUDGET_GROWTH = {
  "char-budgets": (relPath, name, from, to) =>
    `${relPath} -> "${name}": ${from} -> ${to} model-visible characters. The LLM-facing tool surface budget is shrink-only — trim descriptions/schemas elsewhere, or justify the growth with a Ratchet-Exception trailer.`,
  "bundle-budget": (relPath, name, from, to) =>
    `${relPath} -> "${name}": ${from} -> ${to} bytes gzip. Every view resource inlines the widget bundle, so its ceiling is shrink-only — shrink the bundle, or justify the growth with a Ratchet-Exception trailer.`,
}

function compareBudgets(kind, relPath, oldJson, newJson) {
  const violations = []
  for (const [name, oldValue] of Object.entries(oldJson ?? {})) {
    if (name.startsWith("$") || typeof oldValue !== "number") continue
    const newValue = newJson?.[name]
    if (typeof newValue !== "number") {
      violations.push(`${relPath} -> budget "${name}" was removed (was ${oldValue}).`)
    } else if (newValue > oldValue) {
      violations.push(BUDGET_GROWTH[kind](relPath, name, oldValue, newValue))
    }
  }
  return violations
}

/** `a && b && c` → the chained commands, whitespace-normalized. */
const chainSegments = (script) =>
  typeof script === "string"
    ? script
        .split("&&")
        .map((s) => s.trim().replace(/\s+/g, " "))
        .filter(Boolean)
    : []

const normalizeCommand = (script) =>
  String(script ?? "")
    .trim()
    .replace(/\s+/g, " ")

const EXCLUDE_FLAG = /--exclude[= ]([\w,]+)/g

const excludeList = (script) =>
  [...String(script ?? "").matchAll(EXCLUDE_FLAG)].flatMap((m) => m[1].split(","))

/** The root chains whose segments are gates. */
const ROOT_CHAINS = ["lint", "test"]
/** Root gates CI (or the docs) run directly, outside the lint/test chains. */
const DIRECT_ROOT_GATES = ["build", "typecheck", "format:check", "test:pg", "test:mutation"]
/** The only shape a NEW chain segment may take. */
const PLAIN_PNPM_SEGMENT = /^pnpm (?:run )?([\w:-]+)$/
/** Per-package scripts that turbo runs as gates. */
const PACKAGE_GATES = ["lint", "typecheck", "test", "test:mutation"]

/**
 * Why `after` is not the pinned gate command `before` — null when it is,
 * or when only an `--exclude` list shrank (the one tightening a gate command
 * takes without the trailer).
 */
function gateCommandChange(before, after) {
  if (normalizeCommand(before) === normalizeCommand(after)) return null
  const withoutExcludes = (script) => normalizeCommand(String(script).replace(EXCLUDE_FLAG, ""))
  if (withoutExcludes(before) === withoutExcludes(after)) {
    const allowed = new Set(excludeList(before))
    const grown = excludeList(after).filter((kind) => !allowed.has(kind))
    if (grown.length === 0) return null
    return `now excludes ${grown.map((kind) => `"${kind}"`).join(", ")} — an --exclude list only shrinks (the command is otherwise pinned to the merge base)`
  }
  return `changed: "${normalizeCommand(before)}" -> "${normalizeCommand(after)}". Gate commands are pinned to the merge base — an added argument (a base ref, \`|| true\`, \`--include\`, \`--config\`, a test-name filter) hollows a gate as surely as a removed one; a deliberate change carries the Ratchet-Exception trailer`
}

function compareRootScripts(relPath, oldJson, newJson) {
  const violations = []
  const oldScripts = oldJson?.scripts ?? {}
  const newScripts = newJson?.scripts ?? {}
  const pinned = new Set(DIRECT_ROOT_GATES)
  for (const name of ROOT_CHAINS) {
    const before = chainSegments(oldScripts[name])
    const after = chainSegments(newScripts[name])
    for (const segment of before) {
      const script = PLAIN_PNPM_SEGMENT.exec(segment)?.[1]
      if (script) pinned.add(script)
      if (!after.includes(segment)) {
        violations.push(
          `${relPath} -> "${segment}" dropped out of \`pnpm ${name}\`. Gates are never unhooked from the chain.`,
        )
      }
    }
    for (const segment of after) {
      if (!before.includes(segment) && !PLAIN_PNPM_SEGMENT.test(segment)) {
        violations.push(
          `${relPath} -> \`pnpm ${name}\` gained "${segment}". The chain only grows by plain \`pnpm <script>\` gates — any other command or shell operator (\`||\`, \`;\`, \`|\`, \`exit\`) can end the chain early or swallow its exit code.`,
        )
      }
    }
  }
  for (const script of [...pinned].sort()) {
    if (typeof oldScripts[script] !== "string") continue
    if (typeof newScripts[script] !== "string") {
      violations.push(
        `${relPath} -> "${script}" was removed — a gate CI runs or chains goes with it.`,
      )
      continue
    }
    const change = gateCommandChange(oldScripts[script], newScripts[script])
    if (change) violations.push(`${relPath} -> the "${script}" gate ${change}.`)
  }
  if (newJson && Object.hasOwn(newJson, "knip")) {
    violations.push(
      `${relPath} -> a \`knip\` key (package.json#knip). knip merges it UNDER knip.jsonc, so every key knip.jsonc leaves out (include, exclude, rules, ignore…) would come from here, unratcheted — keep the knip config in knip.jsonc.`,
    )
  }
  return violations
}

function comparePackageScripts(relPath, oldJson, newJson) {
  if (newJson === null) return [] // the package left the workspace; its other ratchets say so
  const violations = []
  for (const script of PACKAGE_GATES) {
    const before = oldJson?.scripts?.[script]
    if (typeof before !== "string") continue
    const after = newJson?.scripts?.[script]
    if (typeof after !== "string") {
      violations.push(
        `${relPath} -> "${script}" was removed — turbo then skips the package's ${script} gate silently.`,
      )
    } else if (normalizeCommand(before) !== normalizeCommand(after)) {
      violations.push(
        `${relPath} -> the "${script}" gate changed: "${normalizeCommand(before)}" -> "${normalizeCommand(after)}". A package's gate commands are pinned to the merge base — \`--coverage.enabled=false\`, \`--rule 'complexity: off'\`, \`|| true\` or a dropped \`tsc -p\` project switch the gate off while the command still "runs" it. A deliberate change carries the Ratchet-Exception trailer.`,
      )
    }
  }
  return violations
}

function shadowViolation(relPath) {
  return SHADOW_CONFIGS.find(({ pattern }) => pattern.test(relPath)).message(relPath)
}

/**
 * A workspace package.json key that configures a gate's tool where no
 * ratchet looks: prettier reads a package.json `prettier` key BEFORE any
 * .prettierrc in the same directory, so a nested one formats its package in
 * a foreign style and the root one would replace .prettierrc.json itself.
 */
function manifestKeyViolations(relPath, json) {
  if (!json || typeof json !== "object" || !Object.hasOwn(json, "prettier")) return []
  return [
    `${relPath} -> a \`prettier\` key (package.json#prettier). prettier reads it before any .prettierrc in the same directory, so every file below it would be formatted, and pass format:check, in a style the root .prettierrc.json does not set. Per-app style goes into the root .prettierrc.json \`overrides\` (\`"files": ["apps/<app>/**"]\`); delete the key.`,
  ]
}

/** A ratchet file that does not parse: fails whatever the base held. */
const invalidJson = (relPath) => [
  `${relPath} is not valid JSON — a broken ratchet file disables the gate.`,
]

/**
 * A ratchet file with nothing to compare against (absent on the base, or
 * unreadable there) is free, with two exceptions: a package vitest config
 * must already be a working ratchet (introducedVitest), and a workspace
 * package.json carries no `prettier` key.
 */
function introducedViolations(kind, relPath, newText) {
  if (newText === null || newText === undefined) return []
  if (kind === "vitest") return introducedVitest(relPath, newText)
  if (!MANIFEST_KINDS.has(kind)) return []
  let json
  try {
    json = JSON.parse(newText)
  } catch {
    return invalidJson(relPath)
  }
  return manifestKeyViolations(relPath, json)
}

/**
 * Compare one ratchet file's base text with its new text (null = absent).
 * `fileExists(repoRelPath)` answers for the working tree (stale mutate
 * entries); it defaults to "exists", the conservative answer.
 */
export function checkRatchetFile(relPath, oldText, newText, fileExists = () => true) {
  const kind = ratchetKind(relPath)
  // A shadowing config fails whenever it exists — introducing one is the attack.
  if (kind === "shadow-config")
    return newText === null || newText === undefined ? [] : [shadowViolation(relPath)]
  if (oldText === null || oldText === undefined) return introducedViolations(kind, relPath, newText)
  if (kind === "vitest") return compareVitest(relPath, oldText, newText)
  if (kind === "eslint") return compareEslint(relPath, oldText, newText)

  const parse = (text) =>
    relPath.endsWith(".jsonc") ? parseJsonc(relPath, text) : JSON.parse(text)
  // The new side first: a broken file fails whatever the base held, so a
  // ratchet file unreadable on both sides is never waved through.
  let newJson = null
  if (newText !== null && newText !== undefined) {
    try {
      newJson = parse(newText)
    } catch {
      return invalidJson(relPath)
    }
  }
  let oldJson
  try {
    oldJson = parse(oldText)
  } catch {
    // Unreadable on the base: nothing to compare, so the new side stands alone.
    return introducedViolations(kind, relPath, newText)
  }
  if (kind === "stryker") return compareStryker(relPath, oldJson, newJson, fileExists)
  if (kind === "knip") return compareKnip(relPath, oldJson, newJson)
  if (kind === "char-budgets" || kind === "bundle-budget") {
    return compareBudgets(kind, relPath, oldJson, newJson)
  }
  if (kind === "root-scripts")
    return [
      ...compareRootScripts(relPath, oldJson, newJson),
      ...manifestKeyViolations(relPath, newJson),
    ]
  if (kind === "package-scripts")
    return [
      ...comparePackageScripts(relPath, oldJson, newJson),
      ...manifestKeyViolations(relPath, newJson),
    ]
  if (kind === "workspace-manifest") return manifestKeyViolations(relPath, newJson)
  return []
}

/**
 * The ref to compare against. In CI (GITHUB_BASE_REF set) it is always the
 * PR base: a positional ref there would let a PR re-point its own gate
 * (`check-ratchets.mjs HEAD` compares the branch with itself).
 */
export function resolveBaseRef(argv, env) {
  const positional = argv[2]
  if (env.GITHUB_BASE_REF) {
    const ref = `origin/${env.GITHUB_BASE_REF}`
    return positional !== undefined && positional !== ref
      ? { ref, ignoredArg: positional }
      : { ref }
  }
  return { ref: positional ?? "origin/main" }
}

/** A pull-request run: one whose merge base equals HEAD compared nothing. */
export const isPullRequest = (env) => /^pull_request/.test(env.GITHUB_EVENT_NAME ?? "")

// ── CLI ──────────────────────────────────────────────────────────────────────

/** Sources the inline-suppression scan and the effective ESLint config cover. */
const SOURCE_FILE = /^(?:apps|packages)\/(?!(?:.*\/)?node_modules\/).*\.(?:[cm]?[jt]s|[jt]sx)$/

function scanSuppressions(git, mergeBase, listed) {
  let baseCandidates = new Set()
  try {
    baseCandidates = new Set(
      git("grep", "-l", "-I", "-i", "-E", SUPPRESSION_GREP, mergeBase, "--", "apps", "packages")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(line.indexOf(":") + 1)),
    )
  } catch {
    // exit 1: no file on the base mentions a suppression
  }
  const violations = []
  for (const rel of listed) {
    if (!SOURCE_FILE.test(rel)) continue
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs)) continue
    const newText = fs.readFileSync(abs, "utf8")
    if (!SUPPRESSION_HINT.test(newText)) continue
    const oldText = baseCandidates.has(rel) ? git("show", `${mergeBase}:${rel}`) : null
    violations.push(...compareSuppressions(rel, oldText, newText))
  }
  return violations
}

/**
 * The effective-config half of the ESLint ratchet — run whenever
 * eslint.config.mjs differs from the base. The base text is evaluated from a
 * temporary sibling file (same directory: same `import.meta.dirname`, same
 * package resolution); the config imports nothing local, which the AST half
 * enforces.
 */
async function effectiveEslintViolations(git, mergeBase, listed) {
  const rel = "eslint.config.mjs"
  const abs = path.join(repoRoot, rel)
  let baseText
  try {
    baseText = git("show", `${mergeBase}:${rel}`)
  } catch {
    return [] // no config on the base: nothing to compare
  }
  if (!fs.existsSync(abs) || fs.readFileSync(abs, "utf8") === baseText) return []
  const baseFile = path.join(repoRoot, `.check-ratchets-base-${process.pid}.eslint.mjs`)
  fs.writeFileSync(baseFile, baseText)
  try {
    const { compareEffectiveEslint } = await import("./eslint-effective-config.mjs")
    return await compareEffectiveEslint({
      cwd: repoRoot,
      baseConfigFile: baseFile,
      newConfigFile: abs,
      files: listed.filter((f) => SOURCE_FILE.test(f) && fs.existsSync(path.join(repoRoot, f))),
      label: rel,
    })
  } catch (error) {
    return [
      `${rel} -> the effective-config comparison could not run (${String(error?.message ?? error).split("\n")[0]}). A ratchet the gate cannot evaluate is a disabled ratchet.`,
    ]
  } finally {
    fs.rmSync(baseFile, { force: true })
  }
}

async function main() {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    })
  const fail = (message) => {
    console.error(`check-ratchets: ${message}`)
    process.exit(1)
  }

  const { ref: baseRef, ignoredArg } = resolveBaseRef(process.argv, process.env)
  if (ignoredArg) {
    console.log(
      `check-ratchets: ignoring the base ref "${ignoredArg}" — in CI the base is always the PR base (${baseRef}).`,
    )
  }

  if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
    fail(
      "shallow clone — the merge base may be missing. In CI check out with `fetch-depth: 0`; locally run `git fetch --unshallow`. Refusing to skip silently.",
    )
  }
  let mergeBase
  try {
    mergeBase = git("merge-base", baseRef, "HEAD").trim()
  } catch {
    fail(
      `cannot compute the merge base against ${baseRef}. Fetch it first (git fetch origin), or pass the base ref as the first argument. Refusing to skip silently.`,
    )
  }
  if (mergeBase === git("rev-parse", "HEAD").trim()) {
    if (isPullRequest(process.env)) {
      fail(
        `HEAD is the merge base with ${baseRef} on a pull request — the check would compare the branch with itself and pass vacuously. Refusing.`,
      )
    }
    console.log(
      `check-ratchets: HEAD is the merge base with ${baseRef} — comparing the working tree against it.`,
    )
  }

  const listed = git("ls-files", "--cached", "--others", "--exclude-standard")
    .split("\n")
    .filter(Boolean)
  const ratchets = (files) => files.filter((f) => ratchetKind(f) !== null)
  const baseFiles = new Set(ratchets(git("ls-tree", "-r", "--name-only", mergeBase).split("\n")))
  const fileExists = (rel) => fs.existsSync(path.join(repoRoot, rel))

  const violations = []
  for (const rel of [...new Set([...baseFiles, ...ratchets(listed)])].sort()) {
    const oldText = baseFiles.has(rel) ? git("show", `${mergeBase}:${rel}`) : null
    const abs = path.join(repoRoot, rel)
    const newText = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null
    violations.push(...checkRatchetFile(rel, oldText, newText, fileExists))
  }
  violations.push(...scanSuppressions(git, mergeBase, listed))
  violations.push(...(await effectiveEslintViolations(git, mergeBase, listed)))

  if (violations.length === 0) {
    console.log(
      `check-ratchets: ${baseFiles.size} ratchet file(s) + inline suppressions vs ${baseRef} (${mergeBase.slice(0, 9)}) — all move in the right direction.`,
    )
    return
  }

  const commitMessages = git("log", `${mergeBase}..HEAD`, "--format=%B")
  const reason = EXCEPTION_TRAILER.exec(commitMessages)?.[0]
  const inCi = Boolean(process.env.GITHUB_ACTIONS)
  for (const violation of violations) {
    if (reason) console.log(`${inCi ? "::warning::" : ""}RATCHET EXCEPTION APPLIED — ${violation}`)
    else console.error(`${inCi ? "::error::" : ""}RATCHET VIOLATION ${violation}`)
  }
  if (reason) {
    console.log(
      `check-ratchets: ${violations.length} violation(s) waved through by commit trailer "${reason}". Reviewers: this is the single documented escape — check the reason.`,
    )
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### ⚠️ Ratchet exception applied\n\n\`${reason}\`\n\n${violations.map((v) => `- ${v}`).join("\n")}\n`,
      )
    }
    return
  }
  fail(
    `${violations.length} violation(s). Ratchets only move one way — fix the code, not the threshold. The single escape (requires review): a commit trailer "Ratchet-Exception: <reason>".`,
  )
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) await main()
