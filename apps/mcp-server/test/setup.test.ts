import { afterEach, describe, expect, it, vi } from "vitest"
import { engineModule } from "@miragon/pulse-engine-connector"
import { composedEnvVars } from "@miragon/pulse-widget-shell/server"
import { createApp } from "../src/app.js"
import { MODULES, sharedResources } from "../src/setup.js"
import { stubNeutralEnv } from "./boot-server.js"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("the app's module list and its wiring", () => {
  it("hands analytics the engine module's engine ids and BPMN lookup, and nothing without the engine module", () => {
    const config = engineModule.configFromEnv({
      ENGINES_JSON: JSON.stringify([
        { id: "prod-a", baseUrl: "http://localhost:1" },
        { id: "prod-b", baseUrl: "http://localhost:2" },
      ]),
    })
    const shared = sharedResources([{ app: "engine", config }])
    expect(shared.engineIds).toEqual(["prod-a", "prod-b"])
    expect(shared.fetchBpmnXml).toBeTypeOf("function")
    expect(sharedResources([{ app: "analytics", config: {} }])).toEqual({})
  })

  // PulseAudio owns PULSE_* and the CLI PULSE_CLI_*: one server name there would make the typo
  // warner watch the prefix and warn about both in a shared environment.
  it("reads no PULSE_* variable", () => {
    const pulse = [...composedEnvVars(MODULES)].filter((name) => name.startsWith("PULSE_"))
    expect(pulse).toEqual([])
  })

  // The CLI's docs name CAMUNDA_PASSWORD for its --auth-password-env, and a shell may export what
  // Camunda's own tools read: none of them is the server's, so the boot neither refuses nor warns.
  it.each(["CAMUNDA_BASE_URL", "CAMUNDA_PASSWORD"])(
    "boots with %s set and says nothing about it",
    async (name) => {
      vi.spyOn(console, "info").mockImplementation(() => {})
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      stubNeutralEnv({ [name]: "from-the-shell" })
      const composed = await createApp()
      expect(composed.boot.entries.length).toBeGreaterThan(0)
      expect(warn.mock.calls.flat().join("\n")).not.toContain(name)
    },
  )

  // The production path: the env default, no oauth seam, the default bundle path.
  it("boots authenticated from the process env when one provider's variables are set", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    stubNeutralEnv({
      MCP_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com",
      MCP_OAUTH_KEYCLOAK_REALM: "r",
      MCP_URL: "http://localhost:8400",
    })
    const composed = await createApp()
    expect(composed.boot.authenticated).toBe(true)
    expect(composed.boot.toolsets[0]).toEqual({
      module: "engine",
      toolset: "operations",
      source: "default",
    })
  })
})
