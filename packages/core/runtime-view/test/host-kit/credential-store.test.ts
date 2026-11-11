import { describe, expect, test } from "vitest"
import {
  CredentialStore,
  type SecretStorage,
} from "../../src/host-kit/connections/credential-store.js"
import { LOCAL_TARGET, type EngineTarget } from "../../src/host-kit/connections/engine-target.js"

const FILE = "/work/.pulse.json"
const PROD = "https://prod.example.com/engine-rest"

function profile(name: string, endpoint: string, path = FILE): EngineTarget {
  return {
    ...LOCAL_TARGET,
    name,
    endpoint,
    auth: { kind: "basic" },
    source: { kind: "file", path },
  }
}

function inMemorySecrets() {
  const stored = new Map<string, string>()
  const secrets: SecretStorage = {
    get: (key) => Promise.resolve(stored.get(key)),
    store: (key, value) => {
      stored.set(key, value)
      return Promise.resolve()
    },
  }
  return { stored, store: new CredentialStore(secrets) }
}

async function savedFor(endpoint: string) {
  const secrets = inMemorySecrets()
  await secrets.store.write(profile("prod-eu", endpoint), "demo", "s3cret")
  return secrets
}

describe("reading a saved login", () => {
  test("hands the login to the origin it was saved for", async () => {
    const { store } = await savedFor(PROD)
    expect(await store.read(profile("prod-eu", PROD))).toEqual({
      kind: "basic",
      username: "demo",
      password: "s3cret",
    })
  })

  test("keeps the login when only the path of the endpoint changes", async () => {
    const { store } = await savedFor(PROD)
    expect(await store.read(profile("prod-eu", "https://prod.example.com/rest"))).toEqual({
      kind: "basic",
      username: "demo",
      password: "s3cret",
    })
  })

  test.each([
    ["another host", "https://evil.example.com/engine-rest"],
    ["another port", "https://prod.example.com:8443/engine-rest"],
    ["another scheme", "http://prod.example.com/engine-rest"],
  ])("refuses the login once the profile names %s", async (_, endpoint) => {
    const { store } = await savedFor(PROD)
    expect(await store.read(profile("prod-eu", endpoint))).toEqual({
      kind: "savedForAnotherEndpoint",
      savedFor: "https://prod.example.com",
    })
  })

  test("refuses a login saved without its origin", async () => {
    const { stored, store } = await savedFor(PROD)
    stored.delete(`pulse.connection.${FILE}::prod-eu.origin`)
    expect(await store.read(profile("prod-eu", PROD))).toEqual({
      kind: "savedForAnotherEndpoint",
      savedFor: "an unknown endpoint",
    })
  })

  test("finds no login for another profile, another project file or the local engine", async () => {
    const { store } = await savedFor(PROD)
    expect(await store.read(profile("prod-us", PROD))).toEqual({ kind: "none" })
    expect(await store.read(profile("prod-eu", PROD, "/other/.pulse.json"))).toEqual({
      kind: "none",
    })
    expect(await store.read({ ...LOCAL_TARGET, endpoint: PROD })).toEqual({ kind: "none" })
  })

  test.each(["username", "password"])("finds no login whose %s is missing", async (field) => {
    const { stored, store } = await savedFor(PROD)
    stored.delete(`pulse.connection.${FILE}::prod-eu.${field}`)
    expect(await store.read(profile("prod-eu", PROD))).toEqual({ kind: "none" })
  })
})

describe("the secret scope", () => {
  test("follows the modeler scheme of file path and target name", async () => {
    const { stored, store } = inMemorySecrets()
    await store.write(profile("dev", "http://x"), "demo", "demo")
    await store.write(LOCAL_TARGET, "demo", "demo")
    expect([...stored.keys()].filter((key) => key.endsWith(".username"))).toEqual([
      `pulse.connection.${FILE}::dev.username`,
      "pulse.connection.default::local.username",
    ])
  })
})
