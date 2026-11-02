import { afterEach, describe, expect, it, vi } from "vitest"
import { camunda7Module } from "@miragon/pulse-camunda7-connector"
import { composedEnvVars } from "@miragon/pulse-widget-shell/server"
import { createApp } from "../src/app.js"
import { MODULES, sharedResources } from "../src/setup.js"
import { stubNeutralEnv } from "./boot-server.js"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("the app's module list and its wiring", () => {
  it("hands analytics camunda7's engine ids and BPMN lookup, and nothing without camunda7", () => {
    const config = camunda7Module.configFromEnv({
      CAMUNDA_ENGINES_JSON: JSON.stringify([
        { id: "prod-a", baseUrl: "http://localhost:1" },
        { id: "prod-b", baseUrl: "http://localhost:2" },
      ]),
    })
    const shared = sharedResources([{ app: "camunda7", config }])
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

  // The production path: the env default, no oauth seam, the default bundle path.
  it("boots authenticated from the process env when one provider's variables are set", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    stubNeutralEnv({
      MCP_USE_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com",
      MCP_USE_OAUTH_KEYCLOAK_REALM: "r",
      MCP_URL: "http://localhost:8400",
    })
    const composed = await createApp()
    expect(composed.boot.authenticated).toBe(true)
    expect(composed.boot.toolsets[0]).toEqual({
      module: "camunda7",
      toolset: "operations",
      source: "default",
    })
  })
})
