import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp } from "../src/app.js"
import { stubNeutralEnv } from "./neutral-env.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

const KEYCLOAK = JSON.stringify({
  provider: "keycloak",
  serverUrl: "https://kc.example.com",
  realm: "acme",
})

/** Boot `createApp` with a neutral env plus `MCP_OAUTH` (mcp-use reads `MCP_URL` from process.env). */
async function boot(mcpOAuth: string | undefined) {
  stubNeutralEnv({ MCP_URL: "https://mcp.acme.example", MCP_OAUTH: mcpOAuth })
  return createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
}

const toolsetsOf = (composed: Awaited<ReturnType<typeof createApp>>) =>
  Object.fromEntries(composed.boot.toolsets.map((t) => [t.module, t.toolset]))

/**
 * `MCP_OAUTH` reaches this server through the SAME shared helper the stock
 * server uses (`oauthFromEnv`, `@miragon/pulse-widget-shell/server`): it is the
 * only caller identity (passthrough auth, per-caller caches) and it raises
 * the no-suffix toolsets above the read-only floor.
 */
describe("OAuth via MCP_OAUTH (createApp)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("installs the provider: /mcp demands a bearer token and the default toolsets rise", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const composed = await boot(KEYCLOAK)
    expect(composed.boot.authenticated).toBe(true)
    // Analytics declares no toolsets, so it has none to raise.
    expect(toolsetsOf(composed)).toMatchObject({ camunda7: "operations", analytics: undefined })

    const res = await composed.app.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /)
  })

  it("without MCP_OAUTH boots unauthenticated and says so", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const composed = await boot(undefined)
    expect(composed.boot.authenticated).toBe(false)
    expect(toolsetsOf(composed)).toMatchObject({ camunda7: "read-only", analytics: undefined })
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[acme-mcp\] MCP_OAUTH is unset, so there is no caller identity/),
    )
  })

  it("fails the boot on a config it cannot honor instead of coming up unauthenticated", async () => {
    await expect(boot(JSON.stringify({ provider: "okta" }))).rejects.toThrow(/MCP_OAUTH is invalid/)
  })
})
