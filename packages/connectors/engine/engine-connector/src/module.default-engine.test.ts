import { describe, expect, it } from "vitest"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { engineModule, engineConfigSchema } from "./module.js"

/**
 * The default for a call without `engine`: ENGINE_DEFAULT, else the profile file's
 * defaultProfile. Either must name a configured engine, or the boot fails (invariant 2); one that
 * names a refused profile warns, and the call fails with its reason instead of going elsewhere.
 */
describe("ENGINE_DEFAULT and defaultProfile", () => {
  const TWO = [
    { id: "prod-a", baseUrl: "http://a.example/engine-rest" },
    { id: "prod-b", baseUrl: "http://b.example/engine-rest" },
  ]
  const FILE = {
    profiles: {
      "prod-a": { url: "http://a.example/engine-rest" },
      "prod-b": { url: "http://b.example/engine-rest" },
    },
  }

  it("configFromEnv trims ENGINE_DEFAULT; blank is unset; an id no profile carries fails there", () => {
    const fromEnv = (value?: string) =>
      engineModule.configFromEnv({ ENGINES_JSON: JSON.stringify(FILE), ENGINE_DEFAULT: value })
        .defaultEngine
    expect(fromEnv(" prod-b ")).toBe("prod-b")
    expect(fromEnv("  ")).toBeUndefined()
    expect(fromEnv(undefined)).toBeUndefined()
    expect(() => fromEnv("prod-z")).toThrow(
      "ENGINE_DEFAULT=prod-z names no configured engine (configured: prod-a, prod-b).",
    )
  })

  it("takes the file's defaultProfile, and ENGINE_DEFAULT beats it", () => {
    const env = { ENGINES_JSON: JSON.stringify({ defaultProfile: "prod-a", ...FILE }) }
    expect(engineModule.configFromEnv(env).defaultEngine).toBe("prod-a")
    expect(engineModule.configFromEnv({ ...env, ENGINE_DEFAULT: "prod-b" }).defaultEngine).toBe(
      "prod-b",
    )
  })

  it("warns when the default names a refused profile, and never reroutes", () => {
    const refused = {
      profiles: { ...FILE.profiles, locked: { url: "http://c.example/engine-rest", headers: {} } },
    }
    const env = { ENGINES_JSON: JSON.stringify({ defaultProfile: "locked", ...refused }) }
    expect(engineModule.configFromEnv(env).defaultEngine).toBe("locked")
    expect(engineModule.bootWarnings(env)).toContain(
      'defaultProfile names "locked", whose profile is refused: a call without engine fails with ENGINE_PROFILE_REFUSED until the profile is fixed, and never goes to another engine.',
    )
    const viaEnv = { ENGINES_JSON: JSON.stringify(refused), ENGINE_DEFAULT: "locked" }
    expect(
      engineModule.bootWarnings(viaEnv).some((w) => w.startsWith("ENGINE_DEFAULT names")),
    ).toBe(true)
  })

  it("is a known env var", () => {
    expect(engineModule.knownEnvVars).toContain("ENGINE_DEFAULT")
  })

  it("accepts a configured engine id, a refused one included", () => {
    expect(engineConfigSchema.parse({ engines: TWO, defaultEngine: "prod-b" }).defaultEngine).toBe(
      "prod-b",
    )
    const refused = [{ id: "prod-c", reason: "auth.tokenEnv is missing." }]
    expect(
      engineConfigSchema.parse({ engines: TWO, refused, defaultEngine: "prod-c" }).defaultEngine,
    ).toBe("prod-c")
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
