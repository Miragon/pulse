import { describe, expect, it } from "vitest"
import type { EngineFlavor } from "./engine-provider.js"
import { camunda7ConfigSchema, camunda7Module } from "./module.js"
import {
  DEFAULT_ENGINE_FLAVOR,
  ENGINE_PROVIDERS,
  camunda7Provider,
  cibsevenProvider,
  operatonProvider,
  providerForEntry,
} from "./providers/index.js"

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
    for (const [flavor, provider] of Object.entries(ENGINE_PROVIDERS)) {
      expect(provider.flavor).toBe(flavor)
    }
  })

  it("fails on a flavor an untyped caller made up, naming the engine and the known ones", () => {
    expect(() => providerForEntry({ id: "a", flavor: "flowable" as EngineFlavor })).toThrow(
      'Unknown engine flavor "flowable" for engine "a" — expected one of: cibseven, operaton, camunda7',
    )
  })
})

/**
 * The single-engine shorthand names a CIB seven or Operaton engine with
 * CAMUNDA_ENGINE_FLAVOR, the way CAMUNDA_ENGINE_ID names its id: configFromEnv
 * only trims, the schema's enum judges the value.
 */
describe("camunda7Module.configFromEnv engine flavor", () => {
  const BASE = "http://engine.example/engine-rest"
  const enginesOf = (env: NodeJS.ProcessEnv) =>
    camunda7Module.configFromEnv(env).engines as Array<Record<string, unknown>>
  const providerOf = (env: NodeJS.ProcessEnv) =>
    providerForEntry(camunda7ConfigSchema.parse(camunda7Module.configFromEnv(env)).engines[0])

  it("sets no flavor without CAMUNDA_ENGINE_FLAVOR, so the engine is Camunda 7", () => {
    expect(enginesOf({ CAMUNDA_BASE_URL: BASE })[0]).not.toHaveProperty("flavor")
    expect(enginesOf({ CAMUNDA_ENGINE_FLAVOR: "  " })[0]).not.toHaveProperty("flavor")
    expect(providerOf({ CAMUNDA_BASE_URL: BASE })).toBe(camunda7Provider)
    expect(providerOf({})).toBe(camunda7Provider)
  })

  it("names the shorthand engine's vendor, trimmed, the zero-config engine's too", () => {
    expect(
      enginesOf({
        CAMUNDA_BASE_URL: BASE,
        CAMUNDA_ENGINE_ID: "prod-a",
        CAMUNDA_ENGINE_FLAVOR: " cibseven ",
      }),
    ).toEqual([{ id: "prod-a", baseUrl: BASE, flavor: "cibseven" }])
    expect(enginesOf({ CAMUNDA_ENGINE_FLAVOR: "operaton" })).toEqual([
      { id: "default", baseUrl: "http://localhost:8410/engine-rest", flavor: "operaton" },
    ])
    expect(providerOf({ CAMUNDA_BASE_URL: BASE, CAMUNDA_ENGINE_FLAVOR: "cibseven" })).toBe(
      cibsevenProvider,
    )
  })

  it("accepts every known vendor on an engine entry", () => {
    for (const flavor of ["cibseven", "operaton", "camunda7"]) {
      const engines = [{ id: "a", baseUrl: BASE, flavor }]
      expect(camunda7ConfigSchema.parse({ engines }).engines[0].flavor).toBe(flavor)
    }
  })

  it("ignores CAMUNDA_ENGINE_FLAVOR when the engine list is explicit", () => {
    expect(
      enginesOf({
        CAMUNDA_ENGINE_FLAVOR: "cibseven",
        CAMUNDA_ENGINES_JSON: '[{"id":"prod-b","baseUrl":"http://b.example/engine-rest"}]',
      }),
    ).toEqual([{ id: "prod-b", baseUrl: "http://b.example/engine-rest" }])
  })

  it.each(["CIBSEVEN", "cib seven", "flowable"])(
    "fails the boot on %j, naming the variable",
    (raw) => {
      expect(() => providerOf({ CAMUNDA_ENGINE_FLAVOR: raw })).toThrow(/CAMUNDA_ENGINE_FLAVOR/)
      const result = camunda7ConfigSchema.safeParse(
        camunda7Module.configFromEnv({ CAMUNDA_ENGINE_FLAVOR: raw }),
      )
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ path: ["engines", 0, "flavor"] }),
      ])
    },
  )

  it("declares CAMUNDA_ENGINE_FLAVOR so the unknown-env-var warner does not flag it", () => {
    expect(camunda7Module.knownEnvVars).toContain("CAMUNDA_ENGINE_FLAVOR")
  })
})

/** The zero-config boot reaches the Compose engine, a CIB seven: its warning names the flavor. */
describe("camunda7Module.bootWarnings engine flavor", () => {
  it("names the flavor the zero-config engine's links follow: Camunda 7 unless set", () => {
    expect(camunda7Module.bootWarnings({})[0]).toContain('flavor "camunda7"')
    expect(camunda7Module.bootWarnings({})[0]).toContain("CAMUNDA_ENGINE_FLAVOR=cibseven")
    expect(camunda7Module.bootWarnings({ CAMUNDA_ENGINE_FLAVOR: " cibseven " })[0]).toContain(
      'flavor "cibseven"',
    )
  })

  it("stays silent about the flavor once an engine source is configured", () => {
    expect(
      camunda7Module.bootWarnings({
        CAMUNDA_BASE_URL: "http://e/engine-rest",
        CAMUNDA_ENGINE_FLAVOR: "x",
      }),
    ).toEqual([])
  })
})
