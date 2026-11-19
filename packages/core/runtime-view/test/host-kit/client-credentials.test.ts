import { describe, expect, test } from "vitest"
import {
  CredentialStore,
  type SecretStorage,
} from "../../src/host-kit/connections/credential-store.js"
import type { EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { TargetLogin } from "../../src/host-kit/connections/target-login.js"
import { TargetPolicy } from "../../src/host-kit/connections/target-policy.js"
import { LOCAL_TARGET } from "./support/local-target.js"

const FILE = "/work/.pulse.json"
const OWN = "/home/dev/.config/pulse-cli/config.json"
const TOKEN_ENDPOINT = "https://login.cloud.camunda.io/oauth/token"
const NONE = { kind: "none" } as const

const SAAS: EngineTarget = {
  name: "c8-saas",
  engine: "c8",
  endpoint: "https://bru-2.api.camunda.io/cluster/v2",
  auth: { kind: "clientCredentials", tokenEndpoint: TOKEN_ENDPOINT },
  source: { kind: "file", path: FILE },
}

const NAMED_CLIENT: EngineTarget = {
  ...SAAS,
  auth: { kind: "clientCredentials", tokenEndpoint: TOKEN_ENDPOINT, clientId: "pulse" },
}

const KEYCLOAK: EngineTarget = {
  ...SAAS,
  name: "c8-local",
  endpoint: "http://localhost:18088/v2",
  auth: {
    kind: "clientCredentials",
    tokenEndpoint: "http://localhost:18089/realms/pulse/protocol/openid-connect/token",
    clientId: "pulse-reader",
    audience: "camunda",
  },
}

const SHOP: EngineTarget = {
  name: "shop-prod",
  engine: "c7",
  endpoint: "https://shop.example.com:8443/engine-rest",
  auth: { kind: "basic" },
  source: { kind: "file", path: FILE },
}

function memorySecrets() {
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

describe("a saved client secret", () => {
  test("reads back with the client ID it was saved with, for the target it was saved for", async () => {
    const { stored, store } = memorySecrets()

    await store.write(SAAS, { identity: "pulse", secret: "s3cret" })

    expect(await store.read(SAAS)).toEqual({
      kind: "clientCredentials",
      clientId: "pulse",
      clientSecret: "s3cret",
    })
    expect([...stored.keys()]).toEqual([
      `pulse.connection.${FILE}::c8-saas.clientId`,
      `pulse.connection.${FILE}::c8-saas.clientSecret`,
      `pulse.connection.${FILE}::c8-saas.clientOrigins`,
    ])
  })

  test("takes the client ID the profile names, and keeps only the secret", async () => {
    const { stored, store } = memorySecrets()

    await store.write(NAMED_CLIENT, { secret: "s3cret" })

    expect(await store.read(NAMED_CLIENT)).toEqual({
      kind: "clientCredentials",
      clientId: "pulse",
      clientSecret: "s3cret",
    })
    expect(stored.has(`pulse.connection.${FILE}::c8-saas.clientId`)).toBe(false)
  })

  test("prefers the client ID of the profile over one saved before the profile named it", async () => {
    const { store } = memorySecrets()
    await store.write(SAAS, { identity: "former", secret: "s3cret" })

    expect(await store.read(NAMED_CLIENT)).toMatchObject({ clientId: "pulse" })
  })

  test("is no login without a client ID, from the profile or saved", async () => {
    const { store } = memorySecrets()

    await store.write(SAAS, { secret: "s3cret" })

    expect(await store.read(SAAS)).toEqual(NONE)
  })

  test("does not follow a token endpoint that a changed project file points elsewhere", async () => {
    const { store } = memorySecrets()
    await store.write(SAAS, { identity: "pulse", secret: "s3cret" })
    const redirected: EngineTarget = {
      ...SAAS,
      auth: { kind: "clientCredentials", tokenEndpoint: "https://evil.example.com/oauth/token" },
    }

    const read = await store.read(redirected)

    expect(read.kind).toBe("savedForAnotherEndpoint")
    expect(JSON.stringify(read)).not.toContain("s3cret")
    expect(TargetPolicy.refusal(redirected, read)).toBe(
      "The endpoint of c8-saas moved from https://bru-2.api.camunda.io and https://login.cloud.camunda.io to https://bru-2.api.camunda.io and https://evil.example.com since you saved its credentials. Check the change, then set the credentials again.",
    )
  })

  test("does not follow a cluster URL that a changed project file points elsewhere", async () => {
    const { store } = memorySecrets()
    await store.write(SAAS, { identity: "pulse", secret: "s3cret" })
    const moved: EngineTarget = { ...SAAS, endpoint: "https://bru-2.api-camunda.io/cluster/v2" }

    const read = await store.read(moved)

    expect(TargetPolicy.refusal(moved, read)).toBe(
      "The endpoint of c8-saas moved from https://bru-2.api.camunda.io and https://login.cloud.camunda.io to https://bru-2.api-camunda.io and https://login.cloud.camunda.io since you saved its credentials. Check the change, then set the credentials again.",
    )
  })

  test("never turns into a basic login when the profile changes its auth type, nor back", async () => {
    const { store } = memorySecrets()
    await store.write(SAAS, { identity: "pulse", secret: "s3cret" })
    await store.write(SHOP, { identity: "demo", secret: "demo-secret" })

    expect(await store.read({ ...SAAS, auth: { kind: "basic" } })).toEqual(NONE)
    expect(
      await store.read({
        ...SHOP,
        auth: { kind: "clientCredentials", tokenEndpoint: TOKEN_ENDPOINT },
      }),
    ).toEqual(NONE)
    expect(await store.read({ ...SAAS, auth: { kind: "none" } })).toEqual(NONE)
  })

  test("keeps the basic login of a target under its keys of before", async () => {
    const { stored, store } = memorySecrets()

    await store.write(SHOP, { identity: "demo", secret: "demo-secret" })

    expect([...stored.entries()]).toEqual([
      [`pulse.connection.${FILE}::shop-prod.username`, "demo"],
      [`pulse.connection.${FILE}::shop-prod.password`, "demo-secret"],
      [`pulse.connection.${FILE}::shop-prod.origin`, "https://shop.example.com:8443"],
    ])
  })

  test("saves nothing for a target that takes no login", async () => {
    const { stored, store } = memorySecrets()

    await store.write(LOCAL_TARGET, { identity: "demo", secret: "demo" })
    await store.write({ ...SHOP, auth: { kind: "oauth2" } }, { identity: "demo", secret: "demo" })

    expect(stored.size).toBe(0)
  })
})

describe("the target policy on client credentials", () => {
  test.each([
    [
      "a remote token endpoint on plain HTTP",
      {
        ...SAAS,
        auth: { kind: "clientCredentials", tokenEndpoint: "http://login.example.com/token" },
      },
      "c8-saas would send its client secret over plain HTTP. Use an https token endpoint.",
    ],
    [
      "a remote cluster on plain HTTP",
      { ...SAAS, endpoint: "http://c8.example.com/v2" },
      "c8-saas would send its tokens over plain HTTP. Use an https endpoint.",
    ],
  ] as const)("refuses %s", (_, target, refusal) => {
    expect(TargetPolicy.refusal(target, NONE)).toBe(refusal)
  })

  test.each([
    ["the stack c8:up starts", KEYCLOAK],
    [
      "a cluster on 127.0.0.1 and a token endpoint on [::1]",
      {
        ...KEYCLOAK,
        endpoint: "http://127.0.0.1:18088/v2",
        auth: { kind: "clientCredentials", tokenEndpoint: "http://[::1]:18089/token" },
      },
    ],
    [
      "a token endpoint elsewhere on 127.0.0.0/8, the loopback of the profile format",
      {
        ...KEYCLOAK,
        auth: { kind: "clientCredentials", tokenEndpoint: "http://127.0.0.2:18089/token" },
      },
    ],
    ["https everywhere", SAAS],
  ] as const)("lets %s connect", (_, target) => {
    expect(TargetPolicy.refusal(target, NONE)).toBeUndefined()
  })
})

describe("the login a target asks for", () => {
  test.each([
    [
      "a basic login, sent to the engine",
      SHOP,
      { identity: "Username", secret: "Password" },
      "Pulse sends it to shop.example.com:8443.",
    ],
    [
      "the client ID and secret the profile lacks, sent to the token endpoint",
      SAAS,
      { identity: "Client ID", secret: "Client secret" },
      "Pulse sends it to login.cloud.camunda.io and the tokens it gets to bru-2.api.camunda.io.",
    ],
    [
      "only the secret of the client the profile names",
      KEYCLOAK,
      { secret: "Client secret" },
      "Pulse sends it to localhost:18089 and the tokens it gets to localhost:18088.",
    ],
  ] as const)("is %s", (_, target, fields, sendsTo) => {
    expect(TargetLogin.of(target)).toEqual({ fields, sendsTo })
  })

  test.each([
    [
      "a profile without a login",
      { ...SAAS, name: "c8-open", auth: { kind: "none" } },
      "The profile c8-open uses auth.type none, so Pulse sends no login. Set its auth.type to basic or clientCredentials in .pulse.json.",
    ],
    [
      "a Camunda 7 profile of the CLI's config without a login",
      { ...SHOP, auth: { kind: "none" }, source: { kind: "user-config", path: OWN } },
      "The profile shop-prod uses auth.type none, so Pulse sends no login. Set its auth.type to basic in your CLI config.",
    ],
    [
      "the default engine",
      LOCAL_TARGET,
      "local has no profile, so Pulse sends no login. Add a profile with auth.type basic to .pulse.json or your CLI config.",
    ],
    [
      "an OAuth login of a person",
      { ...SHOP, name: "shop-sso", auth: { kind: "oauth2" } },
      'Profile "shop-sso" uses auth.type oauth, which this client cannot authenticate with. Set auth.type to none, or to basic without the OAuth keys, or keep this profile for the CLI.',
    ],
    [
      "a login it would send over plain HTTP",
      { ...SHOP, endpoint: "http://shop-test.example.com/engine-rest" },
      "shop-prod would send basic credentials over plain HTTP. Use an https endpoint.",
    ],
  ] as const)("is none for %s, which says why", (_, target, refused) => {
    expect(TargetLogin.of(target)).toEqual({ refused })
  })
})
