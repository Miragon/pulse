/**
 * The connector's engine suites stay in place although `pnpm test` runs none of them: the
 * pinned `test:engines` script loads vitest.engines.config.ts, which runs every engine suite of
 * the package, the Camunda 7 one and the Camunda 8 one, and switches none off; each suite
 * starts the image `PULSE_ENGINE_IMAGE` names by its dialect, so a typo fails rather than
 * passing as a skipped run; and the Camunda 8 suite's stack is the C8 adapter's, trimmed.
 */

import { globSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { configDefaults } from "vitest/config"
import { C8_STACK } from "./c8-stack.test-support.js"
import { DEFAULT_ENGINE_IMAGE, engineImageOf } from "./engine-image.test-support.js"

type Options = Readonly<Record<string, unknown>>

const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
/** The C8 adapter's stack, of which the connector's Camunda 8 suite starts a trimmed copy. */
const ADAPTER_STACK = join(PACKAGE_ROOT, "../../c8/c8-adapter/test/support")
const ENGINE_SUITES = "src/**/*.engine.test.ts"
/** Options that would let an engine run pass without running a suite. */
const SWITCHES = ["passWithNoTests", "allowOnly", "bail", "testNamePattern", "projects"]

const optionsOf = (value: unknown): Options =>
  typeof value === "object" && value !== null ? (value as Options) : {}

const filesOf = (patterns: unknown) =>
  globSync(
    [patterns].flat().filter((pattern) => typeof pattern === "string"),
    { cwd: PACKAGE_ROOT },
  ).sort()

const adapterFile = (name: string): Readonly<Record<string, unknown>> =>
  JSON.parse(readFileSync(join(ADAPTER_STACK, name), "utf8")) as Readonly<Record<string, unknown>>

const clientsOf = (realm: Readonly<Record<string, unknown>>) =>
  new Map((realm.clients as readonly { readonly clientId: string }[]).map((c) => [c.clientId, c]))

async function engineConfig(): Promise<Options> {
  const file = pathToFileURL(join(PACKAGE_ROOT, "vitest.engines.config.ts")).href
  const loaded = (await import(file)) as { readonly default: unknown }
  return optionsOf(optionsOf(loaded.default).test)
}

describe("the config that runs the connector's engine suites", () => {
  it("is the one the pinned test:engines script loads", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>
    }
    expect(manifest.scripts["test:engines"]).toBe("vitest run --config vitest.engines.config.ts")
  })

  it("runs every engine suite, the Camunda 7 and the Camunda 8 one, and switches none off", async () => {
    const config = await engineConfig()
    expect(filesOf(ENGINE_SUITES)).toEqual([
      "src/lib/core-adapter/c7-runtime.engine.test.ts",
      "src/lib/core-adapter/c8-runtime.engine.test.ts",
    ])
    expect(filesOf(config.include)).toEqual(filesOf(ENGINE_SUITES))
    expect(config.exclude).toEqual([...configDefaults.exclude])
    for (const option of SWITCHES) {
      expect(config[option], option).toBeUndefined()
    }
  })
})

describe("engineImageOf", () => {
  it("reads a Camunda 7 engine by its vendor's flavor, Operaton 2.1.5 without an image", () => {
    expect(engineImageOf(undefined)).toEqual({
      name: DEFAULT_ENGINE_IMAGE,
      dialect: "c7",
      flavor: "operaton",
    })
    expect(engineImageOf(" ")).toMatchObject({ name: "operaton/operaton:2.1.5" })
    expect(engineImageOf("cibseven/cibseven:run-3.0.0")).toEqual({
      name: "cibseven/cibseven:run-3.0.0",
      dialect: "c7",
      flavor: "cibseven",
    })
  })

  it("reads camunda/camunda as a Camunda 8 cluster, by tag or digest", () => {
    for (const name of ["camunda/camunda:8.10.9", "camunda/camunda@sha256:0123"]) {
      expect(engineImageOf(name)).toEqual({ name, dialect: "c8" })
    }
  })

  it("refuses an image of neither dialect, so a typo never passes as a skipped run", () => {
    for (const name of [
      "camunda/camunda-bpm-platform:7.24.0",
      "operaton/operaton",
      "pulse-cibseven:latest",
      "docker.io/camunda/camunda:8.10.9",
    ]) {
      expect(() => engineImageOf(name), name).toThrow(
        `PULSE_ENGINE_IMAGE names ${name}, which is neither a Camunda 7 engine the suites start`,
      )
    }
  })
})

describe("the Camunda 8 stack of the connector's suite", () => {
  const settings = adapterFile("cluster-settings.json")

  it("starts the C8 adapter's Keycloak and Elasticsearch with their environments", () => {
    expect(settings.images).toMatchObject(C8_STACK.images)
    for (const container of ["camunda", "keycloak", "elasticsearch"] as const) {
      expect(C8_STACK[container], container).toEqual(settings[container])
    }
    expect(C8_STACK.storage).toEqual(settings.storage)
    expect(Object.keys(C8_STACK.security)).toEqual(Object.keys(settings.security as object))
  })

  it("secures the cluster as the C8 adapter's does, with its logins that seed and read", () => {
    const adapterSecurity = settings.security as Readonly<Record<string, object>>
    for (const [name, environment] of Object.entries(C8_STACK.security)) {
      expect(adapterSecurity[name], name).toMatchObject(environment)
    }
  })

  it("imports the C8 adapter's realm, trimmed to the cluster's client and those two logins", () => {
    const { clients, ...realm } = C8_STACK.realm
    const adapterRealm = adapterFile("keycloak-realm.json")
    const adapterClients = clientsOf(adapterRealm)
    expect(adapterRealm).toMatchObject(realm)
    expect(clients.map(({ clientId }) => clientId)).toEqual([
      "camunda-app",
      "pulse-seed",
      "pulse-reader",
    ])
    for (const client of clients) {
      expect(client, client.clientId).toEqual(adapterClients.get(client.clientId))
    }
  })
})
