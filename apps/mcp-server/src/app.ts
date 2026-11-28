import { readFileSync } from "node:fs"
import path from "node:path"
import { createComposedServer, type ComposedServer } from "@miragon/pulse-widget-shell/server"
import { MODULES, sharedResources, type ModuleDefinition } from "./setup.js"

/** `src/` under tsx/vitest, `dist/` when compiled: the package root is one level up either way. */
const PACKAGE_ROOT = path.join(import.meta.dirname, "..")

/**
 * The preamble of the server `instructions`, deliberately short and factual, and true on every
 * configuration: what the engines of a deployment are (Camunda 7, CIB seven, Operaton, Camunda 8)
 * and what reads them the engine module's own snippet says by the dialects configured. Each active
 * module appends its own snippet (engine routing, dates, tool families, health routing;
 * `ComposableModule.instructions`), and the tool descriptions carry the per-tool details.
 */
export const SERVER_INSTRUCTIONS =
  "Process engine operations. " +
  "Toolsets fail closed: a tool missing from tools/list is not enabled on this deployment. " +
  "On hosts that render MCP Apps, prefer the view tools (*_open_*) to present results to the user."

/** The version release-please maintains in `package.json`, never a hard-coded copy. */
function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    version: string
  }
  return pkg.version
}

/** The seam for the e2e suites; production passes none. */
export interface AppDeps {
  /** Widget bundle; default: the compiled `dist/mcp-app.{js,css}`. */
  bundle?: { jsPath: string; cssPath?: string }
  /** The composition; default: `MODULES`. The host simulation adds a module's own view to it. */
  modules?: readonly ModuleDefinition[]
  /**
   * The web app's build, served under `/app` once `MCP_WEB_CLIENT_ID` is set (`MCP_WEB_DIR`
   * overrides it); default: the package's `web/`, which the server image fills.
   */
  webDir?: string
}

/** The one boot `src/index.ts` (production and `pnpm dev`) and the e2e suites share. */
export async function createApp(
  env: NodeJS.ProcessEnv = process.env,
  deps: AppDeps = {},
): Promise<ComposedServer> {
  return createComposedServer({
    info: {
      name: "pulse",
      version: packageVersion(),
      title: "Pulse",
      description: "Process engine operations",
      websiteUrl: "https://github.com/Miragon/pulse",
      instructions: SERVER_INSTRUCTIONS,
    },
    modules: deps.modules ?? MODULES,
    shared: sharedResources,
    env,
    envVarHint: "see docs/mcp/operations.md",
    bundle: deps.bundle ?? {
      jsPath: path.join(PACKAGE_ROOT, "dist", "mcp-app.js"),
      cssPath: path.join(PACKAGE_ROOT, "dist", "mcp-app.css"),
    },
    web: { dir: deps.webDir ?? path.join(PACKAGE_ROOT, "web") },
  })
}
