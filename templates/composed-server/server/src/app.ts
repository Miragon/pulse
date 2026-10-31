import { readFileSync } from "node:fs"
import path from "node:path"
import {
  announcePersistence,
  createComposedServer,
  oauthFromEnv,
  persistenceFromEnv,
  type ComposedServer,
} from "@miragon/pulse-widget-shell/server"
import { composition, createProfileStore, getPlugins } from "./setup.js"

/** `src/` under tsx/vitest, `dist/` when compiled — the package root is one level up either way. */
const PACKAGE_ROOT = path.join(import.meta.dirname, "..")

/**
 * The preamble of the server `instructions`: short and factual. Every active
 * module appends its own snippet (`instructions` on its module definition —
 * e.g. camunda7's engine routing), and tool descriptions carry the rest.
 */
export const SERVER_INSTRUCTIONS =
  "Camunda 7 / CIB Seven operations, process analytics and team notes. " +
  "Toolsets fail closed: a tool missing from tools/list is not enabled on this deployment. " +
  "On hosts that render MCP Apps, prefer the *_show_* tools to present results to the user."

/** The version in `package.json` — reported as `serverInfo.version`, never a hard-coded copy. */
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
 * The composition root `src/index.ts` and the tests share. The boot ORDER —
 * selection and boot log, the mcp-use server, request context, tool-call
 * logging, `/metrics`, the Host/Origin guard, `/health/*`, the body-capped
 * listener and the graceful drain — lives in `createComposedServer`, the
 * OAuth wiring in `oauthFromEnv` (both `@miragon/pulse-widget-shell/server`);
 * this file only wires what is yours: persistence and the plugins
 * (`setup.ts`).
 */
export async function createApp(
  env: NodeJS.ProcessEnv = process.env,
  deps: AppDeps = {},
): Promise<ComposedServer> {
  return createComposedServer({
    label: "acme-mcp",
    info: {
      name: "acme-mcp",
      version: packageVersion(),
      title: "Acme MCP",
      instructions: SERVER_INSTRUCTIONS,
    },
    composition,
    env,
    // MCP_OAUTH → the provider: the only caller identity (per-user settings),
    // and what raises the no-suffix toolsets above the read-only floor.
    // Unset = unauthenticated, with a boot warning.
    oauth: oauthFromEnv({ env, label: "acme-mcp" }),
    bundle: deps.bundle ?? {
      // Read ONCE at boot — after rebuilding the bundle, restart the server.
      jsPath: path.join(PACKAGE_ROOT, "dist", "mcp-app.js"),
      cssPath: path.join(PACKAGE_ROOT, "dist", "mcp-app.css"),
    },
    setup: (boot) => {
      // Logs the selection; a NODE_ENV=production boot on an in-memory store
      // warns loudly (settings vanish on every restart) but still boots.
      announcePersistence(persistenceFromEnv(env), { env, label: "acme-mcp" })
      return {
        plugins: getPlugins(createProfileStore(env), boot),
        // Readiness covers the stores YOU wire (a `SELECT 1` round trip for a
        // database) — never upstreams like the engine or Prometheus.
        readiness: {},
      }
    },
  })
}
