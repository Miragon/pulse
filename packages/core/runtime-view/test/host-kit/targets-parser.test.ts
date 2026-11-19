import { AUTH_TYPES, FLAVORS, PROBLEM_CODES } from "@miragon/pulse-profile"
import { describe, expect, test } from "vitest"
import { ProfileSource } from "../../src/host-kit/connections/profile-source.js"
import { TargetPolicy } from "../../src/host-kit/connections/target-policy.js"
import { TargetsParser } from "../../src/host-kit/connections/targets-parser.js"

const FILE = "/work/.pulse.json"
const URL = "http://localhost:8080/engine-rest"
const SET_TYPE = "Set auth.type to none or basic"
const AUTH_KEYS_WAY_OUT =
  "This client connects with auth.type none, basic, or clientCredentials on camunda8: use one of them."
const HEADERS =
  "This client does not apply headers, so it refuses the profile rather than ignore it."
const REMOVE_HEADERS = "Remove headers from this profile, or use one without them."
const NOT_SERVED = "This client cannot authenticate with this auth.type."
const MISMATCH =
  'auth.type does not fit the other auth keys: OAuth keys need "oauth", or "clientCredentials" without issuer, authorizationEndpoint and redirectPort; a stored token "bearer"; Basic auth keys "basic" or no type; "passthrough" takes none; and "none" switches them off.'
const MIXED =
  "auth mixes the keys of two kinds of credentials (Basic auth, OAuth, a bearer token): keep one."
const UNKNOWN_TYPE =
  "auth.type must be one of none, basic, bearer, oauth, clientCredentials, passthrough (the value is not shown)."
const C8 = { url: "https://c8.example.com/v2", flavor: "camunda8" }
const GRANT = { type: "clientCredentials", tokenEndpoint: "https://login.example.com/token" }
const NOT_IN_DIALECT =
  "auth.type does not fit the API of the flavor (camunda7, cibseven, operaton: none, basic, bearer, oauth, passthrough; camunda8: none, basic, bearer, clientCredentials)."
const READER_CODES = PROBLEM_CODES.slice(PROBLEM_CODES.indexOf("auth-type-not-served"))
const REFUSED_BY_THIS_CLIENT: Record<string, readonly [Record<string, unknown>, string]> = {
  "auth-type-not-served": [
    { url: URL, auth: { type: "bearer" } },
    `${NOT_SERVED} ${SET_TYPE}, or keep this profile for the CLI.`,
  ],
  "url-missing": [
    {},
    "url is missing: this client needs the REST API root, a URL such as http://localhost:8080/engine-rest.",
  ],
  "process-engine-not-served": [
    { url: URL, engine: "orders" },
    'engine names a process engine this client does not reach: it reaches only "default".',
  ],
  "key-not-served": [
    { url: URL, headers: { "X-Tenant-Id": "acme" } },
    `${HEADERS} ${REMOVE_HEADERS}`,
  ],
}

const OAUTH_KEYS = {
  issuer: "https://idp.example.com/realms/pulse",
  clientId: "pulse-cli",
  scopes: ["openid"],
  audience: "engine",
}

function refusalOnConnecting(
  auth: Record<string, unknown>,
  profile: Record<string, unknown> = { url: URL },
) {
  const [target] = new TargetsParser(FILE).parse(
    JSON.stringify({ profiles: { p: { ...profile, auth } } }),
  ).targets
  return target === undefined ? "no target" : TargetPolicy.refusal(target, { kind: "none" })
}

function problemsOf(profiles: Record<string, unknown>, root: Record<string, unknown> = {}) {
  const parsed = new TargetsParser(FILE).parse(JSON.stringify({ ...root, profiles }))
  return {
    targets: parsed.targets.map((target) => target.name),
    problems: parsed.problems.map((problem) => [problem.message, problem.severity]),
  }
}

describe("a project file the extension reads", () => {
  test("names no credential: a secret or the variable that holds it is a problem, never a target", () => {
    const shared =
      "is set, but a file others share names no credential, neither a secret nor the variable that holds one."
    expect(
      problemsOf({
        variable: { url: URL, auth: { type: "basic", username: "demo", passwordEnv: "PW" } },
        secret: { url: URL, auth: { type: "basic", username: "demo", password: "S3cret" } },
        sso: { url: URL, auth: { type: "oauth", clientId: "c", clientSecretEnv: "CS" } },
        ok: { url: URL, auth: { type: "basic", username: "demo" } },
      }),
    ).toEqual({
      targets: ["ok"],
      problems: [
        [`profile "variable": auth.passwordEnv ${shared}`, undefined],
        [`profile "secret": auth.password ${shared}`, undefined],
        [`profile "sso": auth.clientSecretEnv ${shared}`, undefined],
      ],
    })
  })

  test("refuses headers and the MCP server's passthrough instead of ignoring them, and says what to do", () => {
    expect(
      problemsOf({
        tenant: { url: URL, headers: { "X-Tenant-Id": "acme" } },
        gateway: { url: URL, auth: { type: "passthrough" } },
      }),
    ).toEqual({
      targets: [],
      problems: [
        [`profile "tenant": ${HEADERS} ${REMOVE_HEADERS}`, undefined],
        [
          `profile "gateway": ${NOT_SERVED} ${SET_TYPE}, or keep this profile for the MCP server.`,
          undefined,
        ],
      ],
    })
  })

  test("names the auth types it connects with after an auth type it refuses or the format does not take", () => {
    expect(
      problemsOf({
        token: { url: URL, auth: { type: "bearer" } },
        kerberos: { url: URL, auth: { type: "kerberos" } },
        numbered: { url: URL, auth: { type: 7 } },
        mismatched: { url: URL, auth: { type: "basic", clientId: "pulse" } },
        mixed: { url: URL, auth: { username: "demo", clientId: "pulse" } },
      }),
    ).toEqual({
      targets: [],
      problems: [
        [
          `profile "token": ${NOT_SERVED} ${SET_TYPE}, or keep this profile for the CLI.`,
          undefined,
        ],
        [`profile "kerberos": ${UNKNOWN_TYPE} ${AUTH_KEYS_WAY_OUT}`, undefined],
        [
          `profile "numbered": auth.type must be a string, one of none, basic, bearer, oauth, clientCredentials, passthrough. ${AUTH_KEYS_WAY_OUT}`,
          undefined,
        ],
        [`profile "mismatched": ${MISMATCH} ${AUTH_KEYS_WAY_OUT}`, undefined],
        [`profile "mixed": ${MIXED} ${AUTH_KEYS_WAY_OUT}`, undefined],
      ],
    })
  })

  test("names only the auth types a target of it then connects with, on reading and on connecting", () => {
    const connecting = AUTH_TYPES.filter((type) => refusalOnConnecting({ type }) === undefined)
    const onCamunda8 = AUTH_TYPES.filter(
      (type) =>
        refusalOnConnecting(type === "clientCredentials" ? GRANT : { type }, C8) === undefined,
    )
    expect(connecting).toEqual(["none", "basic"])
    expect(onCamunda8).toEqual(["none", "basic", "clientCredentials"])
    expect(problemsOf({ p: { url: URL, auth: { type: "bearer" } } }).problems[0]?.[0]).toContain(
      `Set auth.type to ${connecting.join(" or ")},`,
    )
    expect(problemsOf({ p: { ...C8, auth: { type: "bearer" } } }).problems[0]?.[0]).toContain(
      "Set auth.type to none, basic, or clientCredentials.",
    )
    expect(problemsOf({ p: { url: URL, auth: { type: "kerberos" } } }).problems[0]?.[0]).toContain(
      "connects with auth.type none, basic, or clientCredentials on camunda8:",
    )
    expect(problemsOf({ p: { url: URL, auth: { type: "oauth" } } })).toEqual({
      targets: ["p"],
      problems: [],
    })
    const onConnect = refusalOnConnecting({ type: "oauth" }) ?? ""
    expect([...onConnect.matchAll(/\bto (\w+)/g)].map(([, type]) => type)).toEqual(connecting)
  })

  test("refuses an oauth profile on connecting with ways out that each connect, OAuth keys and all", () => {
    expect(refusalOnConnecting({ type: "oauth", ...OAUTH_KEYS })).toBe(
      'Profile "p" uses auth.type oauth, which this client cannot authenticate with. Set auth.type to none, or to basic without the OAuth keys, or keep this profile for the CLI.',
    )
    expect(refusalOnConnecting({ type: "none", ...OAUTH_KEYS })).toBeUndefined()
    expect(refusalOnConnecting({ type: "basic" })).toBeUndefined()
    expect(refusalOnConnecting({ type: "basic", ...OAUTH_KEYS })).toBe("no target")
  })

  test("reads a profile's timeout as its target's deadline, of either dialect", () => {
    const parsed = new TargetsParser(FILE).parse(
      JSON.stringify({
        profiles: {
          shop: { url: "http://localhost:8080/engine-rest", timeout: 5000 },
          cluster: { url: "http://localhost:8088/v2", flavor: "camunda8", timeout: 250 },
          plain: { url: "http://localhost:8081/engine-rest" },
        },
      }),
    )

    expect(parsed.problems).toEqual([])
    expect(parsed.targets.map((target) => [target.name, target.timeoutMs])).toEqual([
      ["shop", 5000],
      ["cluster", 250],
      ["plain", undefined],
    ])
    expect(parsed.targets[2]).not.toHaveProperty("timeoutMs")
  })

  test("reads a Camunda 8 profile as a target of its dialect, with its client credentials", () => {
    const parsed = new TargetsParser(FILE).parse(
      JSON.stringify({
        profiles: {
          open: { url: "http://localhost:8088/v2", flavor: "camunda8" },
          cluster: {
            ...C8,
            cockpitUrl: "https://c8.example.com/operate",
            auth: { ...GRANT, clientId: "pulse", audience: "camunda", scopes: ["read"] },
          },
          padded: {
            ...C8,
            auth: { ...GRANT, tokenEndpoint: "  https://login.example.com/t?p=1  " },
          },
        },
      }),
    )

    expect(parsed.problems).toEqual([])
    expect(parsed.targets).toEqual([
      {
        name: "open",
        engine: "c8",
        endpoint: "http://localhost:8088/v2",
        auth: { kind: "none" },
        source: { kind: "file", path: FILE },
      },
      {
        name: "cluster",
        engine: "c8",
        endpoint: "https://c8.example.com/v2",
        auth: {
          kind: "clientCredentials",
          tokenEndpoint: "https://login.example.com/token",
          clientId: "pulse",
          audience: "camunda",
          scopes: ["read"],
        },
        source: { kind: "file", path: FILE },
        webUiUrl: "https://c8.example.com/operate",
      },
      {
        name: "padded",
        engine: "c8",
        endpoint: "https://c8.example.com/v2",
        auth: { kind: "clientCredentials", tokenEndpoint: "https://login.example.com/t?p=1" },
        source: { kind: "file", path: FILE },
      },
    ])
  })

  test.each([
    [
      "no URL",
      "login.example.com/token",
      "is no URL: use a URL such as https://login.example.com/oauth/token.",
    ],
    ["another scheme", "ftp://login.example.com/token", "must start with http:// or https://."],
    [
      "credentials",
      "https://pulse:s3cret@login.example.com/token",
      "must not contain credentials (they are not shown): Pulse sends the client ID and secret itself.",
    ],
    [
      "a user name",
      "https://pulse@login.example.com/token",
      "must not contain credentials (they are not shown): Pulse sends the client ID and secret itself.",
    ],
    ["a fragment", "https://login.example.com/token#top", "must not contain a fragment."],
    ["an empty fragment", "https://login.example.com/token?p=1#", "must not contain a fragment."],
  ])("refuses a token endpoint with %s, where it would send the client secret", (_, url, rule) => {
    const parsed = new TargetsParser(FILE).parse(
      JSON.stringify({ profiles: { cluster: { ...C8, auth: { ...GRANT, tokenEndpoint: url } } } }),
    )

    expect(parsed.targets).toEqual([])
    expect(parsed.problems.map((problem) => problem.message)).toEqual([
      `profile "cluster": auth.tokenEndpoint ${rule}`,
    ])
    expect(JSON.stringify(parsed.problems)).not.toContain("s3cret")
  })

  test("takes the token endpoint on plain http of a cluster on this machine, as c8:up prints it", () => {
    const parsed = new TargetsParser(FILE).parse(
      JSON.stringify({
        profiles: {
          "c8-local": {
            url: "http://localhost:18088/v2",
            cockpitUrl: "http://localhost:18088/operate",
            flavor: "camunda8",
            auth: {
              type: "clientCredentials",
              tokenEndpoint: "http://localhost:18089/realms/pulse/protocol/openid-connect/token",
              clientId: "pulse-reader",
              audience: "camunda",
            },
          },
        },
      }),
    )

    expect(parsed.problems).toEqual([])
    const [target] = parsed.targets
    expect(target?.auth).toEqual({
      kind: "clientCredentials",
      tokenEndpoint: "http://localhost:18089/realms/pulse/protocol/openid-connect/token",
      clientId: "pulse-reader",
      audience: "camunda",
    })
    expect(
      target === undefined ? "no target" : TargetPolicy.refusal(target, { kind: "none" }),
    ).toBeUndefined()
  })

  test("names the auth types of each dialect after an auth type the flavor does not take", () => {
    expect(
      problemsOf({
        "c7-grant": { url: URL, auth: GRANT },
        "c8-oauth": { ...C8, auth: { type: "oauth" } },
        "c8-token": { ...C8, auth: { type: "bearer" } },
      }).problems,
    ).toEqual([
      [`profile "c7-grant": ${NOT_IN_DIALECT} ${AUTH_KEYS_WAY_OUT}`, undefined],
      [`profile "c8-oauth": ${NOT_IN_DIALECT} ${AUTH_KEYS_WAY_OUT}`, undefined],
      [
        `profile "c8-token": ${NOT_SERVED} Set auth.type to none, basic, or clientCredentials.`,
        undefined,
      ],
    ])
  })

  test("says the ways out after every sentence of the format, each once", () => {
    expect(
      problemsOf({
        both: { url: URL, auth: { type: "bearer" }, headers: { "X-Tenant-Id": "acme" } },
        twice: { url: URL, auth: { type: "kerberos", username: "demo", clientId: "pulse" } },
      }).problems,
    ).toEqual([
      [
        `profile "both": ${NOT_SERVED} ${HEADERS} ${SET_TYPE}, or keep this profile for the CLI. ${REMOVE_HEADERS}`,
        undefined,
      ],
      [`profile "twice": ${UNKNOWN_TYPE} ${MIXED} ${AUTH_KEYS_WAY_OUT}`, undefined],
    ])
  })

  test("serves every dialect of the format, so it refuses no profile for its flavor", () => {
    expect(new Set(Object.values(FLAVORS))).toEqual(new Set(["c7", "c8"]))
    expect(
      problemsOf(
        Object.fromEntries(Object.keys(FLAVORS).map((flavor) => [flavor, { ...C8, flavor }])),
      ),
    ).toEqual({ targets: Object.keys(FLAVORS), problems: [] })
  })

  test("follows each code it refuses a profile with by a way out, or by a sentence that names one", () => {
    expect(Object.keys(REFUSED_BY_THIS_CLIENT).sort()).toEqual([...READER_CODES].sort())
    for (const [profile, message] of Object.values(REFUSED_BY_THIS_CLIENT)) {
      expect(problemsOf({ p: profile }).problems).toEqual([[`profile "p": ${message}`, undefined]])
    }
  })

  test("shows what is off at the root as a warning, and names a profile of an invalid name by its position", () => {
    expect(
      problemsOf(
        { local: { url: URL }, "pa55 word": { url: URL } },
        { defaultProfile: "prod", default: "local" },
      ),
    ).toEqual({
      targets: ["local"],
      problems: [
        [
          "default is no key of a profile file, which holds $schema, defaultProfile and profiles.",
          "warning",
        ],
        ["defaultProfile names no profile of this file.", "warning"],
        [
          'profile 2: The profile\'s name is not valid (it is not shown): use letters, digits, ".", "_" and "-", starting with a letter or digit.',
          undefined,
        ],
      ],
    })
  })
})

describe("the CLI's user config the editors read", () => {
  const OWN = "/home/dev/.config/pulse-cli/config.json"

  function ownProblems(profiles: Record<string, unknown>) {
    const parsed = new TargetsParser(OWN, ProfileSource.USER_CONFIG).parse(
      JSON.stringify({ profiles }),
    )
    return {
      targets: parsed.targets.map((target) => [target.name, target.auth.kind]),
      problems: parsed.problems.map((problem) => problem.label()),
    }
  }

  test("takes the credentials it holds for the CLI, and connects without them", () => {
    expect(
      ownProblems({
        literal: { url: URL, auth: { type: "basic", username: "demo", password: "S3cret" } },
        variable: { url: URL, auth: { username: "demo", passwordEnv: "DEMO_PASSWORD" } },
      }),
    ).toEqual({
      targets: [
        ["literal", "basic"],
        ["variable", "basic"],
      ],
      problems: [],
    })
  })

  test("asks to remove the headers of a Camunda 8 profile, which the CLI does not read", () => {
    expect(ownProblems({ tenant: { ...C8, headers: { "X-Tenant-Id": "acme" } } }).problems).toEqual(
      [`CLI config: profile "tenant": ${HEADERS} ${REMOVE_HEADERS}`],
    )
  })

  test("takes a client secret it holds for no one, and keeps the client ID of the profile", () => {
    expect(
      ownProblems({
        cluster: { ...C8, auth: { ...GRANT, clientId: "pulse", clientSecret: "S3cret" } },
      }),
    ).toEqual({ targets: [["cluster", "clientCredentials"]], problems: [] })
  })

  test("leaves a profile the CLI needs as it is: never asks to remove its headers or its type", () => {
    expect(
      ownProblems({
        tenant: { url: URL, headers: { "X-Tenant-Id": "acme" } },
        gateway: { url: URL, auth: { type: "passthrough" } },
        token: { url: URL, auth: { type: "bearer", tokenEnv: "CI_TOKEN" } },
      }),
    ).toEqual({
      targets: [],
      problems: [
        `CLI config: profile "tenant": ${HEADERS} Keep this profile for the CLI, and add a profile without headers for this client.`,
        `CLI config: profile "gateway": ${NOT_SERVED} ${SET_TYPE}.`,
        `CLI config: profile "token": ${NOT_SERVED} ${SET_TYPE}, or keep this profile for the CLI.`,
      ],
    })
  })
})
