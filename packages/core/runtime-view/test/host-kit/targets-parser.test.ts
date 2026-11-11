import { AUTH_TYPES, FLAVORS, PROBLEM_CODES } from "@miragon/pulse-profile"
import { describe, expect, test } from "vitest"
import { TargetPolicy } from "../../src/host-kit/connections/target-policy.js"
import { TargetsParser } from "../../src/host-kit/connections/targets-parser.js"

const FILE = "/work/.pulse.json"
const URL = "http://localhost:8080/engine-rest"
const SET_TYPE = "Set auth.type to none or basic"
const AUTH_KEYS_WAY_OUT = "This client connects with auth.type none or basic: use one of them."
const HEADERS =
  "This client does not apply headers, so it refuses the profile rather than ignore it."
const REMOVE_HEADERS = "Remove headers from this profile, or use one without them."
const NOT_SERVED = "This client cannot authenticate with this auth.type."
const MISMATCH =
  'auth.type does not fit the other auth keys: OAuth keys need "oauth", a stored token "bearer", Basic auth keys "basic" or no type, "passthrough" takes none, and "none" switches them off.'
const MIXED =
  "auth mixes the keys of two kinds of credentials (Basic auth, OAuth, a bearer token): keep one."
const UNKNOWN_TYPE =
  "auth.type must be one of none, basic, bearer, oauth, passthrough (the value is not shown)."
const READER_CODES = PROBLEM_CODES.slice(PROBLEM_CODES.indexOf("dialect-not-served"))
const REFUSED_BY_THIS_CLIENT: Record<string, readonly [Record<string, unknown>, string] | null> = {
  "dialect-not-served": null,
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

function refusalOnConnecting(auth: Record<string, unknown>) {
  const [target] = new TargetsParser(FILE).parse(
    JSON.stringify({ profiles: { p: { url: URL, auth } } }),
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
          `profile "numbered": auth.type must be a string, one of none, basic, bearer, oauth, passthrough. ${AUTH_KEYS_WAY_OUT}`,
          undefined,
        ],
        [`profile "mismatched": ${MISMATCH} ${AUTH_KEYS_WAY_OUT}`, undefined],
        [`profile "mixed": ${MIXED} ${AUTH_KEYS_WAY_OUT}`, undefined],
      ],
    })
  })

  test("names only the auth types a target of it then connects with, on reading and on connecting", () => {
    const connecting = AUTH_TYPES.filter((type) => refusalOnConnecting({ type }) === undefined)
    expect(connecting).toEqual(["none", "basic"])
    const named = connecting.join(" or ")
    expect(problemsOf({ p: { url: URL, auth: { type: "bearer" } } }).problems[0]?.[0]).toContain(
      `Set auth.type to ${named},`,
    )
    expect(problemsOf({ p: { url: URL, auth: { type: "kerberos" } } }).problems[0]?.[0]).toContain(
      `connects with auth.type ${named}:`,
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

  test("follows each code it refuses a profile with by a way out, or by a sentence that names one", () => {
    expect(Object.keys(REFUSED_BY_THIS_CLIENT).sort()).toEqual([...READER_CODES].sort())
    expect(new Set(Object.values(FLAVORS))).toEqual(new Set(["c7"]))
    for (const refused of Object.values(REFUSED_BY_THIS_CLIENT)) {
      if (refused === null) continue
      const [profile, message] = refused
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
