import { afterEach, describe, expect, it, vi } from "vitest"
import { composedEnvVars } from "@miragon/pulse-widget-shell/server"
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

    stubNeutralEnv({ MCP_ACTIVE_MODULES: "notes" })

    expect(process.env.MCP_USE_OAUTH_KEYCLOAK_SERVER_URL).toBeUndefined()
    expect(process.env.MCP_USE_OAUTH_KEYCLOAK_AUDIENCE).toBeUndefined()
    expect(Object.entries(process.env).filter(([, value]) => value === "from-the-shell")).toEqual(
      [],
    )
    expect(process.env.CAMUNDA_BASE_URL).toBe("http://localhost:1")
    expect(process.env.MCP_ACTIVE_MODULES).toBe("notes")
  })
})
