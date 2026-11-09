/**
 * The non-test sources of every package and every MCP server app: what the cross-module source
 * guards (tool-name refs, hand-off refs, server env names) read. An interface app (a CLI, an
 * editor extension) carries no tool name of any module and posts nothing to an MCP host, so
 * no guard reads it, and neither reads the packages only the editor hosts bundle
 * (INTERFACE_PACKAGES).
 */
import fs from "node:fs"
import path from "node:path"

export const REPO_ROOT = path.resolve(import.meta.dirname, "..")

/**
 * The apps under apps/ (keyed by directory) and how the source guards read each: an MCP server
 * app ("mcp-host") by every guard, an interface app ("interface") by none. A new app adds its
 * entry here (`unclassifiedApps` fails until it does).
 * @type {Readonly<Record<string, "mcp-host" | "interface">>}
 */
export const APP_SCAN = {
  cli: "interface",
  "mcp-server": "mcp-host",
  orca: "interface",
  vscode: "interface",
}

/**
 * The packages only the interface apps bundle (keyed by their directory under packages/): the
 * runtime view the editor hosts share and the c7 family's adapter of its contract. Like an
 * interface app, they carry no tool name and post nothing to an MCP host.
 */
export const INTERFACE_PACKAGES = ["core/runtime-view", "connectors/c7/c7-adapter"]

/** @param {string} dir */
const childDirs = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name))
    : []

/**
 * Source roots with their owner: apps/<app>/src of every MCP server app,
 * packages/core/<pkg>/src, packages/connectors/<family>/<pkg>/src.
 * @param {string} root
 * @param {Readonly<Record<string, string>>} apps
 */
function sourceRoots(root, apps) {
  const packages = path.join(root, "packages")
  const packageDirs = [
    ...childDirs(path.join(packages, "core")),
    ...childDirs(path.join(packages, "connectors")).flatMap(childDirs),
  ]
  const appDirs = Object.entries(apps)
    .filter(([, scan]) => scan === "mcp-host")
    .map(([name]) => /** @type {const} */ ([path.join(root, "apps", name), "mcp-host"]))
  const scannedPackages = packageDirs.filter(
    (dir) => !INTERFACE_PACKAGES.includes(path.relative(packages, dir).split(path.sep).join("/")),
  )
  return [...appDirs, ...scannedPackages.map((dir) => /** @type {const} */ ([dir, "package"]))]
    .map(([dir, owner]) => ({ src: path.join(dir, "src"), owner }))
    .filter(({ src }) => fs.existsSync(src))
}

/**
 * Every TS or JS module but tests, `.test-support.ts` helpers and generated code (`rel` is
 * repo-relative). The `.test-support.tsx` render helpers are read like widget code.
 * @param {string} rel
 */
const isScannedSource = (rel) =>
  /\.(?:[cm]?[jt]s|[jt]sx)$/.test(rel) &&
  !/\.test\.(?:[cm]?[jt]s|[jt]sx)$/.test(rel) &&
  !rel.endsWith(".test-support.ts") &&
  !rel.split(path.sep).includes("generated")

/**
 * Runs `scan` over every scanned source file: its repo-relative path, its text and what it
 * belongs to ("package" or "mcp-host").
 * @template T
 * @param {(file: string, text: string, owner: "package" | "mcp-host") => T[]} scan
 * @param {{ root?: string, apps?: Readonly<Record<string, string>> }} [options] a fixture tree and its classification
 * @returns {T[]}
 */
export function scanSources(scan, { root = REPO_ROOT, apps = APP_SCAN } = {}) {
  return sourceRoots(root, apps).flatMap(({ src, owner }) =>
    fs
      .readdirSync(src, { recursive: true, encoding: "utf8" })
      .map((rel) => path.relative(root, path.join(src, rel)))
      .filter(isScannedSource)
      .flatMap((file) => scan(file, fs.readFileSync(path.join(root, file), "utf8"), owner)),
  )
}

/**
 * The apps (directories under apps/ with a package.json) that `apps` does not classify: one of
 * them would fall out of every source guard unnoticed.
 * @param {string} [root]
 * @param {Readonly<Record<string, string>>} [apps]
 */
export function unclassifiedApps(root = REPO_ROOT, apps = APP_SCAN) {
  return childDirs(path.join(root, "apps"))
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
    .map((dir) => path.basename(dir))
    .filter((name) => !Object.hasOwn(apps, name))
    .sort()
}
