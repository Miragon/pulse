import { describe, expect, it } from "vitest"
import { loadEngineProfiles } from "./engine-profiles.js"

const A = "http://a.example/engine-rest"

const thrownBy = (env: NodeJS.ProcessEnv): Error => {
  try {
    loadEngineProfiles(env)
  } catch (error) {
    return error as Error
  }
  throw new Error("the profiles loaded")
}

describe("the single engine: ENGINE_BASE_URL and its siblings yield one profile", () => {
  it("maps every setting, the secret read from its variable", () => {
    expect(
      loadEngineProfiles({
        ENGINE_BASE_URL: ` ${A} `,
        ENGINE_ID: "prod-a",
        ENGINE_FLAVOR: "cibseven",
        ENGINE_COCKPIT_URL: "https://ops.example.com/webapp/",
        ENGINE_AUTH_TYPE: "basic",
        ENGINE_USERNAME: "demo",
        ENGINE_PASSWORD: "demo-secret",
      }),
    ).toEqual({
      engines: [
        {
          id: "prod-a",
          baseUrl: A,
          cockpitUrl: "https://ops.example.com/webapp/",
          flavor: "cibseven",
          auth: { type: "basic", username: "demo", password: "demo-secret" },
        },
      ],
      refused: [],
      engineIds: ["prod-a"],
      profileCount: 1,
      warnings: [],
    })
  })

  it("without any engine setting: the local default, named ENGINE_ID or default", () => {
    expect(loadEngineProfiles({}).engines).toEqual([
      { id: "default", baseUrl: "http://localhost:8410/engine-rest" },
    ])
    expect(
      loadEngineProfiles({ ENGINE_ID: "local", ENGINE_COCKPIT_URL: "http://c" }).engines,
    ).toEqual([{ id: "local", baseUrl: "http://localhost:8410/engine-rest" }])
  })

  it("takes a user name only with Basic auth, a token only with a bearer", () => {
    expect(
      loadEngineProfiles({
        ENGINE_BASE_URL: A,
        ENGINE_AUTH_TYPE: "bearer",
        ENGINE_USERNAME: "ignored",
        ENGINE_TOKEN: "tok",
      }).engines[0].auth,
    ).toEqual({ type: "bearer", token: "tok" })
    expect(
      loadEngineProfiles({ ENGINE_BASE_URL: A, ENGINE_USERNAME: "u", ENGINE_PASSWORD: "p" })
        .engines[0].auth,
    ).toBeUndefined()
  })

  it.each<[NodeJS.ProcessEnv, string]>([
    [
      { ENGINE_BASE_URL: "localhost:8410/engine-rest" },
      "ENGINE_BASE_URL: url must start with http:// or https://.",
    ],
    [
      { ENGINE_BASE_URL: A, ENGINE_COCKPIT_URL: "a.example/camunda" },
      "ENGINE_COCKPIT_URL: cockpitUrl is no URL: use a URL such as http://localhost:8080/engine-rest.",
    ],
    [
      { ENGINE_ID: "-x", ENGINE_FLAVOR: "flowable" },
      'ENGINE_ID: The profile\'s name is not valid (it is not shown): use letters, digits, ".", "_" and "-", starting with a letter or digit. ENGINE_FLAVOR: flavor must be one of camunda7, cibseven, operaton (the value is not shown).',
    ],
    [
      { ENGINE_AUTH_TYPE: "Basic" },
      "ENGINE_AUTH_TYPE: auth.type must be one of none, basic, bearer, oauth, passthrough (the value is not shown).",
    ],
    [
      { ENGINE_AUTH_TYPE: "oauth" },
      "ENGINE_AUTH_TYPE: This server cannot sign in with this auth.type: it signs in with none, basic, bearer or passthrough, and an OAuth login needs a person.",
    ],
    [
      { ENGINE_AUTH_TYPE: "basic", ENGINE_USERNAME: "demo" },
      "ENGINE_AUTH_TYPE=basic needs ENGINE_USERNAME and ENGINE_PASSWORD; otherwise engine requests would run unauthenticated.",
    ],
    [
      { ENGINE_AUTH_TYPE: "basic", ENGINE_PASSWORD: "pw" },
      "ENGINE_AUTH_TYPE=basic needs ENGINE_USERNAME and ENGINE_PASSWORD; otherwise engine requests would run unauthenticated.",
    ],
    [
      { ENGINE_AUTH_TYPE: "basic", ENGINE_USERNAME: "de:mo", ENGINE_PASSWORD: "pw" },
      'ENGINE_USERNAME: auth.username must be a non-empty string without ":" and without control characters.',
    ],
    [
      { ENGINE_AUTH_TYPE: "bearer" },
      "ENGINE_AUTH_TYPE=bearer needs ENGINE_TOKEN; otherwise engine requests would run unauthenticated.",
    ],
    [
      { ENGINE_AUTH_TYPE: "bearer", ENGINE_TOKEN: "a\nb" },
      "ENGINE_TOKEN holds a character no bearer token (RFC 6750) carries, a line break inside it, say (one at its end is trimmed); the value is not shown.",
    ],
    [
      { ENGINE_AUTH_TYPE: "basic", ENGINE_USERNAME: "u", ENGINE_PASSWORD: "p\u0000" },
      "ENGINE_USERNAME or ENGINE_PASSWORD holds a control character (a line break, say), which Basic auth (RFC 7617) cannot carry; the value is not shown.",
    ],
  ])("refused: the boot fails naming the variable %#", (env, message) => {
    expect(thrownBy(env).message).toBe(message)
  })
})
