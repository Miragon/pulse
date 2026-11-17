import { describe, expect, it } from "vitest"
import { dialectOf, FLAVORS, type Flavor } from "@miragon/pulse-profile"
import { type EngineFlavor, isC7Flavor } from "./engine-provider.js"
import { engineConfigSchema, engineModule } from "./module.js"
import {
  DEFAULT_ENGINE_FLAVOR,
  ENGINE_PROVIDERS,
  camunda7Provider,
  camunda8Provider,
  cibsevenProvider,
  operatonProvider,
  providerForEntry,
} from "./providers/index.js"
import { buildInstanceCockpitUrl, buildProcessCockpitUrl } from "./lib/engine/cockpit-url.js"

/**
 * The vendor an engine entry resolves to. Without a `flavor` it is Camunda 7,
 * the default the server shares with the CLI and the editor extension; a CIB
 * seven or Operaton engine names its flavor (cockpit routes, product name).
 */
describe("providerForEntry", () => {
  it("resolves an engine without a flavor to Camunda 7", () => {
    expect(DEFAULT_ENGINE_FLAVOR).toBe("camunda7")
    expect(providerForEntry({ id: "a" })).toBe(camunda7Provider)
    expect(providerForEntry({ id: "a", flavor: undefined })).toBe(camunda7Provider)
  })

  it("resolves each named flavor to its own provider", () => {
    expect(providerForEntry({ id: "a", flavor: "cibseven" })).toBe(cibsevenProvider)
    expect(providerForEntry({ id: "a", flavor: "operaton" })).toBe(operatonProvider)
    expect(providerForEntry({ id: "a", flavor: "camunda7" })).toBe(camunda7Provider)
    expect(providerForEntry({ id: "a", flavor: "camunda8" })).toBe(camunda8Provider)
    for (const [flavor, provider] of Object.entries(ENGINE_PROVIDERS)) {
      expect(provider.flavor).toBe(flavor)
    }
  })

  it("has a provider for every flavor of the profile format, each with the format's dialect", () => {
    const flavors = Object.keys(FLAVORS) as Flavor[]
    expect(Object.keys(ENGINE_PROVIDERS).sort()).toEqual([...flavors].sort())
    for (const flavor of flavors) {
      expect(ENGINE_PROVIDERS[flavor].dialect, flavor).toBe(dialectOf({ flavor }))
    }
  })

  it("narrows a flavor to the Camunda 7 REST dialect's, whose providers alone build a client", () => {
    const flavors = Object.keys(FLAVORS) as Flavor[]
    expect(flavors.filter(isC7Flavor).sort()).toEqual(["camunda7", "cibseven", "operaton"])
    for (const flavor of flavors) {
      expect("createClient" in ENGINE_PROVIDERS[flavor], flavor).toBe(isC7Flavor(flavor))
    }
  })

  it("names Camunda 8 and links nowhere into Operate: no base derived, no route", () => {
    const engine = {
      baseUrl: "https://cluster.example/v2",
      cockpitUrl: "https://operate.example/operate",
      provider: camunda8Provider,
    }
    expect(camunda8Provider.branding.displayName).toBe("Camunda 8")
    expect(camunda8Provider.cockpit.deriveWebappBase("https://cluster.example/v2")).toBeNull()
    const ref = { key: "order", version: 1, definitionId: "2251799813685249", instanceId: "1" }
    expect(buildProcessCockpitUrl(engine, ref)).toBeNull()
    expect(buildInstanceCockpitUrl(engine, ref, { tab: "incidents" })).toBeNull()
  })

  it("fails on a flavor an untyped caller made up, naming the engine and the known ones", () => {
    expect(() => providerForEntry({ id: "a", flavor: "flowable" as EngineFlavor })).toThrow(
      'Unknown engine flavor "flowable" for engine "a". Expected one of: cibseven, operaton, camunda7, camunda8',
    )
  })
})

/**
 * The single-engine shorthand names a CIB seven or Operaton engine with
 * ENGINE_FLAVOR, the way ENGINE_ID names its id: configFromEnv trims, the
 * profile format's table of flavors judges the value.
 */
describe("engineModule.configFromEnv engine flavor", () => {
  const BASE = "http://engine.example/engine-rest"
  const enginesOf = (env: NodeJS.ProcessEnv) =>
    engineModule.configFromEnv(env).engines as Array<Record<string, unknown>>
  const providerOf = (env: NodeJS.ProcessEnv) =>
    providerForEntry(engineConfigSchema.parse(engineModule.configFromEnv(env)).engines[0])

  it("sets no flavor without ENGINE_FLAVOR, so the engine is Camunda 7", () => {
    expect(enginesOf({ ENGINE_BASE_URL: BASE })[0]).not.toHaveProperty("flavor")
    expect(enginesOf({ ENGINE_FLAVOR: "  " })[0]).not.toHaveProperty("flavor")
    expect(providerOf({ ENGINE_BASE_URL: BASE })).toBe(camunda7Provider)
    expect(providerOf({})).toBe(camunda7Provider)
  })

  it("names the shorthand engine's vendor, trimmed, the zero-config engine's too", () => {
    expect(
      enginesOf({
        ENGINE_BASE_URL: BASE,
        ENGINE_ID: "prod-a",
        ENGINE_FLAVOR: " cibseven ",
      }),
    ).toEqual([{ id: "prod-a", baseUrl: BASE, flavor: "cibseven" }])
    expect(enginesOf({ ENGINE_FLAVOR: "operaton" })).toEqual([
      { id: "default", baseUrl: "http://localhost:8410/engine-rest", flavor: "operaton" },
    ])
    expect(providerOf({ ENGINE_BASE_URL: BASE, ENGINE_FLAVOR: "cibseven" })).toBe(cibsevenProvider)
  })

  it("accepts every known vendor on a profile", () => {
    for (const flavor of ["cibseven", "operaton", "camunda7"]) {
      const env = { ENGINES_JSON: JSON.stringify({ profiles: { a: { url: BASE, flavor } } }) }
      expect(enginesOf(env)[0].flavor).toBe(flavor)
    }
  })

  it("ignores ENGINE_FLAVOR when a profile file describes the engines", () => {
    expect(
      enginesOf({
        ENGINE_FLAVOR: "cibseven",
        ENGINES_JSON: '{"profiles":{"prod-b":{"url":"http://b.example/engine-rest"}}}',
      }),
    ).toEqual([{ id: "prod-b", baseUrl: "http://b.example/engine-rest" }])
  })

  it.each(["CIBSEVEN", "cib seven", "flowable"])(
    "fails the boot on %j, naming the variable and never the value",
    (raw) => {
      expect(() => engineModule.configFromEnv({ ENGINE_FLAVOR: raw })).toThrow(
        "ENGINE_FLAVOR: flavor must be one of camunda7, camunda8, cibseven, operaton (the value is not shown).",
      )
    },
  )

  it("fails the boot on camunda8, naming the flavors this server reads", () => {
    expect(() => engineModule.configFromEnv({ ENGINE_FLAVOR: "camunda8" })).toThrow(
      "ENGINE_FLAVOR: This server does not speak the API of this flavor: it reads camunda7, cibseven and operaton.",
    )
  })

  it("declares ENGINE_FLAVOR so the unknown-env-var warner does not flag it", () => {
    expect(engineModule.knownEnvVars).toContain("ENGINE_FLAVOR")
  })
})

/** The zero-config boot reaches the starter's or the playground's engine, a CIB seven: its warning names the flavor. */
describe("engineModule.bootWarnings engine flavor", () => {
  it("names the flavor the zero-config engine's links follow: Camunda 7 unless set", () => {
    expect(engineModule.bootWarnings({})[0]).toContain('flavor "camunda7"')
    expect(engineModule.bootWarnings({})[0]).toContain("ENGINE_FLAVOR=cibseven")
    expect(engineModule.bootWarnings({ ENGINE_FLAVOR: " cibseven " })[0]).toContain(
      'flavor "cibseven"',
    )
  })

  it("stays silent about the flavor once an engine source is configured", () => {
    expect(
      engineModule.bootWarnings({
        ENGINE_BASE_URL: "http://e/engine-rest",
        ENGINE_FLAVOR: "x",
      }),
    ).toEqual([])
  })
})
