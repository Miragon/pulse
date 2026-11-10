#!/usr/bin/env node
/**
 * Ratchet self-protection, ported from mcp-toolkit's scripts/check-ratchets.mjs
 * and adapted to where this repo keeps its ratchets.
 *
 * The fastest way to turn a red gate green is to loosen the gate in the same
 * diff: a rule-shaped edit nobody reads as a regression. This check compares
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
 *                                   other); every include/exclude list read
 *                                   entry by entry, also where it names,
 *                                   spreads or is shorthand for a constant of
 *                                   the file, declared once as a top-level
 *                                   const (`as const` too): a string (literal,
 *                                   or a template of such strings), or an
 *                                   unexported array the file names only as
 *                                   such a list or in a spread, so no code
 *                                   that names it can change it unseen; an
 *                                   entry that names any other binding of the
 *                                   file (an array pushed to, passed on or
 *                                   exported, a let, a shadowed name, a
 *                                   function; every binding of a file that
 *                                   calls eval) is opaque, with its reason;
 *                                   an import such as
 *                                   `coverageConfigDefaults.exclude` stays one
 *                                   entry of its own text (its content is the
 *                                   other module's). The reader runs nothing:
 *                                   a list changed through the config object
 *                                   after the config was built is out of its
 *                                   sight, a literal as much as a constant.
 *                                   Every other shape the AST cannot read (a
 *                                   spread or shorthand member, accessor,
 *                                   computed key or non-literal value) is
 *                                   opaque, frozen by its text. A config the
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
 *   eslint.config.mjs               the effective config ESLint itself
 *                                   computes per source file, base vs working
 *                                   tree (scripts/eslint-effective-config.mjs:
 *                                   complexity / max-lines / no-restricted-syntax
 *                                   never loosened, no file newly ignored);
 *                                   from the source: `ignores` shrink-only per
 *                                   block scope (a block of any rule), and no
 *                                   new local or dynamic import (the base
 *                                   config is evaluated next to today's files)
 *   knip.jsonc                      every ignore list, the issue-type `exclude`,
 *                                   non-"error" `rules` and `entry` globs
 *                                   shrink-only; `include`/`project` never
 *                                   appear or shrink; never deleted
 *   apps/<app>/test/__golden__/char-budgets.json
 *                                   model-visible surface budgets per toolset
 *                                   (tools/list plus the server instructions)
 *                                   shrink-only, never removed
 *   apps/<app>/test/__golden__/bundle-budget.json
 *                                   bundle size ceilings shrink-only, never
 *                                   removed: the MCP server's widget bundle
 *                                   and the VS Code webview (gzip), the CLI's
 *                                   dist (raw bytes; scripts/published-
 *                                   imports.test.mjs reads it); each file's
 *                                   $comment says what it measures
 *   package.json (root)             no gate drops out of `lint`/`test`, and the
 *                                   chains only gain plain `pnpm <script>`
 *                                   gates; every chained gate script and the
 *                                   gates CI runs directly are pinned (only an
 *                                   `--exclude` list may shrink); no `knip` key
 *   <pkg>/package.json              lint / typecheck / test pinned
 *   every workspace package.json    no `prettier` key (root, apps, packages,
 *                                   docs, the starter's manifests under
 *                                   templates/composed-server; also in a
 *                                   package.json the diff introduces):
 *                                   prettier reads it before any .prettierrc
 *                                   in the same directory
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
 *   templates/composed-server/.prettierrc.json
 *                                   the one nested prettier config: a starter
 *                                   repo has no root config above it. It
 *                                   carries exactly the root .prettierrc.json's
 *                                   settings without `overrides`, so it sets no
 *                                   style of its own. It drops every override,
 *                                   a generic glob too (the parser of the
 *                                   .claude-plugin manifests): being nearer,
 *                                   it wins for the starter's files, so no
 *                                   root override reaches them
 *   inline suppressions             `eslint-disable` of a gate rule (or of every
 *                                   rule), inline gate-rule config, `v8|c8|
 *                                   istanbul ignore`, `Stryker disable` in
 *                                   apps/ and packages/ sources: shrink-only
 *
 * The SINGLE documented escape is a trailer on the commit that makes the
 * change, and it covers that commit only:
 *
 *   Ratchet-Exception: <reason>
 *
 * When the net comparison (merge base -> working tree) finds violations and
 * a commit of the range carries the trailer, the check replays itself step
 * by step over the files each step changes: every commit against its parent
 * (the first one; a merge whose first parent is already in the base, as in
 * GitHub's pull-request test merge, against its branch-side parent), then
 * the uncommitted changes (HEAD -> working tree, never a trailer). A net
 * violation is matched to the steps that make it by file and key (the
 * message with its numbers and quoted "from" -> "to" values normalized; the
 * effective ESLint findings file by file, a lost no-restricted-syntax
 * selector selector by selector) and is downgraded to a loud warning, naming
 * each commit and its reason, only when EVERY step that makes it carries the
 * trailer: one made in A and again in B needs both, and a trailer added to a
 * later commit covers nothing. One that no single step makes (the steps only
 * add up to it) fails closed. A step that brings a ratchet file back to a path
 * the merge base holds, after an earlier step removed it, is compared with the
 * base's file there (the side the net comparison reads): that step decides
 * what the path holds, so it makes what the net comparison finds there.
 * CODEOWNERS review still applies to every PR. There is no other bypass.
 *
 * Run: node scripts/check-ratchets.mjs [baseRef]   (`pnpm lint:ratchets`;
 * default origin/main. In CI the base is ALWAYS origin/$GITHUB_BASE_REF: a
 * positional ref is ignored there, and a pull request whose merge base is
 * HEAD fails instead of comparing the branch with itself; CI needs
 * fetch-depth: 0). The working tree is the "new" side, so uncommitted
 * loosening fails locally too.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"
import ts from "typescript"
import { MUTATION_PAUSED } from "./mutation-pause.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const EXCEPTION_TRAILER = /^Ratchet-Exception: .+/m

const PKG = String.raw`(?:apps/[^/]+|packages/core/[^/]+|packages/connectors/[^/]+/[^/]+)`

/** The default message: the tool resolves the shadow first, the ratchet keeps reading `replaces`. */
const loadedInstead = (replaces) => (relPath) =>
  `${relPath} would be loaded INSTEAD of ${replaces}: the tool resolves it first, while this check keeps reading the ratcheted file, so every threshold, ignore list and gate in it could be swapped out unseen. Edit ${replaces} instead.`

/**
 * A directory prefix anywhere below the repo root that is not inside an
 * installed dependency: prettier and editorconfig resolve the nearest config
 * from every file `prettier --check .` reads, docs/ and templates/ included.
 */
const NESTED = String.raw`(?!(?:.*/)?node_modules/)(?:.+/)`
/** prettier's config file names besides package.json (the manifest check covers its key). */
const PRETTIER_CONFIG = String.raw`(?:package\.yaml|\.prettierrc(?:\.\w+)?|prettier\.config\.[cm]?[jt]s)`
const ROOT_PRETTIER = ".prettierrc.json"
/**
 * The one nested prettier config, checked before the shadow rule: the starter
 * (templates/composed-server, mirrored to a repo of its own) has no root config
 * above it. templatePrettierViolations holds it to the root's settings.
 */
export const TEMPLATE_PRETTIER = "templates/composed-server/.prettierrc.json"
/**
 * The starter's manifests (its root, server/, modules/<name>/): a `prettier`
 * key in one would beat TEMPLATE_PRETTIER for every file below it.
 */
const TEMPLATE_MANIFEST = new RegExp(
  String.raw`^templates/composed-server/(?!(?:.*/)?node_modules/)(?:.+/)?package\.json$`,
)

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
    // any prettier config in a directory below the root (ratchetKind classes
    // TEMPLATE_PRETTIER before this rule).
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
  if (relPath === TEMPLATE_PRETTIER) return "template-prettier"
  if (SHADOW_CONFIGS.some(({ pattern }) => pattern.test(relPath))) return "shadow-config"
  if (/^apps\/[^/]+\/test\/__golden__\/char-budgets\.json$/.test(relPath)) return "char-budgets"
  if (/^apps\/[^/]+\/test\/__golden__\/bundle-budget\.json$/.test(relPath)) return "bundle-budget"
  if (relPath === "package.json") return "root-scripts"
  if (new RegExp(`^${PKG}/package\\.json$`).test(relPath)) return "package-scripts"
  // The docs workspace and the starter's manifests pin no gate script; only
  // their `prettier` key is checked.
  if (relPath === "docs/package.json") return "workspace-manifest"
  if (TEMPLATE_MANIFEST.test(relPath)) return "template-manifest"
  return null
}

/** The ratchet kinds of a workspace package.json: each must carry no `prettier` key. */
const MANIFEST_KINDS = new Set([
  "root-scripts",
  "package-scripts",
  "workspace-manifest",
  "template-manifest",
])

// ── Source extraction (TypeScript AST, no evaluation, no imports) ───────────

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

/** A property's static name (also for `{ name }` shorthand) or undefined. */
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

/** TypeScript's wrappers that leave a value as it is at runtime: `( )`, `as`, `satisfies`, `<T>`, `!`. */
const isTypeWrapper = (node) =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node) ||
  ts.isNonNullExpression(node)

/** An expression without its type wrappers (`["a"] as const` is the array literal). */
function unwrapped(node) {
  let inner = node
  while (inner && isTypeWrapper(inner)) inner = inner.expression
  return inner
}

/** `read()` with `name` marked as being followed, so a cycle of constants ends. */
function following(seen, name, read) {
  seen.add(name)
  try {
    return read()
  } finally {
    seen.delete(name)
  }
}

/**
 * The string an entry holds when the ratchet sees all of it: a string literal,
 * a string constant of `consts`, or a template whose every part is one of
 * these or a literal; else undefined.
 */
function stringValue(node, consts, seen) {
  const value = unwrapped(node)
  if (ts.isIdentifier(value)) {
    const target = consts.get(value.text)
    if (!target || ts.isArrayLiteralExpression(target) || seen.has(value.text)) return undefined
    return following(seen, value.text, () => stringValue(target, consts, seen))
  }
  if (ts.isTemplateExpression(value)) {
    let text = value.head.text
    for (const span of value.templateSpans) {
      const part =
        stringValue(span.expression, consts, seen) ?? literalValue(unwrapped(span.expression))
      if (part === undefined) return undefined
      text += `${part}${span.literal.text}`
    }
    return text
  }
  const literal = literalValue(value)
  return typeof literal === "string" ? literal : undefined
}

/**
 * Array-literal elements as comparable strings: strings the ratchet sees
 * whole (stringValue), else normalized source. `consts` (name → initializer)
 * resolves an identifier or `...identifier` to the top-level array it names
 * and an entry to the string a constant holds, so moving a list or a glob
 * into a constant is not read as new entries. `unread` collects every
 * element read as its own text; null when `node` is no array the ratchet can
 * see.
 */
function arrayEntries(node, consts = new Map(), unread = [], seen = new Set()) {
  const value = unwrapped(node)
  if (value && ts.isIdentifier(value)) {
    const target = consts.get(value.text)
    if (!target || !ts.isArrayLiteralExpression(target) || seen.has(value.text)) return null
    return following(seen, value.text, () => arrayEntries(target, consts, unread, seen))
  }
  if (!value || !ts.isArrayLiteralExpression(value)) return null
  return value.elements.flatMap((element) => {
    if (ts.isSpreadElement(element)) {
      const spread = arrayEntries(element.expression, consts, unread, seen)
      if (spread) return spread
    }
    const text = stringValue(element, consts, seen)
    if (text !== undefined) return [text]
    unread.push(element)
    return [normalize(element.getText())]
  })
}

/** Top-level `name = …` variable declarations whose value `keep` takes (type wrappers dropped). */
function topLevelValues(sourceFile, keep) {
  const consts = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      const initializer = unwrapped(decl.initializer)
      if (ts.isIdentifier(decl.name) && initializer && keep(initializer))
        consts.set(decl.name.text, initializer)
    }
  }
  return consts
}

/** Top-level `const name = [ … ]` declarations of a source file (type wrappers dropped). */
const topLevelArrays = (sourceFile) => topLevelValues(sourceFile, ts.isArrayLiteralExpression)

const COVERAGE_METRICS = ["statements", "branches", "functions", "lines"]

/** The vitest keys whose value is a list of globs. */
const LIST_KEYS = ["include", "exclude"]

/**
 * Whether `member` is an `include`/`exclude` key of a `test` or `coverage`
 * block. extractVitestCoverage reads every such block or fails on the file
 * (a second root `test` or `coverage` block, a project `test` block it does
 * not reach), so the list in it is one the ratchet compares.
 */
function isListKeyOfBlock(member) {
  const block = member.parent
  const owner = block?.parent
  return (
    LIST_KEYS.includes(staticName(member.name)) &&
    ts.isObjectLiteralExpression(block) &&
    ts.isPropertyAssignment(owner) &&
    owner.initializer === block &&
    ["test", "coverage"].includes(staticName(owner.name))
  )
}

/**
 * Whether one read of an array constant leaves it as its literal shows it:
 * the value of an `include`/`exclude` key of a `test` or `coverage` block
 * (also as shorthand, also through type wrappers) or a spread, which copies
 * it. Anything else could change it at runtime (`EXTRA.push(…)`, a call, a
 * key of an object some function receives) or is no read of it at all.
 */
function keepsArrayAsWritten(identifier) {
  if (ts.isShorthandPropertyAssignment(identifier.parent))
    return isListKeyOfBlock(identifier.parent)
  let outer = identifier
  while (isTypeWrapper(outer.parent)) outer = outer.parent
  const reader = outer.parent
  if (ts.isSpreadElement(reader)) return true
  return ts.isPropertyAssignment(reader) && reader.initializer === outer && isListKeyOfBlock(reader)
}

/** Whether `parent.name` is a key, member or type name, never a value binding. */
const namedNotBinding = (parent) =>
  ts.isPropertyAssignment(parent) ||
  ts.isPropertyAccessExpression(parent) ||
  ts.isMethodDeclaration(parent) ||
  ts.isPropertyDeclaration(parent) ||
  ts.isGetAccessorDeclaration(parent) ||
  ts.isSetAccessorDeclaration(parent) ||
  ts.isPropertySignature(parent) ||
  ts.isMethodSignature(parent) ||
  ts.isEnumMember(parent) ||
  ts.isMetaProperty(parent) ||
  ts.isInterfaceDeclaration(parent) ||
  ts.isTypeAliasDeclaration(parent) ||
  ts.isTypeParameterDeclaration(parent)

/**
 * Whether an identifier declares or reads a value binding: not a key or
 * member name (`exclude:`, `coverageConfigDefaults.exclude`), the remote
 * name of an import, export or destructuring, a label or a name in a type.
 */
function namesBinding(identifier) {
  const parent = identifier.parent
  if (namedNotBinding(parent) && parent.name === identifier) return false
  if (
    (ts.isImportSpecifier(parent) || ts.isBindingElement(parent)) &&
    parent.propertyName === identifier
  )
    return false
  if (
    ts.isExportSpecifier(parent) &&
    parent.propertyName !== undefined &&
    parent.name === identifier
  )
    return false
  if (
    (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) &&
    parent.label === identifier
  )
    return false
  for (let up = parent; up; up = up.parent)
    if (ts.isTypeNode(up) && !ts.isExpressionWithTypeArguments(up)) return false
  return true
}

/** "import" or "local" when an identifier declares a value binding, else undefined. */
function bindingDeclared(identifier) {
  const parent = identifier.parent
  if (parent.name !== identifier) return undefined
  if (
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportEqualsDeclaration(parent)
  )
    return "import"
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isBindingElement(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isModuleDeclaration(parent)
  )
    return "local"
  return undefined
}

/** The values a vitest list may take from a constant: an array, or a string (literal or template). */
const isListValue = (node) =>
  ts.isArrayLiteralExpression(node) ||
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node)

const isExportedRead = (identifier) =>
  ts.isExportSpecifier(identifier.parent) || ts.isExportAssignment(identifier.parent)

/**
 * Why the ratchet cannot read a binding the file declares (`declared`: its
 * declaring identifiers, `value`: topLevelValues' initializer, `reads`: every
 * other identifier that names it), or undefined when it can.
 */
function constantProblem(declared, value, reads) {
  if (declared.length > 1) return "declared more than once"
  const decl = declared[0].parent
  const list = decl.parent
  if (
    !ts.isVariableDeclaration(decl) ||
    !ts.isVariableStatement(list.parent) ||
    !ts.isSourceFile(list.parent.parent)
  )
    return "no top-level const"
  if ((list.flags & ts.NodeFlags.Const) === 0) return "declared with let or var"
  // Declared once, so topLevelValues read this declaration, if it holds a list value.
  if (!value) return "its value is no array, string or template literal"
  // A string cannot change; an array can, through any code that reaches it.
  if (!ts.isArrayLiteralExpression(value)) return undefined
  if (
    list.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
    reads.some(isExportedRead)
  )
    return "exported, so another module can change it"
  if (!reads.every(keepsArrayAsWritten))
    return "named other than as an include/exclude list of a test or coverage block or in a spread, where a push, a call or another key can change it"
  return undefined
}

const EVAL_PROBLEM = "the file calls eval, which can change a binding without naming it"

/**
 * How a vitest config's include/exclude lists read the bindings the file
 * declares itself (an import's content is the other module's: a list keeps
 * reading it as one entry of its own text, `...coverageConfigDefaults.exclude`).
 * `consts` holds those a list may name, spread or write as shorthand and is
 * read through entry by entry, so the constant cannot change unseen by code
 * that names it; `unread` says for every other one why not, and a list entry
 * that names one is opaque with that reason (listEntries); `declarations`
 * and `reads` map each name to the identifiers that declare or read it. A
 * binding is read when the file declares its name once, as a top-level
 * `const` holding an array or a string (a literal, or a template of such
 * strings and literals), and, for an array, never exports it and names it
 * only as the value of an include/exclude key of a test or coverage block or
 * in a spread (keepsArrayAsWritten). Only a name that declares or reads the
 * binding counts (namesBinding): a key, a member name, a label or a type
 * does not. A direct `eval` reaches a binding without naming it, so a file
 * that names eval has none read. The reader does not run the file: a list
 * changed through the config object after the config was built is out of its
 * sight, a literal one as much as one from a constant.
 */
function vitestListConstants(sourceFile) {
  const values = topLevelValues(sourceFile, isListValue)
  const declarations = new Map()
  const reads = new Map()
  walk(sourceFile, (node) => {
    if (!ts.isIdentifier(node) || !namesBinding(node)) return
    const into = bindingDeclared(node) ? declarations : reads
    if (!into.has(node.text)) into.set(node.text, [])
    into.get(node.text).push(node)
  })
  const consts = new Map()
  const unread = new Map()
  for (const [name, declared] of declarations) {
    if (declared.every((identifier) => bindingDeclared(identifier) === "import")) continue
    const problem = reads.has("eval")
      ? EVAL_PROBLEM
      : constantProblem(declared, values.get(name), reads.get(name) ?? [])
    if (problem) unread.set(name, problem)
    else consts.set(name, values.get(name))
  }
  return { consts, unread, declarations, reads }
}

const isWithin = (node, ancestor) => {
  for (let up = node; up; up = up.parent) if (up === ancestor) return true
  return false
}

/** Whether `name` is a binding the file declares itself (vitestListConstants). */
const isOwnBinding = (name, lists) => lists.consts.has(name) || lists.unread.has(name)

/**
 * Why each binding of the file an entry read as its own text names was not
 * read through, as name -> reason; a name the entry declares itself (a
 * callback's parameter) is pinned by the entry's text.
 */
function unreadBindings(entry, lists) {
  const found = new Map()
  walk(entry, (node) => {
    if (!ts.isIdentifier(node) || !namesBinding(node) || bindingDeclared(node)) return
    const declared = lists.declarations.get(node.text) ?? []
    if (!declared.some((id) => bindingDeclared(id) === "local" && !isWithin(id, entry))) return
    const value = lists.consts.get(node.text)
    found.set(
      node.text,
      lists.unread.get(node.text) ??
        (!ts.isArrayLiteralExpression(value) &&
        stringValue(value, lists.consts, new Set([node.text])) === undefined
          ? "its template holds a part the ratchet cannot read"
          : "the ratchet reads a constant only as a whole list, a spread, an entry or a template part"),
    )
  })
  return found
}

/**
 * The code an unread binding's content hangs on, as far as the file shows
 * it: around every declaration and read of `names`, and in turn of every
 * binding of the file (and `eval`) that code names, the statement or member
 * next to the one that holds `entry` (the config itself), normalized in file
 * order. A helper the binding is passed to is in it; code that reaches the
 * binding through the config object is not.
 */
function bindingTrace(names, entry, lists) {
  const units = new Set()
  const queue = lists.reads.has("eval") ? [...names, "eval"] : [...names]
  const done = new Set()
  while (queue.length > 0) {
    const name = queue.pop()
    if (done.has(name)) continue
    done.add(name)
    const occurrences = [...(lists.declarations.get(name) ?? []), ...(lists.reads.get(name) ?? [])]
    for (const occurrence of occurrences) {
      if (isWithin(occurrence, entry)) continue
      let unit = occurrence
      while (unit.parent && !isWithin(entry, unit.parent)) unit = unit.parent
      if (units.has(unit)) continue
      units.add(unit)
      walk(unit, (node) => {
        if (ts.isIdentifier(node) && namesBinding(node) && isOwnBinding(node.text, lists))
          queue.push(node.text)
      })
    }
  }
  return [...units]
    .sort((a, b) => a.pos - b.pos)
    .map((unit) => normalize(unit.getText()))
    .join(";")
}

/**
 * Entries of an `include`/`exclude` list (arrayEntries over the file's
 * constants, else the list's own text). An entry read as its own text that
 * names a binding of the file lands in `opaque` as `where: entry (name:
 * reason) from <trace>` (bindingTrace): a config may not introduce one, and
 * once there it is frozen like any other opaque member, its trace with it,
 * so an edit to the code the binding hangs on reads as a new one.
 */
function listEntries(node, lists, where, opaque) {
  const unread = []
  const entries = arrayEntries(node, lists.consts, unread)
  if (!entries) unread.push(node)
  for (const entry of unread) {
    const bindings = unreadBindings(entry, lists)
    if (bindings.size === 0) continue
    const reasons = [...bindings].map(([name, reason]) => `${name}: ${reason}`).join("; ")
    const trace = bindingTrace(bindings.keys(), entry, lists)
    opaque.push(`${where}: ${normalize(entry.getText())} (${reasons}) from ${trace}`)
  }
  return entries ?? [normalize(node.getText())]
}

/**
 * A member of a vitest `test`, `coverage` or project `test` block as `{ key,
 * value }`: a `key: value` assignment, or an `include`/`exclude` shorthand
 * of a binding the file declares (read as `exclude: exclude`, see
 * listEntries); undefined for any other member (a spread, another shorthand,
 * a method or accessor), which the caller keeps opaque.
 */
function readableMember(member, lists) {
  if (ts.isPropertyAssignment(member))
    return { key: staticName(member.name), value: member.initializer }
  const name = ts.isShorthandPropertyAssignment(member) ? member.name.text : undefined
  if (LIST_KEYS.includes(name) && (lists.consts.has(name) || lists.unread.has(name)))
    return { key: name, value: member.name }
  return undefined
}

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
 * a project (but an `include`/`exclude` shorthand of a binding the file
 * declares, see readableMember) land in `opaque`, so does a list entry that names a binding
 * of the file the ratchet cannot read through (listEntries). `lists`:
 * vitestListConstants.
 */
function readProjects(node, opaque, lists) {
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
      const read = readableMember(member, lists)
      if (!read) {
        opaque.push(`${label}: ${normalize(member.getText())}`)
        continue
      }
      if (LIST_KEYS.includes(read.key))
        project[read.key] = listEntries(read.value, lists, `${label}.${read.key}`, opaque)
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
 * extends }`, see readProjects). The include and exclude lists read the
 * file's constants (vitestListConstants) entry by entry, by name, spread or
 * shorthand. `opaque` holds every member the ratchet cannot read: a spread
 * or shorthand inside coverage or test (but an `include`/`exclude` shorthand
 * of a binding the file declares), a list entry that names a binding of the
 * file it cannot read through, with the reason (listEntries), a non-literal
 * threshold, and every computed key of the file whose name is no literal
 * (`[KEY]: ...` could BE coverage, test, thresholds or enabled).
 * `usesShared`: the config passes `sharedConfig` (vitest.shared.ts, where
 * coverage is ENABLED) into a call such as `mergeConfig`; vitest's own
 * default is coverage off.
 */
export function extractVitestCoverage(relPath, text) {
  const blocks = []
  const testBlocks = []
  const computed = []
  let usesShared = false
  const sourceFile = parseSource(relPath, text)
  const lists = vitestListConstants(sourceFile)
  walk(sourceFile, (node) => {
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
      return { error: "`test` is not an object literal: the ratchet cannot read it" }
    for (const prop of rootTest.properties) {
      const member = readableMember(prop, lists)
      if (!member) {
        // A spread or shorthand could carry include/exclude the AST cannot see.
        result.opaque.push(`test: ${normalize(prop.getText())}`)
        continue
      }
      const { key: name, value } = member
      if (name === "include")
        result.testInclude = listEntries(value, lists, "test.include", result.opaque)
      else if (name === "exclude")
        result.testExclude = listEntries(value, lists, "test.exclude", result.opaque)
      else if (name === "projects") {
        const read = readProjects(value, result.opaque, lists)
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
    return { error: `${blocks.length} \`coverage\` blocks, but the ratchet needs exactly one` }
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
    return { error: "`coverage` is not an object literal: the ratchet cannot read it" }
  for (const prop of coverage.properties) {
    const member = readableMember(prop, lists)
    if (!member) {
      // A spread or shorthand could carry thresholds/exclude the AST cannot see.
      result.opaque.push(normalize(prop.getText()))
      continue
    }
    const { key: name, value } = member
    if (name === "thresholds") {
      Object.assign(result, readThresholds(value, result.opaque))
    } else if (name === "exclude") {
      result.exclude = listEntries(value, lists, "coverage.exclude", result.opaque)
    } else if (name === "include") {
      result.include = listEntries(value, lists, "coverage.include", result.opaque)
    } else if (name === "enabled") {
      const literal = literalValue(value)
      result.enabled = typeof literal === "boolean" ? literal : normalize(value.getText())
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

const isDynamicImport = (node) =>
  ts.isCallExpression(node) &&
  (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require"))

/** The rules the architecture and budget gates set, never relaxed per file. */
const GATE_RULES = ["complexity", "max-lines", "no-restricted-syntax"]

/**
 * What the source of eslint.config.mjs shows that the effective-config
 * comparison cannot:
 * - `ignores`: every entry of every exempting `ignores` list, keyed by the
 *   scope it exempts from (see ignoresScope), whatever rule the block sets;
 * - `imports`: every local or dynamic import. The base config is evaluated
 *   from a sibling file, so a local module it imports would be today's.
 */
export function extractEslintRatchets(relPath, text) {
  const sourceFile = parseSource(relPath, text)
  const ignores = []
  const imports = []
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text
      if (specifier.startsWith(".")) imports.push(`local import "${specifier}"`)
    }
  }
  const consts = topLevelArrays(sourceFile)
  walk(sourceFile, (node) => {
    if (isDynamicImport(node)) imports.push(`dynamic import \`${normalize(node.getText())}\``)
    if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) return
    if (propName(node.name) !== "ignores" || !isExemptionBlock(node.parent)) return
    const value = ts.isShorthandPropertyAssignment(node) ? node.name : node.initializer
    const scope = ignoresScope(node.parent)
    for (const entry of arrayEntries(value, consts) ?? [normalize(value.getText())])
      ignores.push(`${scope} :: ${entry}`)
  })
  return { ignores, imports }
}

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
 * project file, so these may never appear, and never shrink.
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
 * of every token. JSX text and JSDoc nodes are skipped: their text is not
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
 * complexity / max-lines / no-restricted-syntax (or no rule, which is every
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
        `${relPath}:${lines.join(",")} -> new inline \`${directive}\` (${had} -> ${lines.length}). An inline suppression is an exemption the config ratchets cannot see. Fix the code instead (split the function or file, register through the registrar, write the test).`,
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
        `${relPath} -> ${key} lost "${entry}". Include lists only grow: narrowing them measures less.`,
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
        `${relPath} -> ${label}.${metric}: ${was} -> ${now}. Ratchets are raise-only. Write the missing tests instead (pnpm --filter <pkg> test prints the uncovered files).${kinds}`,
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

/** What the ratchet reads in a vitest config, for the message on an opaque member. */
const VITEST_READS =
  "The ratchet reads literals, and a constant of the file only where it sees all the constant can hold (a top-level const string, or a const array the file names only as an include/exclude list or in a spread); for one it cannot read, the reason follows its name in parentheses"

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
      `${relPath} -> spread/shorthand or non-literal \`${entry}\` in a vitest config with nothing to compare against. ${VITEST_READS}: inline the values, or it can never see them change.`,
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
      `${relPath}: ${cur.error}. A ratchet the gate cannot read is a disabled ratchet. Keep the literal \`coverage: { thresholds: { … } }\` shape.`,
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
        `${relPath} -> new coverage.exclude entry "${entry}". The measured surface only grows: excluding code the default run CAN execute "raises" coverage by measuring less.`,
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
        `${relPath} -> new test.exclude entry "${entry}". Tests that never run never load the code they cover; the measured surface only grows.`,
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
      `${relPath} no longer merges sharedConfig and does not enable coverage itself: the thresholds would never be enforced.`,
    )
  }
  for (const entry of cur.opaque) {
    if (!old.opaque.includes(entry)) {
      violations.push(
        `${relPath} -> new spread/shorthand or non-literal \`${entry}\` in the vitest config. ${VITEST_READS}: inline the values (a spread written after the literals overrides them at runtime).`,
      )
    }
  }
  return violations
}

/** Stryker options that only shape reports, caching or parallelism: free to change. */
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
      `${relPath} was removed. The mutation gate needs it: removing it drops the package out of the nightly mutation run.`,
    ]
  }
  const oldBreak = oldJson?.thresholds?.break
  const newBreak = newJson?.thresholds?.break
  const breakRaised =
    typeof newBreak === "number" && typeof oldBreak === "number" && newBreak > oldBreak
  if (typeof oldBreak === "number" && (typeof newBreak !== "number" || newBreak < oldBreak)) {
    violations.push(
      `${relPath} -> thresholds.break: ${oldBreak} -> ${String(newBreak)}. The mutation floor is raise-only. Kill the surviving mutants (write the missing assertions) instead of lowering it.`,
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
      `${relPath} -> mutate allowlist shrank (${shrinkers.join(", ")}) without raising thresholds.break. Shrinking the measured surface "improves" the score by measuring less; it is allowed ONLY together with a break raise for the remaining surface.`,
    )
  }
  const oldExcluded = oldJson?.mutator?.excludedMutations ?? []
  for (const mutation of newJson?.mutator?.excludedMutations ?? []) {
    if (!oldExcluded.includes(mutation)) {
      violations.push(
        `${relPath} -> new mutator.excludedMutations entry "${mutation}". Excluding mutators measures less. Kill the mutants instead.`,
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
        `${relPath} -> "${key}" changed (${was ?? "unset"} -> ${now ?? "unset"}). Outside mutate/thresholds every Stryker option decides which mutants exist or how they count (ignoreStatic, ignorers, mutator.plugins, the test runner and its config; a timed-out mutant counts as killed, so timeoutMS too): pinned to the merge base.`,
      )
    }
  }
  return violations
}

function compareEslint(relPath, oldText, newText) {
  if (newText === null) return [`${relPath} was removed: every ESLint gate goes with it.`]
  const old = extractEslintRatchets(relPath, oldText)
  const cur = extractEslintRatchets(relPath, newText)
  const violations = []
  for (const entry of cur.imports) {
    if (!old.imports.includes(entry)) {
      violations.push(
        `${relPath} -> new ${entry}. The effective-config comparison evaluates the base config next to today's files, so an imported module would be read in its new state; inline it instead.`,
      )
    }
  }
  for (const entry of cur.ignores) {
    if (!old.ignores.includes(entry)) {
      const [scope, glob] = entry.split(" :: ")
      violations.push(
        `${relPath} -> new \`ignores\` entry "${glob}" (exempts from: ${scope}). Ignore lists are shrink-only per block: an ignored file escapes every gate in that block, and the global ignores exempt it from every rule.`,
      )
    }
  }
  return violations
}

function compareKnip(relPath, oldJson, newJson) {
  if (newJson === null) {
    return [
      `${relPath} was removed: knip then runs on its defaults or on whichever knip.json/knip.ts it finds, and every ratcheted list goes with it.`,
    ]
  }
  const oldIgnores = collectKnipIgnores(oldJson)
  const violations = []
  for (const entry of collectKnipIgnores(newJson)) {
    if (!oldIgnores.has(entry)) {
      violations.push(
        `${relPath} -> new "${entry}". knip's ignore lists, issue-type excludes, relaxed rules and entry globs are shrink-only: each makes knip report less (an entry marks files as used). Delete the dead code / declare the dependency instead.`,
      )
    }
  }
  const oldScopes = collectKnipScopes(oldJson)
  for (const [key, entries] of collectKnipScopes(newJson)) {
    const before = oldScopes.get(key)
    if (!before) {
      violations.push(
        `${relPath} -> "${key.split(".").pop()}" appeared at ${key}. knip checks every issue type and every project file by default, so an include/project list can only narrow that.`,
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
    `${relPath} -> "${name}": ${from} -> ${to} model-visible characters. The surface a model reads (tools/list plus the server instructions) is shrink-only: trim descriptions, schemas or instructions, or justify the growth with a Ratchet-Exception trailer.`,
  "bundle-budget": (relPath, name, from, to) =>
    `${relPath} -> "${name}": ${from} -> ${to} bytes (what the file's $comment says it measures). A shipped bundle's ceiling is shrink-only: every view resource inlines the widget bundle, the extension ships its webview, every npm install of the CLI downloads its dist. Shrink the bundle, or justify the growth with a Ratchet-Exception trailer.`,
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
const DIRECT_ROOT_GATES = ["build", "typecheck", "format:check"]
/** The only shape a NEW chain segment may take. */
const PLAIN_PNPM_SEGMENT = /^pnpm (?:run )?([\w:-]+)$/
/** Per-package scripts that turbo runs as gates. */
const PACKAGE_GATES = ["lint", "typecheck", "test"]
/**
 * Per-package scripts a CI or release job runs by name (.github/workflows/ci.yml,
 * publish-vscode-extension.yml): the job checks what the command does, so the command is pinned
 * like a gate once it exists on the merge base.
 */
const CI_PACKAGE_SCRIPTS = [
  "test:engines",
  "test:smoke",
  "package",
  "marketplace:publish",
  "open-vsx:publish",
]

/**
 * Why `after` is not the pinned gate command `before`, or null when it is,
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
    return `now excludes ${grown.map((kind) => `"${kind}"`).join(", ")}, but an --exclude list only shrinks (the command is otherwise pinned to the merge base)`
  }
  return `changed: "${normalizeCommand(before)}" -> "${normalizeCommand(after)}". Gate commands are pinned to the merge base: an added argument (a base ref, \`|| true\`, \`--include\`, \`--config\`, a test-name filter) hollows a gate as surely as a removed one; a deliberate change carries the Ratchet-Exception trailer`
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
          `${relPath} -> \`pnpm ${name}\` gained "${segment}". The chain only grows by plain \`pnpm <script>\` gates: any other command or shell operator (\`||\`, \`;\`, \`|\`, \`exit\`) can end the chain early or swallow its exit code.`,
        )
      }
    }
  }
  for (const script of [...pinned].sort()) {
    if (typeof oldScripts[script] !== "string") continue
    if (typeof newScripts[script] !== "string") {
      violations.push(
        `${relPath} -> "${script}" was removed: a gate CI runs or chains goes with it.`,
      )
      continue
    }
    const change = gateCommandChange(oldScripts[script], newScripts[script])
    if (change) violations.push(`${relPath} -> the "${script}" gate ${change}.`)
  }
  if (newJson && Object.hasOwn(newJson, "knip")) {
    violations.push(
      `${relPath} -> a \`knip\` key (package.json#knip). knip merges it UNDER knip.jsonc, so every key knip.jsonc leaves out (include, exclude, rules, ignore…) would come from here, unratcheted. Keep the knip config in knip.jsonc.`,
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
        `${relPath} -> "${script}" was removed: turbo then skips the package's ${script} gate silently.`,
      )
    } else if (normalizeCommand(before) !== normalizeCommand(after)) {
      violations.push(
        `${relPath} -> the "${script}" gate changed: "${normalizeCommand(before)}" -> "${normalizeCommand(after)}". A package's gate commands are pinned to the merge base: \`--coverage.enabled=false\`, \`--rule 'complexity: off'\`, \`|| true\` or a dropped \`tsc -p\` project switch the gate off while the command still "runs" it. A deliberate change carries the Ratchet-Exception trailer.`,
      )
    }
  }
  for (const script of CI_PACKAGE_SCRIPTS) {
    const before = oldJson?.scripts?.[script]
    if (typeof before !== "string") continue
    const after = newJson?.scripts?.[script]
    if (typeof after !== "string") {
      violations.push(`${relPath} -> "${script}" was removed: a CI or release job runs it by name.`)
    } else if (normalizeCommand(before) !== normalizeCommand(after)) {
      violations.push(
        `${relPath} -> the "${script}" script changed: "${normalizeCommand(before)}" -> "${normalizeCommand(after)}". A CI or release job runs it by name, so it is pinned to the merge base like a gate: a dropped step or an \`|| true\` hollows the job while it stays green. A deliberate change carries the Ratchet-Exception trailer.`,
      )
    }
  }
  return violations
}

function shadowViolation(relPath) {
  return SHADOW_CONFIGS.find(({ pattern }) => pattern.test(relPath)).message(relPath)
}

/**
 * The starter's prettier config (`newText`) against the root one (`rootText`,
 * same side): exactly the root's settings without `overrides`, every one of
 * them dropped, a generic glob too. prettier formats the starter's files with
 * this copy, here and in a starter repo, so any other setting is a style of
 * its own, and no root override reaches the starter's files.
 */
function templatePrettierViolations(newText, rootText) {
  if (newText === null || newText === undefined) return []
  let copy
  let root
  try {
    copy = JSON.parse(newText)
  } catch {
    return invalidJson(TEMPLATE_PRETTIER)
  }
  try {
    root = JSON.parse(rootText ?? "")
  } catch {
    return [
      `${TEMPLATE_PRETTIER} copies the root ${ROOT_PRETTIER}, which is missing or not valid JSON: nothing holds the starter's style to the workspace's. Restore the root ${ROOT_PRETTIER}.`,
    ]
  }
  const settings = Object.fromEntries(
    Object.entries(root ?? {}).filter(([key]) => key !== "overrides"),
  )
  if (isDeepStrictEqual(copy, settings)) return []
  return [
    `${TEMPLATE_PRETTIER} is not the root ${ROOT_PRETTIER} without \`overrides\`: it holds ${JSON.stringify(copy)}, the root ${JSON.stringify(settings)}. prettier formats the starter's files with this copy, in this repo and in a starter repo, so a difference is a style the root does not set (\`requirePragma: true\` even skips every file without a pragma). Change the style in the root ${ROOT_PRETTIER} and copy its settings, without \`overrides\`, here.`,
  ]
}

/**
 * A workspace package.json key that configures a gate's tool where no
 * ratchet looks: prettier reads a package.json `prettier` key BEFORE any
 * .prettierrc in the same directory, so a nested one formats its package in
 * a foreign style and the root one would replace .prettierrc.json itself.
 */
function manifestKeyViolations(relPath, json) {
  if (!json || typeof json !== "object" || !Object.hasOwn(json, "prettier")) return []
  const fix = TEMPLATE_MANIFEST.test(relPath)
    ? `The starter's style is the root's: change the root .prettierrc.json and copy its settings, without \`overrides\`, into ${TEMPLATE_PRETTIER}`
    : `Per-app style goes into the root .prettierrc.json \`overrides\` (\`"files": ["apps/<app>/**"]\`)`
  return [
    `${relPath} -> a \`prettier\` key (package.json#prettier). prettier reads it before any .prettierrc in the same directory, so every file below it would be formatted, and pass format:check, in a style the root .prettierrc.json does not set. ${fix}; delete the key.`,
  ]
}

/** A ratchet file that does not parse: fails whatever the base held. */
const invalidJson = (relPath) => [
  `${relPath} is not valid JSON: a broken ratchet file disables the gate.`,
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
 * `readNew(repoRelPath)` reads another file of the new side (the root
 * .prettierrc.json the starter's copy must equal), null when it is absent.
 */
export function checkRatchetFile(
  relPath,
  oldText,
  newText,
  fileExists = () => true,
  readNew = () => null,
) {
  const kind = ratchetKind(relPath)
  // A shadowing config fails whenever it exists: introducing one is the attack.
  if (kind === "shadow-config")
    return newText === null || newText === undefined ? [] : [shadowViolation(relPath)]
  // The starter's copy is a state too: it equals the root config or fails.
  if (kind === "template-prettier")
    return templatePrettierViolations(newText, readNew(ROOT_PRETTIER))
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
  if (kind === "workspace-manifest" || kind === "template-manifest")
    return manifestKeyViolations(relPath, newJson)
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

// ── The range: which commit made each violation ─────────────────────────────

/**
 * A violation's identity across the commits of the range: its message with
 * every number and every quoted `"from" -> "to"` pair normalized, so a budget
 * raised twice (86058 -> 86500, then 86500 -> 87000) is the same violation
 * in each step and in the net comparison (86058 -> 87000). The file the
 * message names stays part of it.
 */
export function violationKey(message) {
  return message
    .replace(/"[^"\n]*" -> "[^"\n]*"/g, '"…" -> "…"')
    .replace(/(?<![\w.])-?\d+(?:[.,]\d+)*(?!\w)/g, "#")
}

/** A violation as the attribution reads it: its message and the keys it is made of. */
const plainViolation = (message) => ({ message, keys: [violationKey(message)] })

/**
 * Which commits make each net violation, and whether their trailers cover it.
 * `steps` is one entry per commit of the range plus the uncommitted changes,
 * `{ commit: { sha, subject, merge, trailers }, keys: Set<key> }`. A violation is
 * waved only when every one of its keys is made by at least one step AND
 * every step that makes one carries a trailer:
 * - `waved`: all its makers carry a trailer (`commits` lists them);
 * - `untrailered`: a maker carries none (`commits` lists those), e.g. a
 *   violation made in A and made again in B where only B carries one;
 * - `drift`: no single step makes it, the steps only add up to it, so no
 *   trailer can cover it (fail-closed).
 */
function attributeViolations(violations, steps) {
  return violations.map((violation) => {
    const makers = new Map()
    for (const key of violation.keys) {
      const reporters = steps.filter((step) => step.keys.has(key))
      if (reporters.length === 0) return { violation, verdict: "drift", commits: [] }
      for (const { commit } of reporters) makers.set(commit.sha, commit)
    }
    const commits = [...makers.values()]
    const bare = commits.filter((commit) => commit.trailers.length === 0)
    return bare.length > 0
      ? { violation, verdict: "untrailered", commits: bare }
      : { violation, verdict: "waved", commits }
  })
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/** Sources the inline-suppression scan and the effective ESLint config cover. */
const SOURCE_FILE = /^(?:apps|packages)\/(?!(?:.*\/)?node_modules\/).*\.(?:[cm]?[jt]s|[jt]sx)$/

/** The side that is no commit: the working tree, uncommitted changes included. */
const WORKTREE = "<working tree>"
/** git's empty tree: the parent side of a root commit. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
/** The uncommitted changes as a step of the range: never a trailer. */
const UNCOMMITTED = { sha: WORKTREE, subject: "uncommitted changes", trailers: [] }

const lines = (text, separator = "\n") => text.split(separator).filter(Boolean)

/**
 * The variables that point git at another repository, index or object store
 * than the one its working directory holds. A git hook exports `GIT_DIR`
 * (githooks(5)); inherited, it would make every read below go to that
 * repository instead of `root`.
 */
const RELOCATING_GIT_VARS = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
])

/**
 * The repository at `root`, which the check reads. Every read is cached, so a
 * commit's file texts, tree and suppression candidates are read once however
 * many steps of the replay need them. `WORKTREE` stands for the working tree.
 * git runs with the process's environment minus `RELOCATING_GIT_VARS`, so
 * `root` alone decides the repository.
 */
function openRepo(root) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !RELOCATING_GIT_VARS.has(name)),
  )
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    })
  const cache = new Map()
  const once = (key, compute) => {
    if (!cache.has(key)) cache.set(key, compute())
    return cache.get(key)
  }
  const listed = () =>
    once("listed", () => lines(git("ls-files", "--cached", "--others", "--exclude-standard")))
  const exists = (rev, rel) =>
    rev === WORKTREE ? fs.existsSync(path.join(root, rel)) : tree(rev).has(rel)
  const tree = (rev) =>
    rev === WORKTREE
      ? once("tree:worktree", () => new Set(listed().filter((rel) => exists(WORKTREE, rel))))
      : once(
          `tree:${rev}`,
          () => new Set(rev === EMPTY_TREE ? [] : lines(git("ls-tree", "-r", "--name-only", rev))),
        )
  return {
    root,
    git,
    listed,
    exists,
    tree,
    /** A file's text on `rev`, null when it is absent there. */
    read(rev, rel) {
      if (rev === WORKTREE)
        return exists(rev, rel) ? fs.readFileSync(path.join(root, rel), "utf8") : null
      return tree(rev).has(rel)
        ? once(`blob:${rev}:${rel}`, () => git("show", `${rev}:${rel}`))
        : null
    },
    /** The files `to` changes against `from` (renames as delete + add). */
    changed(from, to) {
      if (to !== WORKTREE)
        return lines(
          git("diff", "--name-only", "--no-renames", "--no-ext-diff", "-z", from, to),
          "\0",
        )
      return [
        ...new Set([
          ...lines(git("diff", "--name-only", "--no-renames", "--no-ext-diff", "-z", from), "\0"),
          ...lines(git("ls-files", "--others", "--exclude-standard", "-z"), "\0"),
        ]),
      ]
    },
    /**
     * The sources of `rev` that mention a suppression (the cheap pre-filter):
     * every one under apps/ and packages/, or only those of `paths`.
     */
    suppressionCandidates(rev, paths) {
      const grep = (pathspecs) => {
        try {
          return lines(
            git("grep", "-l", "-I", "-i", "-E", SUPPRESSION_GREP, rev, "--", ...pathspecs),
          ).map((line) => line.slice(line.indexOf(":") + 1))
        } catch {
          return [] // exit 1: no such file mentions a suppression
        }
      }
      if (!paths) return once(`grep:${rev}`, () => new Set(grep(["apps", "packages"])))
      const found = new Set()
      for (let i = 0; i < paths.length; i += 500)
        for (const rel of grep(paths.slice(i, i + 500).map((p) => `:(literal)${p}`))) found.add(rel)
      return found
    },
    isAncestor(rev, of) {
      try {
        git("merge-base", "--is-ancestor", rev, of)
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * The inline suppressions `to` adds against `from` in the source files of
 * `files`. `scoped`: pre-filter only those files on each side (one step of
 * the replay) instead of every source of `from` (the net comparison).
 */
function suppressionViolations(repo, from, to, files, { scoped = false } = {}) {
  const sources = files.filter((rel) => SOURCE_FILE.test(rel))
  if (sources.length === 0) return []
  const after = to === WORKTREE ? null : repo.suppressionCandidates(to, sources)
  const before = repo.suppressionCandidates(from, scoped ? sources : undefined)
  const violations = []
  for (const rel of sources) {
    if (after && !after.has(rel)) continue
    const newText = repo.read(to, rel)
    if (newText === null || !SUPPRESSION_HINT.test(newText)) continue
    const oldText = before.has(rel) ? repo.read(from, rel) : null
    violations.push(...compareSuppressions(rel, oldText, newText))
  }
  return violations
}

/**
 * The effective ESLint half's state for one run at `root`: a temporary
 * sibling file per distinct eslint.config.mjs text (same directory: same
 * `import.meta.dirname`, same package resolution; `.gitignore` lists them for
 * an interrupted run) and one shared config reader, so each config text is
 * evaluated once however many steps of the replay compare it.
 */
function eslintConfigs(root) {
  const siblings = new Map()
  let loaded
  return {
    /** eslint-effective-config.mjs, loaded on first use, and the run's reader. */
    load() {
      loaded ??= import("./eslint-effective-config.mjs").then((module) => ({
        findings: module.effectiveLooseningFindings,
        readConfig: module.effectiveConfigReader(root),
      }))
      return loaded
    },
    /** The sibling file that holds `text`, written on first use. */
    sibling(text) {
      if (!siblings.has(text)) {
        const file = path.join(root, `.check-ratchets-${process.pid}-${siblings.size}.eslint.mjs`)
        fs.writeFileSync(file, text)
        siblings.set(text, file)
      }
      return siblings.get(text)
    },
    cleanup() {
      for (const file of siblings.values()) fs.rmSync(file, { force: true })
    },
  }
}

/**
 * The keys a finding of the effective ESLint half is made of: one per file,
 * and for a no-restricted-syntax selector loss one per file and lost
 * selector, since the reason names only one of them as an example (a second
 * carve-out of the same file in another commit is another key).
 */
const effectiveKeys = (rel, { reason, files, lost }) =>
  files.flatMap((file) =>
    lost[file]
      ? lost[file].map(
          (selector) =>
            `${rel} -> no-restricted-syntax loses ${JSON.stringify(selector)} @ ${file}`,
        )
      : [`${violationKey(`${rel} -> ${reason}`)} @ ${file}`],
  )

/**
 * The effective-config half of the ESLint ratchet, `from` -> `to`, whenever
 * eslint.config.mjs differs between them. Each commit's text is evaluated
 * from its sibling file (`eslint`, eslintConfigs); the working tree's config
 * is evaluated in place. The config imports nothing local, which the AST half
 * enforces. One violation per reason, keyed by `effectiveKeys`. `alsoProbe`:
 * paths probed besides the sources of `to` (a replay step probes the files
 * the net findings name, so a file added later under an exemption belongs to
 * the step that made it).
 */
async function effectiveEslintViolations(repo, eslint, from, to, alsoProbe = []) {
  const rel = "eslint.config.mjs"
  const baseText = repo.read(from, rel)
  const newText = repo.read(to, rel)
  if (baseText === null || newText === null || baseText === newText) return []
  try {
    const { findings, readConfig } = await eslint.load()
    const found = await findings({
      cwd: repo.root,
      baseConfigFile: eslint.sibling(baseText),
      newConfigFile: to === WORKTREE ? path.join(repo.root, rel) : eslint.sibling(newText),
      files: [...[...repo.tree(to)].filter((file) => SOURCE_FILE.test(file)), ...alsoProbe],
      label: rel,
      readConfig,
    })
    return found.map((finding) => ({
      message: finding.message,
      effectiveFiles: finding.files,
      keys: effectiveKeys(rel, finding),
    }))
  } catch (error) {
    return [
      plainViolation(
        `${rel} -> the effective-config comparison could not run (${String(error?.message ?? error).split("\n")[0]}). A ratchet the gate cannot evaluate is a disabled ratchet.`,
      ),
    ]
  }
}

/** The ratchet violations of one ratchet file, `from` -> `to`. */
const ratchetFileViolations = (repo, rel, from, to) =>
  checkRatchetFile(
    rel,
    repo.read(from, rel),
    repo.read(to, rel),
    (file) => repo.exists(to, file),
    (file) => repo.read(to, file),
  )

const isComparedRatchet = (rel) => {
  const kind = ratchetKind(rel)
  return kind !== null && !(MUTATION_PAUSED && kind === "stryker")
}

/** The net comparison: every ratchet file and source, merge base -> working tree. */
async function netViolations(repo, eslint, mergeBase) {
  const ratchets = (files) => files.filter((file) => ratchetKind(file) !== null)
  const baseFiles = new Set(ratchets([...repo.tree(mergeBase)]))
  const messages = []
  for (const rel of [...new Set([...baseFiles, ...ratchets(repo.listed())])].sort()) {
    if (isComparedRatchet(rel))
      messages.push(...ratchetFileViolations(repo, rel, mergeBase, WORKTREE))
  }
  messages.push(...suppressionViolations(repo, mergeBase, WORKTREE, repo.listed()))
  const violations = messages.map(plainViolation)
  violations.push(...(await effectiveEslintViolations(repo, eslint, mergeBase, WORKTREE)))
  return { violations, baseFileCount: baseFiles.size }
}

/**
 * The side a step compares a ratchet file with: its parent's, or the merge
 * base's when the step brings the file back to a path the base holds and the
 * parent does not (an earlier step of the range removed it). Against the
 * parent such a file reads as introduced, and what it changes against the base
 * would add up from two steps, which no trailer can cover; the step that
 * brings it back decides what the path holds, so it carries the trailer.
 * Ratchet files only: the effective ESLint probe of a path still compares each
 * step with its parent, so a budget an earlier step took off a path and no step
 * puts back stays that earlier step's finding.
 */
const stepSide = (repo, rel, from, to, mergeBase) =>
  mergeBase !== undefined &&
  !repo.exists(from, rel) &&
  repo.exists(to, rel) &&
  repo.exists(mergeBase, rel)
    ? mergeBase
    : from

/**
 * One step of the replay: the same checks over the files `to` changes
 * against `from` only, so a state (a shadow config, a broken file) belongs
 * to the step that made it. The effective ESLint half runs only when the
 * net comparison has a finding of it to attribute (`effectiveFiles`: the
 * files those findings name, probed in every step that changes the config).
 */
async function stepKeys(repo, eslint, from, to, { effectiveFiles, mergeBase }) {
  const changed = repo.changed(from, to)
  const messages = changed
    .filter(isComparedRatchet)
    .flatMap((rel) =>
      ratchetFileViolations(repo, rel, stepSide(repo, rel, from, to, mergeBase), to),
    )
  messages.push(...suppressionViolations(repo, from, to, changed, { scoped: true }))
  const violations = messages.map(plainViolation)
  if (effectiveFiles.length > 0 && changed.includes("eslint.config.mjs"))
    violations.push(...(await effectiveEslintViolations(repo, eslint, from, to, effectiveFiles)))
  return new Set(violations.flatMap(({ keys }) => keys))
}

/**
 * The commits of the range, oldest first, each with the parent its step
 * compares against: the first parent, except for a merge whose first parent
 * is already in the base (GitHub's pull-request test merge of the base tip
 * and the branch), which counts against its branch-side parent.
 */
function rangeCommits(repo, mergeBase) {
  const log = repo.git(
    "log",
    "--reverse",
    "--topo-order",
    "--format=%H%x1f%P%x1f%s%x1f%B%x1e",
    `${mergeBase}..HEAD`,
  )
  return lines(log, "\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [sha, parentList, subject, body] = record.split("\x1f")
      const parents = lines(parentList, " ")
      const from =
        parents.length === 0
          ? EMPTY_TREE
          : parents.length === 1
            ? parents[0]
            : (parents.find((parent) => !repo.isAncestor(parent, mergeBase)) ?? parents[0])
      const trailers = [...body.matchAll(new RegExp(EXCEPTION_TRAILER.source, "gm"))].map(
        ([line]) => line.trim(),
      )
      return { sha, from, subject, merge: parents.length > 1, trailers }
    })
}

/** Every step of the range: each commit against its parent, then the uncommitted changes. */
async function replaySteps(repo, eslint, commits, options) {
  const steps = []
  for (const commit of commits)
    steps.push({ commit, keys: await stepKeys(repo, eslint, commit.from, commit.sha, options) })
  const head = repo.git("rev-parse", "HEAD").trim()
  steps.push({ commit: UNCOMMITTED, keys: await stepKeys(repo, eslint, head, WORKTREE, options) })
  return steps
}

const describeCommit = (commit) =>
  commit.sha === WORKTREE
    ? "the uncommitted changes in the working tree"
    : `${commit.sha.slice(0, 9)} ("${commit.subject}")`

const COMMIT_REMEDY =
  "reword that commit (an interactive rebase) to carry one, or undo the change; a trailer on any other commit covers nothing"
const MERGE_REMEDY =
  "a merge counts against its branch-side parent, so it also carries what it brought in from the base; give the merge commit the trailer, or rebase onto the base instead of merging"

const ESCAPE =
  'The single escape (requires review): a "Ratchet-Exception: <reason>" trailer on the commit that makes the change; it covers that commit only.'

/**
 * Runs the check in the repository at `root`; resolves to the exit code.
 * `argv`/`env` as the process's (the check reads its CI variables from `env`;
 * git always runs as `openRepo` says), `log`/`error` print a line each.
 */
export async function run({
  root = repoRoot,
  argv = process.argv,
  env = process.env,
  log = console.log,
  error = console.error,
} = {}) {
  const eslint = eslintConfigs(root)
  try {
    return await check(openRepo(root), eslint, { argv, env, log, error })
  } finally {
    eslint.cleanup()
  }
}

async function check(repo, eslint, { argv, env, log, error }) {
  const { git } = repo
  const fail = (message) => {
    error(`check-ratchets: ${message}`)
    return 1
  }

  const { ref: baseRef, ignoredArg } = resolveBaseRef(argv, env)
  if (ignoredArg) {
    log(
      `check-ratchets: ignoring the base ref "${ignoredArg}": in CI the base is always the PR base (${baseRef}).`,
    )
  }

  if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
    return fail(
      "shallow clone: the merge base may be missing. In CI check out with `fetch-depth: 0`; locally run `git fetch --unshallow`. Refusing to skip silently.",
    )
  }
  let mergeBase
  try {
    mergeBase = git("merge-base", baseRef, "HEAD").trim()
  } catch {
    return fail(
      `cannot compute the merge base against ${baseRef}. Fetch it first (git fetch origin), or pass the base ref as the first argument. Refusing to skip silently.`,
    )
  }
  if (mergeBase === git("rev-parse", "HEAD").trim()) {
    if (isPullRequest(env)) {
      return fail(
        `HEAD is the merge base with ${baseRef} on a pull request: the check would compare the branch with itself and pass vacuously. Refusing.`,
      )
    }
    log(
      `check-ratchets: HEAD is the merge base with ${baseRef}. Comparing the working tree against it.`,
    )
  }

  if (MUTATION_PAUSED) {
    log(
      "check-ratchets: mutation testing is paused (scripts/mutation-pause.mjs), so Stryker configs are not compared.",
    )
  }
  const { violations, baseFileCount } = await netViolations(repo, eslint, mergeBase)
  if (violations.length === 0) {
    log(
      `check-ratchets: ${baseFileCount} ratchet file(s) + inline suppressions vs ${baseRef} (${mergeBase.slice(0, 9)}): all move in the right direction.`,
    )
    return 0
  }

  const inCi = Boolean(env.GITHUB_ACTIONS)
  const commits = rangeCommits(repo, mergeBase)
  if (!commits.some(({ trailers }) => trailers.length > 0)) {
    for (const { message } of violations)
      error(`${inCi ? "::error::" : ""}RATCHET VIOLATION ${message}`)
    return fail(
      `${violations.length} violation(s), and no commit in the range carries a trailer. Ratchets only move one way: fix the code, not the threshold. ${ESCAPE}`,
    )
  }

  const steps = await replaySteps(repo, eslint, commits, {
    effectiveFiles: [...new Set(violations.flatMap(({ effectiveFiles = [] }) => effectiveFiles))],
    mergeBase,
  })
  const verdicts = attributeViolations(violations, steps)
  for (const { violation, verdict, commits: makers } of verdicts) {
    if (verdict === "waved") {
      log(`${inCi ? "::warning::" : ""}RATCHET EXCEPTION APPLIED: ${violation.message}`)
      for (const commit of makers)
        log(`    waved by ${describeCommit(commit)}: ${commit.trailers.join(" | ")}`)
      continue
    }
    error(`${inCi ? "::error::" : ""}RATCHET VIOLATION ${violation.message}`)
    if (verdict === "drift") {
      error(
        "    no single commit makes it: the commits' changes only add up to it, so no commit's trailer covers it. Fix it, or make the change in one commit that carries the trailer.",
      )
    } else {
      for (const commit of makers)
        error(
          commit.sha === WORKTREE
            ? `    made by ${describeCommit(commit)}, which no trailer covers: commit them with a Ratchet-Exception trailer, or undo them`
            : `    made by ${describeCommit(commit)}, which carries no Ratchet-Exception trailer: ${commit.merge ? MERGE_REMEDY : COMMIT_REMEDY}`,
        )
    }
  }

  const waved = verdicts.filter(({ verdict }) => verdict === "waved")
  if (waved.length > 0 && env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `### ⚠️ Ratchet exception applied\n\n${waved
        .map(
          ({ violation, commits: makers }) =>
            `- ${violation.message}\n${makers.map((commit) => `  - ${describeCommit(commit)}: \`${commit.trailers.join(" | ")}\``).join("\n")}`,
        )
        .join("\n")}\n`,
    )
  }
  const failed = verdicts.length - waved.length
  if (failed > 0) {
    return fail(
      `${failed} of ${verdicts.length} violation(s) not covered by a trailer of the commit that makes them. Ratchets only move one way: fix the code, not the threshold. ${ESCAPE}`,
    )
  }
  log(
    `check-ratchets: ${waved.length} violation(s) waved through, each by the Ratchet-Exception trailer of every commit that makes it (listed above). Reviewers: this is the single documented escape. Check each reason.`,
  )
  return 0
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const code = await run()
  if (code !== 0) process.exit(code)
}
