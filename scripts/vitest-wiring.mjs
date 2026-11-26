// @ts-check
/**
 * Vitest wiring gate (#688): every source package's vitest.config.ts is
 * `export default mergeConfig(sharedConfig, defineConfig({ ... }))`, with `mergeConfig` from
 * vitest/config and `sharedConfig` from the repository's vitest.shared.ts. That base switches
 * coverage on and hands the run the check that each floor follows its measurement and measures
 * something (scripts/coverage-floors.mjs). A config that drops it and sets `coverage.enabled: true`
 * of its own still measures and still checks its floors, but without that check, and no other gate
 * would notice.
 *
 * What holds: Vite's mergeConfig appends an array of the second argument to the base's and skips a
 * null or undefined value, so `test.reporters` there adds to the base's reporters and never
 * replaces them; and the file names its `sharedConfig` binding nowhere else, so no code of the file
 * changes the base before vitest reads it (the second argument runs before the merge, too). The
 * reader runs nothing: a plugin that rewrites the resolved config is out of its sight.
 *
 * scripts/check-package-scripts.mjs (`pnpm lint:package-scripts`) runs it over the workspace's
 * source packages, the ones whose `test` script it holds to exactly `vitest run`. It takes the
 * TypeScript module as an argument and imports Node built-ins only: ci-scopes.mjs reaches it
 * through check-package-scripts.mjs before any install.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/** @typedef {typeof import("typescript")} TS */
/** @typedef {import("typescript").Node} Node */
/** @typedef {import("typescript").SourceFile} SourceFile */
/** @typedef {import("typescript").Identifier} Identifier */
/** @typedef {{ module: string, imported: string, local: string }} NamedImport */
/** @typedef {{ rel: string, locals: Set<string>, argument: Identifier }} Wiring */

const posix = path.posix

/** The one shape of a package's vitest.config.ts, as the messages name it. */
export const WIRING =
  "`export default mergeConfig(sharedConfig, defineConfig({ ... }))`, with mergeConfig from " +
  '"vitest/config" and sharedConfig from the repository\'s vitest.shared.ts'

/** What a config that is not wired misses, as the messages say it. */
const MISSES =
  "so its run misses what vitest.shared.ts hands every package's run: coverage switched on and " +
  "the check that each floor follows its measurement and measures something " +
  "(scripts/coverage-floors.mjs); a `coverage.enabled: true` of the package's own measures " +
  "without that check"

/**
 * Whether `specifier`, imported by the file at the repo-relative `rel`, names the repository's
 * vitest.shared.ts (written without an extension, with .js or with .ts).
 * @param {string} rel
 * @param {string} specifier
 */
const isSharedModule = (rel, specifier) =>
  specifier.startsWith(".") &&
  posix.join(posix.dirname(rel), specifier).replace(/\.[jt]s$/, "") === "vitest.shared"

/**
 * The file's named value imports (a type-only import binds no value).
 * @param {TS} ts
 * @param {SourceFile} sourceFile
 * @returns {NamedImport[]}
 */
function namedImports(ts, sourceFile) {
  return sourceFile.statements.filter(ts.isImportDeclaration).flatMap((declaration) => {
    const clause = declaration.importClause
    const bindings = clause?.isTypeOnly ? undefined : clause?.namedBindings
    const specifier = declaration.moduleSpecifier
    if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(specifier)) return []
    return bindings.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => ({
        module: specifier.text,
        imported: (element.propertyName ?? element.name).text,
        local: element.name.text,
      }))
  })
}

/**
 * The local names the file binds to `name` of a module `matches` accepts.
 * @param {NamedImport[]} imports
 * @param {string} name
 * @param {(module: string) => boolean} matches
 */
const localsOf = (imports, name, matches) =>
  new Set(imports.filter((i) => i.imported === name && matches(i.module)).map((i) => i.local))

/**
 * The callee and first argument of the file's `export default <callee>(<argument>, …)`, each an
 * identifier, or undefined.
 * @param {TS} ts
 * @param {SourceFile} sourceFile
 */
function defaultCall(ts, sourceFile) {
  const call = sourceFile.statements
    .filter(ts.isExportAssignment)
    .find((statement) => !statement.isExportEquals)?.expression
  if (!call || !ts.isCallExpression(call)) return undefined
  const [argument] = call.arguments
  return ts.isIdentifier(call.expression) && argument && ts.isIdentifier(argument)
    ? { callee: call.expression, argument }
    : undefined
}

/**
 * The first argument of the file's `export default mergeConfig(sharedConfig, …)` with every local
 * name the file binds to sharedConfig, or why the file has none.
 * @param {TS} ts
 * @param {SourceFile} sourceFile
 * @param {string} rel
 * @returns {Wiring | { reason: string }}
 */
function mergedShared(ts, sourceFile, rel) {
  const imports = namedImports(ts, sourceFile)
  const locals = localsOf(imports, "sharedConfig", (module) => isSharedModule(rel, module))
  const merge = localsOf(imports, "mergeConfig", (module) => module === "vitest/config")
  if (locals.size === 0)
    return { reason: "it imports no sharedConfig from the repository's vitest.shared.ts" }
  if (merge.size === 0) return { reason: 'it imports no mergeConfig from "vitest/config"' }
  const call = defaultCall(ts, sourceFile)
  if (!call || !merge.has(call.callee.text) || !locals.has(call.argument.text))
    return { reason: "its default export is not mergeConfig(sharedConfig, …)" }
  return { rel, locals, argument: call.argument }
}

/**
 * Whether the identifier reads a binding: neither an import's name nor a property's.
 * @param {TS} ts
 * @param {Node} node
 */
function isReference(ts, node) {
  const { parent } = node
  if (ts.isImportSpecifier(parent)) return false
  if (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent))
    return parent.name !== node
  return true
}

/**
 * Whether the import declaration takes nothing of its module but sharedConfig, by name.
 * @param {TS} ts
 * @param {import("typescript").ImportDeclaration} declaration
 */
function importsOnlyShared(ts, declaration) {
  const clause = declaration.importClause
  const bindings = clause?.namedBindings
  return (
    !clause?.name &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.every(
      (element) => (element.propertyName ?? element.name).text === "sharedConfig",
    )
  )
}

/**
 * Whether `node` reaches the shared base beyond the merge and its import: a sharedConfig binding
 * read anywhere else, or vitest.shared.ts named by any other import (a namespace import, a
 * dynamic import, a re-export).
 * @param {TS} ts
 * @param {Node} node
 * @param {Wiring} wiring
 */
function isOtherUse(ts, node, wiring) {
  if (ts.isIdentifier(node))
    return wiring.locals.has(node.text) && node !== wiring.argument && isReference(ts, node)
  if (!ts.isStringLiteralLike(node) || !isSharedModule(wiring.rel, node.text)) return false
  return !(ts.isImportDeclaration(node.parent) && importsOnlyShared(ts, node.parent))
}

/**
 * The lines where the file reaches the shared base beyond the merge and its import.
 * @param {TS} ts
 * @param {SourceFile} sourceFile
 * @param {Wiring} wiring
 */
function otherUses(ts, sourceFile, wiring) {
  /** @type {number[]} */
  const lines = []
  /** @param {Node} node */
  const visit = (node) => {
    if (isOtherUse(ts, node, wiring))
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return lines
}

/**
 * The findings for one vitest.config.ts (`rel`: its repo-relative path, posix).
 * @param {TS} ts
 * @param {string} rel
 * @param {string} text
 * @returns {string[]}
 */
export function wiringFindings(ts, rel, text) {
  const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const merged = mergedShared(ts, sourceFile, rel)
  if ("reason" in merged) return [`${rel}: ${merged.reason}, ${MISSES}. Write ${WIRING}`]
  const lines = otherUses(ts, sourceFile, merged)
  if (lines.length === 0) return []
  return [
    `${rel}: reaches sharedConfig beyond mergeConfig's first argument and a named import of ` +
      `it (line ${lines.join(", ")}), where code could change what vitest.shared.ts hands the ` +
      "run before vitest reads it (the check that each floor follows its measurement among it). " +
      "Name sharedConfig only there, import nothing else of vitest.shared.ts, and set the " +
      "package's options in mergeConfig's second argument",
  ]
}

/**
 * The findings for the vitest.config.ts of each source package under `root`; a package without
 * one is check-package-scripts.mjs's finding.
 * @param {TS} ts
 * @param {string} root
 * @param {string[]} sourceDirs
 */
export function checkVitestWiring(ts, root, sourceDirs) {
  return sourceDirs.flatMap((dir) => {
    const file = path.join(root, dir, "vitest.config.ts")
    if (!existsSync(file)) return []
    return wiringFindings(ts, posix.join(dir, "vitest.config.ts"), readFileSync(file, "utf8"))
  })
}
