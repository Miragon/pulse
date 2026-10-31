import { readFileSync } from "node:fs"
import path from "node:path"
import type { OAuthProvider } from "mcp-use/oauth"
import {
  createComposedServer,
  oauthFromEnv,
  type ComposedServer,
} from "@miragon/pulse-widget-shell/server"
import { initRuntime, type RuntimeBackends } from "./persistence/index.js"
import { SERVER_LABEL } from "./server-label.js"
import { composition, getPlugins } from "./setup.js"

/** `src/` under tsx/vitest, `dist/` when compiled — the package root is one level up either way. */
const PACKAGE_ROOT = path.join(import.meta.dirname, "..")

/**
 * The preamble of the server `instructions` — deliberately short and factual.
 * Each active module appends its own snippet (engine routing, dates, tool
 * families, health routing — `ComposableModule.instructions`), and the tool
 * descriptions carry the per-tool details.
 */
export const SERVER_INSTRUCTIONS =
  "Camunda 7 / CIB Seven operations and Prometheus-backed process analytics. " +
  "Toolsets fail closed: a tool missing from tools/list is not enabled on this deployment. " +
  "On hosts that render MCP Apps, prefer the *_show_* tools to present results to the user."

/** The version release-please maintains in `package.json` — never a hard-coded copy. */
export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    version: string
  }
  return pkg.version
}

/** Seams for the e2e suites; production passes none. */
export interface AppDeps {
  /**
   * The OAuth provider to install. Absent = built from `MCP_OAUTH`; present
   * (even `undefined`) = exactly this one — the e2e suites install a stub
   * provider so authenticated boots run the real bearer gate.
   */
  oauth?: OAuthProvider<unknown>
  /** Persistence backends; default: `initRuntime(env)` (Postgres / filesystem / memory). */
  runtime?: RuntimeBackends
  /** Widget bundle; default: the compiled `dist/mcp-app.{js,css}`. */
  bundle?: { jsPath: string; cssPath?: string }
}

/**
 * The composition root — the ONE boot sequence `src/index.ts` (production and
 * `mcp-use dev`) and the e2e suites share. App-owned here: persistence
 * (`initRuntime`) and the plugins with their cross-module wiring
 * (`setup.ts`); the OAuth provider comes from the shared `oauthFromEnv` and
 * the order of everything else lives in the shared `createComposedServer`
 * (both `@miragon/pulse-widget-shell/server`) — wired exactly like the
 * composed-server template.
 */
export async function createApp(
  env: NodeJS.ProcessEnv = process.env,
  deps: AppDeps = {},
): Promise<ComposedServer> {
  // MCP_OAUTH → the provider (the only caller-identity source). Whether one
  // was BUILT decides every module's default toolset, and a bad MCP_OAUTH
  // fails the boot before migrations.
  const oauth = "oauth" in deps ? deps.oauth : oauthFromEnv({ env, label: SERVER_LABEL })

  return createComposedServer({
    label: SERVER_LABEL,
    info: {
      name: SERVER_LABEL,
      version: packageVersion(),
      title: "Pulse",
      description: "Camunda 7 / CIB seven operations and process analytics",
      websiteUrl: "https://github.com/Miragon/pulse",
      instructions: SERVER_INSTRUCTIONS,
    },
    composition,
    env,
    oauth,
    bundle: deps.bundle ?? {
      jsPath: path.join(PACKAGE_ROOT, "dist", "mcp-app.js"),
      cssPath: path.join(PACKAGE_ROOT, "dist", "mcp-app.css"),
    },
    setup: async (boot) => {
      // Postgres when DATABASE_URL is set (migrations run here, before the
      // server listens — the healthcheck grace periods cover it), else
      // filesystem/in-memory.
      const runtime = deps.runtime ?? (await initRuntime(env))
      return {
        plugins: getPlugins(runtime.profileStore, boot),
        readiness: runtime.readiness,
        shutdown: () => runtime.shutdown(),
      }
    },
  })
}
