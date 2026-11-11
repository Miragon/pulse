/**
 * Module-syntax gate: every program of a workspace package compiles with `verbatimModuleSyntax`
 * and `isolatedModules`. Without them tsc drops a re-export of a type not marked `type` from dist,
 * while vitest, which transforms one file at a time, keeps the name with the value undefined: a
 * test of an entry's exports passes on a name the published package does not export. With them
 * tsc refuses that re-export (TS1205), and the emitted JavaScript keeps each import and re-export
 * as it is written, so what the tests load is what the package ships.
 *
 * A program is the package's tsconfig.json, each tsconfig.<x>.json beside it and every nested
 * tsconfig.json under it (the editor projects, which Vite's and vitest's transform also resolve
 * for the files under them), each read with its `extends` resolved. MODULE_SYNTAX_EXEMPT names the
 * packages left out, each with its reason; an entry fails once its package sets both options in
 * every program or is gone, so the map cannot outlive its reason.
 *
 * scripts/check-package-scripts.mjs (`pnpm lint:package-scripts`) runs it over the workspace's
 * source packages. It takes the TypeScript module as an argument and imports Node built-ins only:
 * ci-scopes.mjs reaches it through check-package-scripts.mjs before any install.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { extraTsconfigs, toPosix } from "./editor-projects.mjs"

const posix = path.posix

/** The compiler options every program sets to true. */
export const MODULE_SYNTAX_OPTIONS = ["verbatimModuleSyntax", "isolatedModules"]

/** The source packages whose programs may leave both options out, each with its reason. */
export const MODULE_SYNTAX_EXEMPT = {
  "apps/mcp-server":
    "the server app publishes no entry, so no test of an entry's exports can promise a name " +
    "its build drops; the libraries took both options on 2026-11-11, the app was left as it is",
}

/** Every program of the package at `abs` as an absolute posix path, the nested ones included. */
export function programsOf(ts, abs) {
  const root = toPosix(abs)
  const top = ["tsconfig.json", ...extraTsconfigs(abs)].map((name) => posix.join(root, name))
  const nested = ts.sys
    .readDirectory(root, [".json"], undefined, ["**/tsconfig.json"])
    .map((configPath) => toPosix(configPath))
  return [...new Set([...top, ...nested])]
    .filter((configPath) => ts.sys.fileExists(configPath))
    .sort()
}

/** The options of MODULE_SYNTAX_OPTIONS the program at `configPath` leaves unset or false. */
export function missingOptions(ts, configPath) {
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile)
  if (error) return [...MODULE_SYNTAX_OPTIONS]
  const { options } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    posix.dirname(configPath),
    {},
    configPath,
  )
  return MODULE_SYNTAX_OPTIONS.filter((option) => options[option] !== true)
}

/**
 * The findings for the package at `abs` (`rel`: its path in the messages). An exempt package has
 * none, unless it sets both options in every program: then its entry is stale.
 */
export function moduleSyntaxFindings(ts, abs, rel = abs, { exempt = MODULE_SYNTAX_EXEMPT } = {}) {
  const root = toPosix(abs)
  const programs = programsOf(ts, abs).map((configPath) => ({
    file: posix.join(rel, posix.relative(root, configPath)),
    missing: missingOptions(ts, configPath),
  }))
  if (Object.hasOwn(exempt, rel)) {
    return programs.every(({ missing }) => missing.length === 0)
      ? [
          `${rel}: sets ${MODULE_SYNTAX_OPTIONS.join(" and ")} in every program, so its ` +
            `MODULE_SYNTAX_EXEMPT entry in scripts/module-syntax.mjs is stale; remove it`,
        ]
      : []
  }
  return programs
    .filter(({ missing }) => missing.length > 0)
    .map(
      ({ file, missing }) =>
        `${file}: does not set ${missing.map((option) => `"${option}": true`).join(" and ")} ` +
        `(itself or through extends), so tsc drops a type re-exported without \`type\` from dist ` +
        `while vitest keeps the name with the value undefined; set both in compilerOptions`,
    )
}

/**
 * The findings for the workspace's source packages under `root`, and for every exempt entry that
 * names no source package.
 */
export function checkModuleSyntax(ts, root, sourceDirs, { exempt = MODULE_SYNTAX_EXEMPT } = {}) {
  const stale = Object.keys(exempt)
    .filter((dir) => !sourceDirs.includes(dir) || !existsSync(path.join(root, dir)))
    .map(
      (dir) =>
        `MODULE_SYNTAX_EXEMPT in scripts/module-syntax.mjs: "${dir}" is not a workspace package ` +
        `with src/ (gone or renamed); move the entry to the package's new dir or remove it`,
    )
  return [
    ...stale,
    ...sourceDirs.flatMap((dir) => moduleSyntaxFindings(ts, path.join(root, dir), dir, { exempt })),
  ]
}
