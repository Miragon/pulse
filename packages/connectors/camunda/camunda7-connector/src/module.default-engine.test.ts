import { describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import { camunda7Module, camunda7ConfigSchema } from "./module.js"

/** The operator default for a call without `engine`: it must name a configured engine, or the boot fails. */
describe("CAMUNDA_DEFAULT_ENGINE", () => {
  const TWO = [
    { id: "prod-a", baseUrl: "http://a.example/engine-rest" },
    { id: "prod-b", baseUrl: "http://b.example/engine-rest" },
  ]

  it("configFromEnv trims it; blank is unset", () => {
    const fromEnv = (value?: string) =>
      camunda7Module.configFromEnv({ CAMUNDA_DEFAULT_ENGINE: value }).defaultEngine
    expect(fromEnv(" prod-b ")).toBe("prod-b")
    expect(fromEnv("  ")).toBeUndefined()
    expect(fromEnv(undefined)).toBeUndefined()
  })

  it("is a known env var", () => {
    expect(camunda7Module.knownEnvVars).toContain("CAMUNDA_DEFAULT_ENGINE")
  })

  it("accepts a configured engine id", () => {
    expect(
      camunda7ConfigSchema.parse({ engines: TWO, defaultEngine: "prod-b" }).defaultEngine,
    ).toBe("prod-b")
  })

  it("fails the boot on an id no engine carries, naming the variable, the value and the configured ids", () => {
    expect(() => camunda7ConfigSchema.parse({ engines: TWO, defaultEngine: "prod-z" })).toThrow(
      "CAMUNDA_DEFAULT_ENGINE=prod-z names no configured engine (configured: prod-a, prod-b).",
    )
    expect(() => camunda7Module.createPlugin({ engines: TWO, defaultEngine: "prod-z" })).toThrow(
      /CAMUNDA_DEFAULT_ENGINE=prod-z/,
    )
  })

  it("reaches the routing and the instructions", async () => {
    const text = camunda7Module.instructions({ engines: TWO, defaultEngine: "prod-b" })
    expect(text).toContain('else to the default engine "prod-b"')
    const tool = vi.fn()
    camunda7Module
      .createPlugin({ engines: TWO, defaultEngine: "prod-b" })
      .register({ tool, prompt: vi.fn() } as unknown as MCPServer)
    const calls = tool.mock.calls as Array<
      [{ name: string }, (args: unknown, ctx: unknown) => Promise<{ structuredContent?: unknown }>]
    >
    const [, listEngines] = calls.find(([d]) => d.name === "camunda7_list_engines")!
    const result = await listEngines({}, {})
    expect(result.structuredContent).toMatchObject({ defaultEngineId: "prod-b" })
  })
})
