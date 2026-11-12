import { describe, expect, it } from "vitest"
import { engineModule } from "./module.js"

/**
 * Passthrough forwards the caller's MCP token to the engine (the MCP auth
 * spec's forbidden token passthrough). It stays for trusted single-audience
 * setups (#330), and the boot says so for exactly the engines that use it.
 */
describe("engineModule.bootWarnings: passthrough", () => {
  const passthroughWarning = (env: NodeJS.ProcessEnv) =>
    engineModule.bootWarnings(env).filter((w) => w.startsWith("Passthrough auth"))

  it("names the single engine when ENGINE_AUTH_TYPE=passthrough", () => {
    const [warning] = passthroughWarning({
      ENGINE_BASE_URL: "http://engine.example/engine-rest",
      ENGINE_ID: "prod-a",
      ENGINE_AUTH_TYPE: "passthrough",
    })
    expect(warning).toContain('"prod-a"')
    expect(warning).toContain("trusted single-audience setup")
    expect(warning).toContain("replay")
  })

  it("names only the usable profiles whose own auth is passthrough", () => {
    const profiles = {
      a: { url: "http://a.example/engine-rest", auth: { type: "passthrough" } },
      b: {
        url: "http://b.example/engine-rest",
        auth: { type: "basic", username: "u", passwordEnv: "ENGINE_SECRET_B" },
      },
      c: { url: "http://c.example/engine-rest" },
      d: { url: "http://d.example/engine-rest", auth: { type: "passthrough" }, headers: {} },
    }
    const env = { ENGINES_JSON: JSON.stringify({ profiles }), ENGINE_SECRET_B: "p" }
    const warnings = passthroughWarning(env)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('on "a":')
  })

  it("stays silent without passthrough and on a config the boot rejects anyway", () => {
    expect(
      passthroughWarning({
        ENGINE_BASE_URL: "http://e.example",
        ENGINE_AUTH_TYPE: "basic",
        ENGINE_USERNAME: "u",
        ENGINE_PASSWORD: "p",
      }),
    ).toEqual([])
    expect(
      passthroughWarning({ ENGINES_JSON: "{not json", ENGINE_AUTH_TYPE: "passthrough" }),
    ).toEqual([])
  })
})
