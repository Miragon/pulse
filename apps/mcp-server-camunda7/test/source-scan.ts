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

/** The apps under apps/ (keyed by directory) and how the source guards read each. */
export const APP_SCAN: Readonly<Record<string, AppScan>> = {
  cli: "interface",
  "mcp-server-camunda7": "mcp-host",
  vscode: "interface",
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
  const appDirs = Object.entries(apps)
    .filter(([, scan]) => scope === "all" || scan === "mcp-host")
    .map(([name, scan]): [string, SourceOwner] => [path.join(root, "apps", name), scan])
  return [...appDirs, ...packageDirs.map((dir): [string, SourceOwner] => [dir, "package"])]
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
