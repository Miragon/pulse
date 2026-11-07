import { describe, expect, it } from "vitest"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { engineModule, engineConfigSchema } from "./module.js"

/** The operator default for a call without `engine`: it must name a configured engine, or the boot fails. */
describe("ENGINE_DEFAULT", () => {
  const TWO = [
    { id: "prod-a", baseUrl: "http://a.example/engine-rest" },
    { id: "prod-b", baseUrl: "http://b.example/engine-rest" },
  ]

  it("configFromEnv trims it; blank is unset; an id no engine carries fails there", () => {
    const fromEnv = (value?: string) =>
      engineModule.configFromEnv({ ENGINES_JSON: JSON.stringify(TWO), ENGINE_DEFAULT: value })
        .defaultEngine
    expect(fromEnv(" prod-b ")).toBe("prod-b")
    expect(fromEnv("  ")).toBeUndefined()
    expect(fromEnv(undefined)).toBeUndefined()
    expect(() => fromEnv("prod-z")).toThrow(
      "ENGINE_DEFAULT=prod-z names no configured engine (configured: prod-a, prod-b).",
    )
  })

  it("is a known env var", () => {
    expect(engineModule.knownEnvVars).toContain("ENGINE_DEFAULT")
  })

  it("accepts a configured engine id", () => {
    expect(engineConfigSchema.parse({ engines: TWO, defaultEngine: "prod-b" }).defaultEngine).toBe(
      "prod-b",
    )
  })

  it("fails the boot on an id no engine carries, naming the variable, the value and the configured ids", () => {
    expect(() => engineConfigSchema.parse({ engines: TWO, defaultEngine: "prod-z" })).toThrow(
      "ENGINE_DEFAULT=prod-z names no configured engine (configured: prod-a, prod-b).",
    )
    expect(() => engineModule.createPlugin({ engines: TWO, defaultEngine: "prod-z" })).toThrow(
      /ENGINE_DEFAULT=prod-z/,
    )
  })

  it("reaches the routing and the instructions", async () => {
    const text = engineModule.instructions({ engines: TWO, defaultEngine: "prod-b" })
    expect(text).toContain('else to the default engine "prod-b"')
    const recording = recordingModuleServer()
    engineModule.createPlugin({ engines: TWO, defaultEngine: "prod-b" }).register(recording.server)
    const result = await recording.tool("engine_list_engines").call({})
    expect(result.structuredContent).toMatchObject({ defaultEngineId: "prod-b" })
  })
})
