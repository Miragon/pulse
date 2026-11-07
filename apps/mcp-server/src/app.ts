import { readFileSync } from "node:fs"
import path from "node:path"
import { createComposedServer, type ComposedServer } from "@miragon/pulse-widget-shell/server"
import { MODULES, sharedResources, type ModuleDefinition } from "./setup.js"

/** `src/` under tsx/vitest, `dist/` when compiled: the package root is one level up either way. */
const PACKAGE_ROOT = path.join(import.meta.dirname, "..")

/**
 * The preamble of the server `instructions`, deliberately short and factual.
 * Each active module appends its own snippet (engine routing, dates, tool
 * families, health routing; `ComposableModule.instructions`), and the tool
 * descriptions carry the per-tool details.
 */
export const SERVER_INSTRUCTIONS =
  "Camunda 7 / CIB seven operations and Prometheus-backed process analytics. " +
  "Toolsets fail closed: a tool missing from tools/list is not enabled on this deployment. " +
  "On hosts that render MCP Apps, prefer the view tools (*_show_*, *_open_*) to present results to the user."

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
      description: "Camunda 7 / CIB seven operations and process analytics",
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
  })
}
