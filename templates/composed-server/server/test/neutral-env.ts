import { vi } from "vitest"
import { composedEnvVars, retiredEnvVars } from "@miragon/pulse-widget-shell/server"
import { MODULES } from "../src/setup.js"

/**
 * The env every in-process `createApp` boot starts from: EVERY variable the server reads is
 * cleared (the boot's own, OAuth's and each module's slice, `composedEnvVars(MODULES)`) plus
 * every `MCP_USE_OAUTH_*` name, which mcp-use reads itself, and every retired variable
 * (`retiredEnvVars(MODULES)`), which the boot refuses; then a dead engine URL and `overrides`
 * are applied. Derived, not hand-listed: an OAuth provider, `MCP_URL` or a toolset
 * exported in the developer's shell changes the surface under test (a provider boots
 * authenticated, so a token-less client gets 401, and without `MCP_URL` the boot fails), and a
 * variable the server starts reading later is covered without touching this file. Undo with
 * `vi.unstubAllEnvs()`.
 */
export function stubNeutralEnv(overrides: Record<string, string | undefined> = {}): void {
  const oauthVariables = Object.keys(process.env).filter((name) =>
    name.startsWith("MCP_USE_OAUTH_"),
  )
  const cleared = [...composedEnvVars(MODULES), ...retiredEnvVars(MODULES), ...oauthVariables]
  for (const name of cleared) vi.stubEnv(name, undefined)
  // No call may reach a real engine: tools register fine, calls would fail.
  const env = { ENGINE_BASE_URL: "http://localhost:1", ...overrides }
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
}
