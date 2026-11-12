import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { PROBLEM_CODES } from "@miragon/pulse-profile"
import { NOT_SERVED } from "./engine-profile-words.js"
import { loadEngineProfiles, referencedVariables, SERVER_SURFACE } from "./engine-profiles.js"

const A = "http://a.example/engine-rest"
const B = "http://b.example/engine-rest"
/**
 * A GitHub token: 40 characters of the shape the parser names as a key. Joined at run time, so the
 * source holds no token-shaped literal that a secret scanner (the docs preview's) takes for a leak.
 */
const TOKEN_KEY = ["ghp", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("_")

/** ENGINES_JSON holding `profiles`, with a `defaultProfile` when given. */
const filed = (profiles: Record<string, unknown>, defaultProfile?: string): NodeJS.ProcessEnv => ({
  ENGINES_JSON: JSON.stringify({
    ...(defaultProfile === undefined ? {} : { defaultProfile }),
    profiles,
  }),
})

const thrownBy = (env: NodeJS.ProcessEnv): Error => {
  try {
    loadEngineProfiles(env)
  } catch (error) {
    return error as Error
  }
  throw new Error("the profiles loaded")
}

describe("a profile maps onto the engine the transport connects to", () => {
  it("takes its name as the id, url as the REST root and every key the server applies", () => {
    const { engines, refused, engineIds, profileCount } = loadEngineProfiles({
      ...filed({
        "prod-a": {
          url: `${A}/`,
          cockpitUrl: " https://ops.example.com/webapp/ ",
          flavor: "cibseven",
          environment: "prod",
          readOnly: true,
          timeout: 5_000,
          output: "json",
          engine: "default",
          auth: { type: "basic", username: "svc", passwordEnv: "ENGINE_SECRET_PROD_A" },
        },
        b: { url: B, auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_B" } },
        c: { url: "http://c.example/engine-rest", auth: { type: "passthrough" } },
      }),
      ENGINE_SECRET_PROD_A: "pw-a",
      ENGINE_SECRET_B: "tok-b",
    })
    expect(engines).toEqual([
      {
        id: "prod-a",
        baseUrl: A,
        cockpitUrl: "https://ops.example.com/webapp/",
        environment: "prod",
        flavor: "cibseven",
        auth: { type: "basic", username: "svc", password: "pw-a" },
        readOnly: true,
        timeoutMs: 5_000,
      },
      { id: "b", baseUrl: B, auth: { type: "bearer", token: "tok-b" } },
      { id: "c", baseUrl: "http://c.example/engine-rest", auth: { type: "passthrough" } },
    ])
    expect([refused, engineIds, profileCount]).toEqual([[], ["prod-a", "b", "c"], 3])
  })

  it("serves the C7 dialect, four auth types, a url, the default process engine, no headers", () => {
    expect(SERVER_SURFACE).toEqual({
      dialects: ["c7"],
      authTypes: ["none", "basic", "bearer", "passthrough"],
      urlRequired: true,
      defaultEngineOnly: true,
      refusedKeys: ["headers"],
    })
  })

  it("keeps cockpitUrl as written, blanks around it trimmed, where the format drops its tail", () => {
    const written = (cockpitUrl: string) =>
      loadEngineProfiles(filed({ a: { url: A, cockpitUrl } })).engines[0].cockpitUrl
    expect(written("https://ops.example.com/camunda/app/cockpit/default/")).toBe(
      "https://ops.example.com/camunda/app/cockpit/default/",
    )
    expect(written(" https://ops.example.com/webapp/#/ ")).toBe("https://ops.example.com/webapp/#/")
    expect(written("https://ops.example.com/webapp")).toBe("https://ops.example.com/webapp")
  })

  it("keeps the order of the file, a name of digits included", () => {
    // A JS object would move the digits first: the text says the order.
    const { engineIds } = loadEngineProfiles({
      ENGINES_JSON: `{"profiles":{"z":{"url":"${A}"},"42":{"url":"${B}"}}}`,
    })
    expect(engineIds).toEqual(["z", "42"])
  })
})

describe("a profile the server cannot use is refused on its own", () => {
  /** The one refused profile `profile` gives next to a usable one. */
  const refusalOf = (profile: unknown, env: NodeJS.ProcessEnv = {}) => {
    const loaded = loadEngineProfiles({ ...filed({ ok: { url: A }, x: profile }), ...env })
    expect(loaded.engines.map(({ id }) => id)).toEqual(["ok"])
    expect(loaded.engineIds).toEqual(["ok", "x"])
    return { refused: loaded.refused, warnings: loaded.warnings }
  }

  it.each<[string, unknown, string]>([
    ["headers", { url: B, headers: { "X-Team": "ops" } }, "This server does not apply headers"],
    ["a process engine name", { url: B, engine: "orders" }, "engine names a process engine"],
    [
      "an OAuth login",
      { url: B, auth: { type: "oauth", issuer: "https://login.example" } },
      "This server cannot sign in with this auth.type",
    ],
    ["no url", { flavor: "cibseven" }, "url is missing"],
    [
      "Basic auth without a user name",
      { url: B, auth: { type: "basic", passwordEnv: "ENGINE_SECRET_X" } },
      "auth.username is missing: Basic auth needs a user name.",
    ],
    [
      "Basic auth without a password variable",
      { url: B, auth: { type: "basic", username: "svc" } },
      "auth.passwordEnv is missing",
    ],
    [
      "a bearer token without its variable",
      { url: B, auth: { type: "bearer" } },
      "auth.tokenEnv is missing",
    ],
    [
      "a literal password",
      { url: B, auth: { type: "basic", username: "svc", password: "pw" } },
      "auth.password holds a secret itself",
    ],
    [
      "a variable outside ENGINE_SECRET_",
      { url: B, auth: { type: "bearer", tokenEnv: "MCP_METRICS_TOKEN" } },
      "must name a variable that starts with ENGINE_SECRET_",
    ],
    [
      "a URL with credentials",
      { url: "https://svc:pw@b.example/engine-rest" },
      "url must not contain credentials",
    ],
    [
      "a URL with a query",
      { url: `${B}?token=x` },
      "url must not contain a query string or a fragment",
    ],
    [
      "a cockpit URL with a fragment",
      { url: B, cockpitUrl: "https://b.example/webapp#x" },
      "cockpitUrl must not contain a query string or a fragment",
    ],
    ["an unknown flavor", { url: B, flavor: "flowable" }, "flavor must be one of"],
    [
      "an unknown key",
      { url: B, readOnyl: true },
      "The profile holds a key the profile format does not know (it is not shown).",
    ],
  ])("%s", (_case, profile, says) => {
    const { refused } = refusalOf(profile)
    expect(refused).toHaveLength(1)
    expect(refused[0].id).toBe("x")
    expect(refused[0].reason).toContain(says)
  })

  it("a variable that is not set: the model reads the key, the operator the variable too", () => {
    const { refused, warnings } = refusalOf({
      url: B,
      environment: "prod",
      auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_PROD_B_TOKEN" },
    })
    expect(refused).toEqual([
      { id: "x", environment: "prod", reason: "auth.tokenEnv names a variable that is not set." },
    ])
    expect(warnings).toEqual([
      'Profile "x" (ENGINES_JSON) is refused: auth.tokenEnv names ENGINE_SECRET_PROD_B_TOKEN, which is not set. A call to this engine fails with that reason; the other engines run.',
    ])
  })

  it("an empty variable counts as not set", () => {
    const { refused } = refusalOf(
      { url: B, auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_B" } },
      { ENGINE_SECRET_B: "" },
    )
    expect(refused[0].reason).toBe("auth.tokenEnv names a variable that is not set.")
  })

  it("names a variable only in its conventional form, else only the key", () => {
    const token = "ENGINE_SECRET_ghp16C7e42F292c6912E7710c838347Ae178B4a"
    const { refused, warnings } = refusalOf({
      url: B,
      auth: { type: "bearer", tokenEnv: token },
    })
    expect(JSON.stringify([refused, warnings])).not.toContain(token)
    expect(warnings[0]).toContain("auth.tokenEnv names a variable that is not set.")
  })

  it("a credential the transport cannot send refuses the profile, never echoing it", () => {
    const { refused } = refusalOf(
      { url: B, auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_B" } },
      { ENGINE_SECRET_B: "tok-1\nsecond-line" },
    )
    expect(refused[0].reason).toBe(
      "The token auth.tokenEnv names holds a character no bearer token (RFC 6750) carries, a line break inside it, say (one at its end is trimmed); the value is not shown.",
    )
    const basic = refusalOf(
      { url: B, auth: { type: "basic", username: "svc", passwordEnv: "ENGINE_SECRET_P" } },
      { ENGINE_SECRET_P: "pw\u0000" },
    )
    expect(basic.refused[0].reason).toContain("holds a control character")
  })

  it("words what the server cannot serve as the server's, never as the client's", () => {
    const reasons = [
      { url: B, headers: { "X-Team": "ops" } },
      { url: B, engine: "orders" },
      { url: B, auth: { type: "oauth", issuer: "https://login.example" } },
      { flavor: "cibseven" },
    ].map((profile) => {
      const { refused, warnings } = refusalOf(profile)
      expect(warnings[0]).toContain(refused[0].reason)
      return refused[0].reason
    })
    for (const reason of reasons) expect(reason).not.toMatch(/client/i)
    expect(reasons.every((reason) => /\bthis server\b/i.test(reason))).toBe(true)
    // The auth types it names are the ones it serves.
    const [last, ...rest] = [...SERVER_SURFACE.authTypes].reverse()
    expect(reasons[2]).toContain(`with ${rest.reverse().join(", ")} or ${last},`)
  })

  it("has its own words for every code a reader refuses a profile with", () => {
    const readerCodes = PROBLEM_CODES.slice(PROBLEM_CODES.indexOf("dialect-not-served"))
    expect(Object.keys(NOT_SERVED).sort()).toEqual([...readerCodes].sort())
    for (const words of Object.values(NOT_SERVED)) {
      expect(words("headers")).toMatch(/\b[Tt]his server\b/)
      expect(words(undefined)).not.toMatch(/client|undefined/)
    }
  })

  /** A token pasted where a key goes has the shape of a key, and the parser names such a key. */
  it.each([
    ["the profile", { url: B, [TOKEN_KEY]: "x" }, "The profile", TOKEN_KEY],
    ["auth", { url: B, auth: { type: "none", [TOKEN_KEY]: "x" } }, "auth", `auth.${TOKEN_KEY}`],
  ])("a key-shaped token in %s reaches the operator's log only", (_place, profile, owner, key) => {
    const { refused, warnings } = refusalOf(profile)
    expect(refused[0].reason).toBe(
      `${owner} holds a key the profile format does not know (it is not shown).`,
    )
    expect(warnings[0]).toContain(`${key} is no key of a profile.`)
  })

  it("a header named twice is named to the operator only", () => {
    const { refused, warnings } = refusalOf({ url: B, headers: { "X-A": "1", "x-a": "2" } })
    expect(refused[0].reason).toBe("A key that is not shown is set twice: set it once.")
    expect(warnings[0]).toContain("headers.x-a is set twice")
  })

  it("a name that is not valid is counted, never listed, and warned about by its place", () => {
    const loaded = loadEngineProfiles(filed({ ok: { url: A }, "not valid": { url: B } }))
    expect(loaded.refused).toEqual([])
    expect(loaded.engineIds).toEqual(["ok"])
    expect(loaded.profileCount).toBe(2)
    expect(loaded.warnings).toEqual([
      'Profile 2 of ENGINES_JSON is refused: The profile\'s name is not valid (it is not shown): use letters, digits, ".", "_" and "-", starting with a letter or digit. No call can name it; the other engines run.',
    ])
  })
})

describe("the boot fails on the file only when it gives no engine to run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-profiles-"))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const OLD_TAIL =
    'It now holds one profile file: {"defaultProfile": "<name>", "profiles": {"<id>": {"url": "…", "flavor": "…", "environment": "…", "auth": {…}}}}. An entry\'s id becomes its key and baseUrl becomes url. A secret leaves the JSON: auth.password becomes auth.passwordEnv and auth.token becomes auth.tokenEnv, each naming the variable that holds it, a name that starts with ENGINE_SECRET_.'

  it("a list of engines, the form up to 0.27, says what it becomes", () => {
    expect(thrownBy({ ENGINES_JSON: JSON.stringify([{ id: "a", baseUrl: A }]) }).message).toBe(
      `ENGINES_JSON holds a JSON array, the form up to 0.27. ${OLD_TAIL}`,
    )
  })

  it("an environment map, the form up to 0.27, says what it becomes, for ENGINES_FILE too", () => {
    const map = JSON.stringify({ prod: [{ id: "a", baseUrl: A }] })
    expect(thrownBy({ ENGINES_JSON: map }).message).toBe(
      `ENGINES_JSON holds an environment map, the form up to 0.27: each key becomes "environment" on its profiles. ${OLD_TAIL}`,
    )
    const file = path.join(dir, "map.json")
    fs.writeFileSync(file, map)
    expect(thrownBy({ ENGINES_FILE: file }).message).toMatch(
      new RegExp(`^ENGINES_FILE=${file} holds an environment map`),
    )
  })

  it.each([
    ["no object", "42", "ENGINES_JSON: The file must hold one JSON object."],
    [
      "profiles no object",
      '{"profiles":[]}',
      "ENGINES_JSON: profiles must be a JSON object that maps each profile name to a profile.",
    ],
    [
      "a root key twice",
      '{"profiles":{},"profiles":{}}',
      "ENGINES_JSON: profiles is set twice, and JSON keeps only the last one without a word: set it once.",
    ],
    [
      "no profile",
      "{}",
      'ENGINES_JSON names no profile: it holds {"profiles": {"<id>": {"url": "…"}}}.',
    ],
    [
      "empty profiles",
      '{"profiles":{}}',
      'ENGINES_JSON names no profile: it holds {"profiles": {"<id>": {"url": "…"}}}.',
    ],
    [
      "empty profiles with a defaultProfile, which names none of none",
      '{"defaultProfile":"z","profiles":{}}',
      'ENGINES_JSON names no profile: it holds {"profiles": {"<id>": {"url": "…"}}}.',
    ],
  ])("%s", (_case, json, message) => {
    expect(thrownBy({ ENGINES_JSON: json }).message).toBe(message)
  })

  it("no usable profile names each refused one with its reasons", () => {
    const env = {
      ...filed({
        a: { url: A, headers: { "X-A": "b" } },
        b: { url: B, auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_B" } },
      }),
    }
    expect(thrownBy(env).message).toBe(
      'ENGINES_JSON: no profile is usable. Profile "a" (ENGINES_JSON) is refused: This server does not apply headers, so it refuses the profile rather than ignore it. Profile "b" (ENGINES_JSON) is refused: auth.tokenEnv names ENGINE_SECRET_B, which is not set.',
    )
  })

  it("a defaultProfile that names no profile fails the boot: a call would go elsewhere", () => {
    expect(thrownBy(filed({ a: { url: A }, b: { url: B } }, "c")).message).toBe(
      "ENGINES_JSON: defaultProfile names no profile of this file. It must name one of its profiles: a, b.",
    )
    expect(thrownBy(filed({ a: { url: A } }, "not valid")).message).toMatch(
      /^ENGINES_JSON: defaultProfile must name a profile: /,
    )
  })

  it("a defaultProfile that names one, a refused one too, is the default", () => {
    expect(loadEngineProfiles(filed({ a: { url: A }, b: { url: B } }, "b")).defaultProfile).toBe(
      "b",
    )
    const refused = loadEngineProfiles(filed({ a: { url: A }, b: { headers: {} } }, "b"))
    expect([refused.defaultProfile, refused.refused.map(({ id }) => id)]).toEqual(["b", ["b"]])
  })

  it("a root key the format does not know is a warning, and the file loads", () => {
    const { engines, warnings } = loadEngineProfiles({
      ENGINES_JSON: JSON.stringify({ engines: [], profiles: { a: { url: A } } }),
    })
    expect(engines.map(({ id }) => id)).toEqual(["a"])
    expect(warnings).toEqual([
      "ENGINES_JSON: engines is no key of a profile file, which holds $schema, defaultProfile and profiles.",
    ])
  })

  it("a file with a byte order mark loads, its cockpitUrl as written", () => {
    const file = path.join(dir, "bom.json")
    const profiles = { a: { url: A, cockpitUrl: "https://ops.example.com/webapp/" } }
    fs.writeFileSync(file, `\uFEFF${JSON.stringify({ profiles })}`)
    expect(loadEngineProfiles({ ENGINES_FILE: file }).engines[0].cockpitUrl).toBe(
      "https://ops.example.com/webapp/",
    )
  })

  it("ENGINES_FILE beats ENGINES_JSON and is named with its path", () => {
    const file = path.join(dir, "engines.json")
    fs.writeFileSync(
      file,
      JSON.stringify({ profiles: { "from-file": { url: A }, x: { url: "nope" } } }),
    )
    const loaded = loadEngineProfiles({ ENGINES_FILE: file, ...filed({ "from-json": { url: B } }) })
    expect(loaded.engineIds).toEqual(["from-file", "x"])
    expect(loaded.warnings[0]).toMatch(
      new RegExp(`^Profile "x" \\(ENGINES_FILE=${file}\\) is refused`),
    )
  })
})

describe("the variables the profiles name, for the typo warner", () => {
  it("lists the ENGINE_SECRET_ names of every profile the parser takes, refused ones too", () => {
    expect(
      referencedVariables(
        filed({
          a: { url: A, auth: { type: "basic", username: "u", passwordEnv: "ENGINE_SECRET_A" } },
          b: { headers: {}, auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_B" } },
          c: { url: A, auth: { type: "bearer", tokenEnv: "OTHER" } },
        }),
      ),
    ).toEqual(["ENGINE_SECRET_A", "ENGINE_SECRET_B"])
  })

  it("names none without a file, and never throws on a broken one", () => {
    expect(referencedVariables({ ENGINE_BASE_URL: A })).toEqual([])
    expect(referencedVariables({ ENGINES_JSON: "{" })).toEqual([])
    expect(referencedVariables({ ENGINES_FILE: "{}" })).toEqual([])
    expect(referencedVariables({ ENGINES_FILE: "/no/such/file.json" })).toEqual([])
  })
})
