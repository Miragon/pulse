import { afterEach, describe, expect, it, vi } from "vitest"
import { composedEnvVars, retiredEnvVars } from "@miragon/pulse-widget-shell/server"
import { createApp } from "../src/app.js"
import { MODULES } from "../src/setup.js"
import { stubNeutralEnv } from "./neutral-env.js"

/**
 * The e2e suites boot `createApp` against `process.env`; whatever the developer's shell exports
 * must not reach those boots. An ambient OAuth provider is the sharpest case: it makes the boot
 * authenticated, so the token-less test clients get 401 or, without `MCP_URL`, nothing boots.
 */
describe("stubNeutralEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("clears every variable the server reads, whatever the shell exported", () => {
    for (const name of composedEnvVars(MODULES)) vi.stubEnv(name, "from-the-shell")
    // Outside the known variables: only the MCP_USE_OAUTH_* sweep clears it.
    vi.stubEnv("MCP_USE_OAUTH_KEYCLOAK_AUDIENCE", "from-the-shell")

    const selection = MODULES.map(({ name }) => name).join(",")
    stubNeutralEnv({ MCP_ACTIVE_MODULES: selection })

    expect(process.env.MCP_USE_OAUTH_KEYCLOAK_SERVER_URL).toBeUndefined()
    expect(process.env.MCP_USE_OAUTH_KEYCLOAK_AUDIENCE).toBeUndefined()
    expect(Object.entries(process.env).filter(([, value]) => value === "from-the-shell")).toEqual(
      [],
    )
    expect(process.env.ENGINE_BASE_URL).toBe("http://localhost:1")
    expect(process.env.MCP_ACTIVE_MODULES).toBe(selection)
  })

  // Runs while a composed module retires a variable (the engine module's former names).
  const retired = [...retiredEnvVars(MODULES)]
  it.runIf(retired.length > 0)(
    "clears a retired variable from the shell, which the boot would refuse",
    async () => {
      vi.spyOn(console, "info").mockImplementation(() => {})
      vi.spyOn(console, "warn").mockImplementation(() => {})
      for (const name of retired) vi.stubEnv(name, "from-the-shell")

      stubNeutralEnv()

      for (const name of retired) expect(process.env[name]).toBeUndefined()
      const composed = await createApp(process.env, {
        bundle: { jsPath: "/nonexistent/mcp-app.js" },
      })
      expect(composed.boot.entries.length).toBeGreaterThan(0)
    },
  )
})
