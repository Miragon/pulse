import fs from "node:fs"
import path from "node:path"

/**
 * The non-test sources of every app and package — what the cross-module
 * source guards (tool-name refs, hand-off refs) read. Only the app sees every
 * module at once, so these guards live here.
 */

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..")

/**
 * How the source guards read an app:
 * - "mcp-host": an MCP server app. Every guard reads it: the tool-name checks
 *   (literals and prose) and the MCP-widget rules of CLAUDE.md invariant 6
 *   (the hand-off primitive, model contexts) with their name resolution.
 * - "interface": a CLI or an editor extension. Only the tool-name checks read
 *   it: a tool-name literal must name a registered tool, a parameter quoted
 *   for a tool must be one that tool takes, and prose must not send the model
 *   to an app-only feed. The widget rules and the corpus the helper names
 *   resolve in stay with the packages and the MCP server apps, so a CLI helper
 *   that shares a name with a server helper cannot turn a server prompt check
 *   opaque.
 */
export type AppScan = "mcp-host" | "interface"

/** What a scanned file belongs to: a package, or an app as APP_SCAN classifies it. */
export type SourceOwner = "package" | AppScan

/** Which source guards read: everything ("all") or the MCP surface only ("mcp"). */
export type ScanScope = "all" | "mcp"

/**
 * Every app under apps/ (keyed by its directory) and how the source guards
 * read it. An app this map does not name fails every scan: add the new app here
 * as "mcp-host" or "interface" (see AppScan) instead of letting a guard skip
 * it. A VS Code extension (an app whose package.json declares engines.vscode)
 * is always "interface".
 */
export const APP_SCAN: Readonly<Record<string, AppScan>> = {
  "mcp-server-camunda7": "mcp-host",
}

export interface ScanOptions {
  /** "all" (the default, so a forgotten option reads more) or "mcp". */
  scope?: ScanScope
  /** The repo to read; tests point it at a fixture tree. */
  root?: string
  /** The app classification; tests pass their own. */
  apps?: Readonly<Record<string, AppScan>>
}

const childDirs = (dir: string) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name))

/** An app is a directory under apps/ with a package.json or a src/; a leftover node_modules is none. */
const isApp = (dir: string) =>
  fs.existsSync(path.join(dir, "package.json")) || fs.existsSync(path.join(dir, "src"))

function declaresVsCodeEngine(dir: string): boolean {
  const manifest = path.join(dir, "package.json")
  if (!fs.existsSync(manifest)) return false
  const { engines } = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
    engines?: Record<string, unknown>
  }
  return engines?.vscode !== undefined
}

/**
 * The apps the scope reads, as [dir, classification], after checking the
 * classification against the apps/ directory in both directions. It throws on
 * an unclassified app, on an entry naming no app, on a classified app without
 * src/ (its sources would be read by no guard) and on a VS Code extension
 * classified as an MCP server.
 */
function scannedApps(
  root: string,
  apps: Readonly<Record<string, AppScan>>,
  scope: ScanScope,
): Array<[string, AppScan]> {
  const appsDir = path.join(root, "apps")
  const found = childDirs(appsDir)
    .filter(isApp)
    .map((dir) => path.basename(dir))
  for (const name of found) {
    if (!Object.hasOwn(apps, name)) {
      throw new Error(
        `apps/${name} is not classified in APP_SCAN (apps/mcp-server-camunda7/test/source-scan.ts): ` +
          `add it as "mcp-host" (an MCP server: every source guard reads it) or "interface" ` +
          `(a CLI or editor extension: only the tool-name checks read it).`,
      )
    }
  }
  return Object.entries(apps).flatMap(([name, scan]) => {
    const dir = path.join(appsDir, name)
    if (!found.includes(name)) {
      throw new Error(
        `APP_SCAN classifies apps/${name}, which is no app (no package.json, no src/): drop the entry.`,
      )
    }
    if (!fs.existsSync(path.join(dir, "src"))) {
      throw new Error(
        `apps/${name} is classified in APP_SCAN but has no src/: the source guards read ` +
          `apps/<app>/src only and would read nothing of it. Move its sources to apps/${name}/src.`,
      )
    }
    if (scan === "mcp-host" && declaresVsCodeEngine(dir)) {
      throw new Error(
        `apps/${name} declares engines.vscode (a VS Code extension) but APP_SCAN classifies it ` +
          `as "mcp-host": an extension is no MCP server, classify it as "interface".`,
      )
    }
    return scope === "all" || scan === "mcp-host" ? [[dir, scan]] : []
  })
}

/**
 * Source roots with their owner: apps/<app>/src for the apps the scope reads,
 * packages/core/<pkg>/src, packages/connectors/<family>/<pkg>/src.
 */
function sourceRoots(root: string, apps: Readonly<Record<string, AppScan>>, scope: ScanScope) {
  const packages = path.join(root, "packages")
  const packageDirs = [
    ...childDirs(path.join(packages, "core")),
    ...childDirs(path.join(packages, "connectors")).flatMap(childDirs),
  ]
  return [
    ...scannedApps(root, apps, scope),
    ...packageDirs.map((dir): [string, SourceOwner] => [dir, "package"]),
  ]
    .map(([dir, owner]) => ({ src: path.join(dir, "src"), owner }))
    .filter(({ src }) => fs.existsSync(src))
}

/**
 * Every TS or JS module but tests, `.test-support.ts` helpers and generated
 * code (`rel` is repo-relative). The `.test-support.tsx` render helpers are
 * read like widget code.
 */
const isScannedSource = (rel: string) =>
  /\.(?:[cm]?[jt]s|[jt]sx)$/.test(rel) &&
  !/\.test\.(?:[cm]?[jt]s|[jt]sx)$/.test(rel) &&
  !rel.endsWith(".test-support.ts") &&
  !rel.split(path.sep).includes("generated")

/**
 * Runs `scan` over every scanned source file in the scope: its repo-relative
 * path, its text and what it belongs to (a package, or an app's APP_SCAN class).
 */
export function scanSources<T>(
  scan: (file: string, text: string, owner: SourceOwner) => T[],
  { scope = "all", root = REPO_ROOT, apps = APP_SCAN }: ScanOptions = {},
): T[] {
  return sourceRoots(root, apps, scope).flatMap(({ src, owner }) =>
    fs
      .readdirSync(src, { recursive: true, encoding: "utf8" })
      .map((rel) => path.relative(root, path.join(src, rel)))
      .filter(isScannedSource)
      .flatMap((file) => scan(file, fs.readFileSync(path.join(root, file), "utf8"), owner)),
  )
}
