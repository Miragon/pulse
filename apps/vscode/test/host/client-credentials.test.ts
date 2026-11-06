import type * as vscode from "vscode"
import { describe, expect, test } from "vitest"
import { CredentialStore } from "../../src/host/connections/credential-store.js"
import type { EngineTarget } from "../../src/host/connections/engine-target.js"
import { TargetPolicy } from "../../src/host/connections/target-policy.js"
import { TargetsParser } from "../../src/host/connections/targets-parser.js"
import { CATALOGUE } from "./support/engines.js"

const FILE = "/work/.pulse-cli.json"
const TOKEN_ENDPOINT = "https://login.cloud.camunda.io/oauth/token"
const BLANK_AUDIENCE = 'profile "c8-saas" needs an auth.audience that is not blank'
const NOT_SCOPES =
  'profile "c8-saas" needs auth.scopes as a list of distinct scopes, such as ["api://pulse/.default"]'
const NOT_A_WEB_URL = 'profile "c8-saas" needs an auth.tokenEndpoint that is an http or https URL'
const WITH_CREDENTIALS = 'profile "c8-saas" needs an auth.tokenEndpoint without credentials'
const WITH_FRAGMENT = 'profile "c8-saas" needs an auth.tokenEndpoint without a fragment'

const TARGET: EngineTarget = {
  name: "c8-saas",
  engine: "c8",
  endpoint: "https://bru-2.api.camunda.io/cluster/v2",
  auth: { kind: "clientCredentials", tokenEndpoint: TOKEN_ENDPOINT },
  source: { kind: "file", path: FILE },
}

function parsedWith(values: Readonly<Record<string, unknown>>) {
  return new TargetsParser(FILE, CATALOGUE).parse(
    JSON.stringify({
      profiles: {
        "c8-saas": {
          url: "https://bru-2.api.camunda.io/cluster/v2",
          flavor: "camunda8",
          auth: { type: "clientCredentials", tokenEndpoint: TOKEN_ENDPOINT, ...values },
        },
      },
    }),
  )
}

function memorySecrets(): vscode.SecretStorage {
  const stored = new Map<string, string>()
  return {
    get: (key: string) => Promise.resolve(stored.get(key)),
    store: (key: string, value: string) => {
      stored.set(key, value)
      return Promise.resolve()
    },
  } as unknown as vscode.SecretStorage
}

describe("a camunda8 profile", () => {
  test("becomes a target of its own engine kind with its token endpoint", () => {
    const parsed = new TargetsParser(FILE, CATALOGUE).parse(
      JSON.stringify({
        profiles: {
          "c8-local": { url: "http://localhost:8080/v2", flavor: "camunda8" },
          "c8-saas": {
            url: "https://bru-2.api.camunda.io/cluster/v2/",
            flavor: "camunda8",
            cockpitUrl: "https://bru-2.api.camunda.io/cluster/operate",
            auth: {
              type: "clientCredentials",
              tokenEndpoint: TOKEN_ENDPOINT,
              audience: "zeebe.camunda.io",
              scopes: ["read"],
            },
          },
        },
      }),
    )

    expect(parsed.problems).toEqual([])
    expect(parsed.targets).toEqual([
      {
        name: "c8-local",
        engine: "c8",
        endpoint: "http://localhost:8080/v2",
        auth: { kind: "none" },
        source: { kind: "file", path: FILE },
      },
      {
        name: "c8-saas",
        engine: "c8",
        endpoint: "https://bru-2.api.camunda.io/cluster/v2",
        auth: {
          kind: "clientCredentials",
          tokenEndpoint: TOKEN_ENDPOINT,
          audience: "zeebe.camunda.io",
          scopes: ["read"],
        },
        source: { kind: "file", path: FILE },
        webUiUrl: "https://bru-2.api.camunda.io/cluster/operate",
      },
    ])
  })

  test("names what is missing instead of guessing", () => {
    const parsed = new TargetsParser(FILE, CATALOGUE).parse(
      JSON.stringify({
        profiles: {
          "no-endpoint": {
            url: "http://localhost:8080/v2",
            flavor: "camunda8",
            auth: { type: "clientCredentials" },
          },
          seven: {
            url: "http://localhost:8080/engine-rest",
            auth: { type: "clientCredentials", tokenEndpoint: TOKEN_ENDPOINT },
          },
        },
      }),
    )

    expect(parsed.targets).toEqual([])
    expect(parsed.problems.map((problem) => problem.message)).toEqual([
      'profile "no-endpoint" needs an auth.tokenEndpoint that is an http or https URL',
      'profile "seven" uses client credentials, which Pulse supports for the flavor camunda8 only',
    ])
  })

  test.each([
    ["an audience that is no text", { audience: 42 }, BLANK_AUDIENCE],
    ["an audience of null", { audience: null }, BLANK_AUDIENCE],
    ["an empty audience", { audience: "" }, BLANK_AUDIENCE],
    ["a blank audience", { audience: "  " }, BLANK_AUDIENCE],
    ["scopes as one text", { scopes: "api://pulse/.default" }, NOT_SCOPES],
    ["scopes of null", { scopes: null }, NOT_SCOPES],
    ["a scope that is no text", { scopes: ["read", 7] }, NOT_SCOPES],
    ["a scope with a space", { scopes: ["read write"] }, NOT_SCOPES],
    ["a scope with a quote", { scopes: ['say"hi'] }, NOT_SCOPES],
    ["a scope listed twice", { scopes: ["read", "read"] }, NOT_SCOPES],
  ])("names %s as a problem, since the CLI refuses it", (_case, values, problem) => {
    const parsed = parsedWith(values)

    expect(parsed.targets).toEqual([])
    expect(parsed.problems.map((found) => found.message)).toEqual([problem])
  })

  test.each([
    ["a trailing slash", "https://authentik.example.com/application/o/token/"],
    ["a query", "https://tenant.b2clogin.com/tenant.onmicrosoft.com/oauth2/v2.0/token?p=B2C_1_app"],
    ["an empty query", "https://login.example.com/oauth/token?"],
    ["a loopback host on plain http", "http://localhost:18089/realms/pulse/token"],
  ])("keeps a token endpoint with %s as written, as the CLI keeps an OAuth endpoint", (_c, url) => {
    const parsed = parsedWith({ tokenEndpoint: url })

    expect(parsed.problems).toEqual([])
    expect(parsed.targets.map((target) => target.auth)).toEqual([
      { kind: "clientCredentials", tokenEndpoint: url },
    ])
  })

  test("trims the token endpoint and keeps the rest of it, as the CLI does", () => {
    const parsed = parsedWith({ tokenEndpoint: "  https://login.example.com/o/token/  " })

    expect(parsed.targets.map((target) => target.auth)).toEqual([
      { kind: "clientCredentials", tokenEndpoint: "https://login.example.com/o/token/" },
    ])
  })

  test.each([
    ["no text", 42, NOT_A_WEB_URL],
    ["a blank text", "  ", NOT_A_WEB_URL],
    ["a text that is no URL", "login.example.com/oauth/token", NOT_A_WEB_URL],
    ["another scheme", "ftp://login.example.com/oauth/token", NOT_A_WEB_URL],
    ["credentials", "https://pulse:s3cret@login.example.com/oauth/token", WITH_CREDENTIALS],
    ["a username", "https://pulse@login.example.com/oauth/token", WITH_CREDENTIALS],
    ["a fragment", "https://login.example.com/oauth/token#top", WITH_FRAGMENT],
    ["an empty fragment", "https://login.example.com/oauth/token#", WITH_FRAGMENT],
    ["a query and an empty fragment", "https://login.example.com/oauth/token?p=1#", WITH_FRAGMENT],
  ])("names the rule a token endpoint with %s breaks", (_case, tokenEndpoint, problem) => {
    const parsed = parsedWith({ tokenEndpoint })

    expect(parsed.targets).toEqual([])
    expect(parsed.problems.map((found) => found.message)).toEqual([problem])
  })

  test("names the scopes first when the audience is wrong too, as the CLI does", () => {
    const parsed = parsedWith({ scopes: "api://pulse/.default", audience: "" })

    expect(parsed.problems.map((found) => found.message)).toEqual([NOT_SCOPES])
  })

  test("takes an empty list of scopes and an audience the CLI accepts as written", () => {
    const parsed = parsedWith({ audience: "api://pulse", scopes: [] })

    expect(parsed.problems).toEqual([])
    expect(parsed.targets.map((target) => target.auth)).toEqual([
      {
        kind: "clientCredentials",
        tokenEndpoint: TOKEN_ENDPOINT,
        audience: "api://pulse",
        scopes: [],
      },
    ])
  })
})

describe("a saved client secret", () => {
  test("reads back as client credentials for the target it was saved for", async () => {
    const store = new CredentialStore(memorySecrets())

    await store.write(TARGET, "pulse", "s3cret")

    expect(await store.read(TARGET)).toEqual({
      kind: "clientCredentials",
      clientId: "pulse",
      clientSecret: "s3cret",
    })
  })

  test("does not follow a token endpoint that a changed project file points elsewhere", async () => {
    const store = new CredentialStore(memorySecrets())
    await store.write(TARGET, "pulse", "s3cret")
    const redirected: EngineTarget = {
      ...TARGET,
      auth: { kind: "clientCredentials", tokenEndpoint: "https://evil.example.com/oauth/token" },
    }

    const read = await store.read(redirected)

    expect(read.kind).toBe("savedForAnotherEndpoint")
    expect(JSON.stringify(read)).not.toContain("s3cret")
    expect(TargetPolicy.refusal(redirected, read)).toBe(
      "The endpoint of c8-saas moved from https://bru-2.api.camunda.io and https://login.cloud.camunda.io to https://bru-2.api.camunda.io and https://evil.example.com since you saved its credentials. Check the change, then set the credentials again.",
    )
  })

  test("does not follow an endpoint that a changed project file points elsewhere", async () => {
    const store = new CredentialStore(memorySecrets())
    await store.write(TARGET, "pulse", "s3cret")
    const moved: EngineTarget = { ...TARGET, endpoint: "https://bru-2.api-camunda.io/cluster/v2" }

    const read = await store.read(moved)

    expect(read.kind).toBe("savedForAnotherEndpoint")
    expect(TargetPolicy.refusal(moved, read)).toBe(
      "The endpoint of c8-saas moved from https://bru-2.api.camunda.io and https://login.cloud.camunda.io to https://bru-2.api-camunda.io and https://login.cloud.camunda.io since you saved its credentials. Check the change, then set the credentials again.",
    )
  })

  test("does not turn into basic credentials when the profile drops its token endpoint", async () => {
    const store = new CredentialStore(memorySecrets())
    await store.write(TARGET, "pulse", "s3cret")

    const read = await store.read({ ...TARGET, auth: { kind: "basic" } })

    expect(read).toEqual({
      kind: "savedForAnotherEndpoint",
      savedFor: "https://bru-2.api.camunda.io and https://login.cloud.camunda.io",
    })
  })

  test("is not sent over plain HTTP to a remote endpoint or token endpoint", () => {
    const none = { kind: "none" } as const
    expect(
      TargetPolicy.refusal({ ...TARGET, endpoint: "http://c8.example.com/v2" }, none),
    ).toContain("plain HTTP")
    expect(
      TargetPolicy.refusal(
        {
          ...TARGET,
          auth: { kind: "clientCredentials", tokenEndpoint: "http://login.example.com/token" },
        },
        none,
      ),
    ).toContain("plain HTTP")
    expect(
      TargetPolicy.refusal(
        {
          ...TARGET,
          endpoint: "http://localhost:8080/v2",
          auth: { kind: "clientCredentials", tokenEndpoint: "http://localhost:18080/token" },
        },
        none,
      ),
    ).toBeUndefined()
  })
})
