import type * as vscode from "vscode"
import { describe, expect, test } from "vitest"
import { CredentialStore } from "../../src/host/connections/credential-store.js"
import type { EngineTarget } from "../../src/host/connections/engine-target.js"
import { TargetPolicy } from "../../src/host/connections/target-policy.js"
import { TargetsParser } from "../../src/host/connections/targets-parser.js"

const FILE = "/work/.pulse-cli.json"
const TOKEN_ENDPOINT = "https://login.cloud.camunda.io/oauth/token"
const BLANK_AUDIENCE = 'profile "c8-saas" needs an auth.audience that is not blank'
const NOT_SCOPES =
  'profile "c8-saas" needs auth.scopes as a list of distinct scopes, such as ["api://pulse/.default"]'

const TARGET: EngineTarget = {
  name: "c8-saas",
  engine: "c8",
  endpoint: "https://bru-2.api.camunda.io/cluster/v2",
  auth: { kind: "clientCredentials", tokenEndpoint: TOKEN_ENDPOINT },
  source: { kind: "file", path: FILE },
}

function parsedWith(values: Readonly<Record<string, unknown>>) {
  return new TargetsParser(FILE).parse(
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
    const parsed = new TargetsParser(FILE).parse(
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
    const parsed = new TargetsParser(FILE).parse(
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
    expect(TargetPolicy.refusal(redirected, read)).toContain("Set the credentials again")
  })

  test("does not follow an endpoint that a changed project file points elsewhere", async () => {
    const store = new CredentialStore(memorySecrets())
    await store.write(TARGET, "pulse", "s3cret")

    const read = await store.read({ ...TARGET, endpoint: "https://evil.example.com/v2" })

    expect(read.kind).toBe("savedForAnotherEndpoint")
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
