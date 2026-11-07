/**
 * Editor-project gate: an editor (tsserver) and typescript-eslint's project service open a file
 * in the project of the NEAREST tsconfig.json that includes it, walking further up past one that
 * does not; neither ever reads a tsconfig.<x>.json. A package's tsconfig.json leaves out the
 * trees only an extra project type-checks (tsconfig.widgets.json, tsconfig.ui.json,
 * tsconfig.test.json, a VS Code layer), so without a nested tsconfig.json an editor checks those
 * files in an inferred project (no strict, no react-jsx, the wrong globals) and reports what no
 * gate reports.
 *
 * So every file of a package opens in a project with the settings a gate checks it with:
 *
 * - a root file of the package's tsconfig.json opens in that project, never in a nested one
 *   (typescript-eslint's project service then types it the way `tsc --noEmit` does);
 * - a root file only extra projects check opens in a project with the compiler options of one
 *   of them: a nested tsconfig.json in its tree that extends that project and sets only
 *   `include` (and `exclude`);
 * - every nested tsconfig.json of the package parses, and opens only files a project with its
 *   compiler options checks.
 *
 * Membership is by root files (`include`, `files`, `exclude`), the editor's rule for ownership;
 * project references are not modelled (no package uses them). Paths are compared in TypeScript's
 * spelling, forward slashes on every platform. scripts/check-package-scripts.mjs
 * (`pnpm lint:package-scripts`) runs it over the workspace's and the template's packages. It
 * takes the TypeScript module as an argument and imports Node built-ins only: ci-scopes.mjs
 * reaches it through check-package-scripts.mjs before any install.
 */
import { readdirSync } from "node:fs"
import path from "node:path"

const posix = path.posix

/** The extra `tsconfig.<x>.json` projects in a package directory (the typecheck gate's). */
export const extraTsconfigs = (abs) =>
  readdirSync(abs)
    .filter((name) => /^tsconfig\.[\w-]+\.json$/.test(name))
    .sort()

/** `p` with forward slashes, the way TypeScript spells every path it returns. */
export const toPosix = (p, sep = path.sep) => p.split(sep).join("/")

/** TS18003 "No inputs were found": an empty project is no editor's problem. */
const NO_INPUTS = 18003

/** `value` with the keys of every object sorted, at every depth. */
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  )
}

/** Compiler options as a comparable string; `configFilePath` names the file, not a setting. */
export const optionsKey = ({ configFilePath: _file, ...options }) =>
  JSON.stringify(canonical(options))

const more = (files) => (files.length > 1 ? ` (and ${files.length - 1} more)` : "")

const append = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value])

const list = (names) => `[${names.map((name) => JSON.stringify(name)).join(", ")}]`

/** The topmost directories of `files` (posix, relative), each nested one folded into its parent. */
export function treesOf(files) {
  const dirs = [...new Set(files.map((file) => posix.dirname(file)))].sort()
  return dirs.filter(
    (dir) => !dirs.some((other) => other !== dir && (other === "." || dir.startsWith(`${other}/`))),
  )
}

/** The parsed projects of one package, each read once, keyed by config path. */
function projectReader(ts) {
  const projects = new Map()
  return (configPath) => {
    if (!projects.has(configPath)) {
      const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile)
      const parsed = error
        ? { fileNames: [], options: {}, errors: [error] }
        : ts.parseJsonConfigFileContent(config, ts.sys, posix.dirname(configPath), {}, configPath)
      projects.set(configPath, {
        configPath,
        files: new Set(parsed.fileNames),
        key: optionsKey(parsed.options),
        errors: parsed.errors.filter((d) => d.code !== NO_INPUTS),
      })
    }
    return projects.get(configPath)
  }
}

/**
 * The fix for files only `name` checks that no tsconfig.json includes, all under `tree`
 * (relative to the package). `mainFiles`: the package tsconfig.json's files, relative.
 */
function coverFix(rel, tree, name, files, mainFiles) {
  if (tree === ".") {
    return (
      `Add them to ${posix.join(rel, "tsconfig.json")}, or move them into a directory of their ` +
      `own with a nested tsconfig.json that extends ${name}`
    )
  }
  const under = (file) => file.startsWith(`${tree}/`)
  // A tree that also holds files of tsconfig.json names its files: ["."] would take those.
  const include = mainFiles.some(under) ? files.map((file) => posix.relative(tree, file)) : ["."]
  return (
    `Add ${posix.join(rel, tree)}/tsconfig.json with { "extends": ` +
    `"${posix.relative(tree, name)}", "include": ${list(include)} }`
  )
}

/**
 * The findings for the package at `abs` (`rel`: its path in the messages). `ts` is the
 * TypeScript module; the tree is read through `ts.sys`.
 */
export function editorProjectFindings(ts, abs, rel = abs) {
  const root = toPosix(abs)
  const inside = (p) => p === root || p.startsWith(`${root}/`)
  const relative = (p) => posix.relative(root, p)
  const show = (p) => posix.join(rel, relative(p))
  const project = projectReader(ts)

  // The project an editor opens `file` in: the nearest tsconfig.json of the package that
  // includes it, or none (an inferred project).
  const owners = new Map()
  const owner = (file) => {
    if (!owners.has(file)) {
      let found
      for (let dir = posix.dirname(file); inside(dir) && found === undefined;) {
        const configPath = ts.findConfigFile(dir, ts.sys.fileExists, "tsconfig.json")
        if (configPath === undefined || !inside(posix.dirname(configPath))) break
        if (project(configPath).files.has(file)) found = project(configPath)
        dir = posix.dirname(posix.dirname(configPath))
      }
      owners.set(file, found)
    }
    return owners.get(file)
  }

  const main = project(posix.join(root, "tsconfig.json"))
  const extras = extraTsconfigs(abs).map((name) => ({ name, ...project(posix.join(root, name)) }))
  const findings = []

  // The package's tsconfig.json keeps its own files.
  const taken = new Map()
  for (const file of main.files) {
    if (owner(file) !== main) append(taken, owner(file)?.configPath, file)
  }
  for (const [configPath, files] of taken) {
    findings.push(
      `${show(files[0])}${more(files)}: in ${show(main.configPath)}, but editors and ` +
        `typescript-eslint open it in ${configPath ? show(configPath) : "an inferred project"}; ` +
        `a nested tsconfig.json includes only files tsconfig.json leaves out`,
    )
  }

  // A file only extra projects check opens in a project an editor finds.
  const checkers = new Map()
  for (const extra of extras) {
    for (const file of extra.files) if (!main.files.has(file)) append(checkers, file, extra)
  }
  const uncovered = new Map()
  for (const [file, checkedBy] of checkers) {
    if (owner(file) === undefined) append(uncovered, checkedBy[0].name, relative(file))
  }
  const mainFiles = [...main.files].map(relative)
  for (const [name, files] of uncovered) {
    for (const tree of treesOf(files)) {
      const own = files.filter((file) => tree === "." || file.startsWith(`${tree}/`))
      findings.push(
        `${posix.join(rel, tree)}: ${own.length} file(s) only ${name} checks open in an ` +
          `inferred project in editors (no strict, no react-jsx, the wrong globals): no ` +
          `tsconfig.json above them includes them. ${coverFix(rel, tree, name, own, mainFiles)}`,
      )
    }
  }

  // Every nested tsconfig.json of the package parses, and opens each file it takes with the
  // compiler options of a project that checks that file (files of tsconfig.json: above).
  const nestedFindings = (nested) => {
    const mirrored = extras.filter((extra) => extra.key === nested.key)
    const off = [...nested.files].filter(
      (file) =>
        !main.files.has(file) &&
        owner(file) === nested &&
        !mirrored.some((extra) => extra.files.has(file)),
    )
    const differ = new Map()
    const unchecked = []
    for (const file of off) {
      const checkedBy = checkers.get(file)
      if (checkedBy) append(differ, checkedBy.map((extra) => extra.name).join(" or "), file)
      else unchecked.push(file)
    }
    const out = [...differ].map(
      ([names, files]) =>
        `${show(files[0])}${more(files)}: editors open it in ${show(nested.configPath)}, whose ` +
        `compiler options differ from ${names}, which checks it; extend that project and set ` +
        `only include and exclude`,
    )
    if (unchecked.length === 0) return out
    const what = `${show(nested.configPath)}: includes ${show(unchecked[0])}${more(unchecked)}`
    out.push(
      mirrored.length > 0
        ? `${what}, which ${mirrored.map((extra) => extra.name).join(" and ")} leaves out, so ` +
            `editors report what no gate reports; include only that project's files`
        : `${what}, which no project of the package checks, with compiler options no ` +
            `tsconfig.<x>.json of it has, so editors report what no gate reports; check them in ` +
            `a tsconfig.<x>.json and extend that, setting only include and exclude`,
    )
    return out
  }
  const nestedConfigs = ts.sys
    .readDirectory(root, [".json"], undefined, ["**/tsconfig.json"])
    .map((configPath) => toPosix(configPath))
  for (const configPath of nestedConfigs) {
    const nested = project(configPath)
    if (nested === main) continue
    for (const error of nested.errors) {
      findings.push(
        `${show(nested.configPath)}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
      )
    }
    if (nested.errors.length === 0) findings.push(...nestedFindings(nested))
  }
  return findings
}
