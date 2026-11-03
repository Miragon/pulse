import { readFileSync } from "node:fs"
import path from "node:path"
import { createComposedServer, type ComposedServer } from "@miragon/pulse-widget-shell/server"
import { MODULES, sharedResources } from "./setup.js"

/** `src/` under tsx/vitest, `dist/` when compiled: the package root is one level up either way. */
const PACKAGE_ROOT = path.join(import.meta.dirname, "..")

/**
 * The preamble of the server `instructions`: short and factual. Every active
 * module appends its own snippet (`instructions` on its module definition,
 * e.g. the engine module's engine routing), and tool descriptions carry the rest.
 */
export const SERVER_INSTRUCTIONS =
  "Camunda 7 / CIB seven operations, process analytics and team notes. " +
  "Toolsets fail closed: a tool missing from tools/list is not enabled on this deployment. " +
  "On hosts that render MCP Apps, prefer the view tools (*_show_*, *_open_*) to present results to the user."

/** The version in `package.json`, reported as `serverInfo.version`, never a hard-coded copy. */
export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    version: string
  }
  return pkg.version
}

export interface AppDeps {
  /** Widget bundle; default: the compiled `dist/mcp-app.{js,css}` (tests pass a stand-in). */
  bundle?: { jsPath: string; cssPath?: string }
}

/**
 * The composition root `src/index.ts` and the tests share: one `createComposedServer` call
 * (`@miragon/pulse-widget-shell/server`). The boot owns the rest: the module selection and its
 * log, OAuth from mcp-use's own `MCP_USE_OAUTH_*` variables, the mcp-use server, `/metrics`, the
 * Host/Origin guard, `/health/*`, the body-capped listener and the graceful drain. This file
 * names what is yours: the server's name, the modules and their wiring (`setup.ts`).
 */
export async function createApp(
  env: NodeJS.ProcessEnv = process.env,
  deps: AppDeps = {},
): Promise<ComposedServer> {
  return createComposedServer({
    info: {
      name: "acme-mcp",
      version: packageVersion(),
      title: "Acme MCP",
      instructions: SERVER_INSTRUCTIONS,
    },
    modules: MODULES,
    shared: sharedResources,
    env,
    bundle: deps.bundle ?? {
      // Read ONCE at boot: after rebuilding the bundle, restart the server.
      jsPath: path.join(PACKAGE_ROOT, "dist", "mcp-app.js"),
      cssPath: path.join(PACKAGE_ROOT, "dist", "mcp-app.css"),
    },
  })
}
