import { describe, expect, it } from "vitest"
import * as http from "../src/index.js"
import { CredentialError, FAILURE_REASONS } from "../src/index.js"
import * as oauth from "../src/oauth/index.js"
import * as testing from "../src/testing/index.js"
import * as loopback from "../src/testing/loopback/index.js"
import {
  CASE_CAPABILITIES,
  caseFindings,
  casesFor,
  credentialOfCase,
  pathOfCase,
  requirementsOf,
  TRANSPORT_CASES,
  type TransportCase,
} from "../src/testing/index.js"

const KASE: TransportCase = {
  name: "x",
  about: "a case",
  connection: { endpoint: "loopback", root: "/r", credential: { type: "none" }, timeoutMs: 1 },
  request: { method: "GET", path: "/a/{id}/b/{other}", values: { id: "1 2" }, intent: "read" },
  answers: [],
  expect: {
    outcome: "status",
    status: 404,
    mayHaveApplied: false,
    sent: 1,
    authorization: [null],
    targets: ["/r/a"],
    bodies: [""],
    contains: ["shown"],
    never: ["secret"],
  },
}

describe("the conformance cases", () => {
  it("have unique names and say what they hold", () => {
    const names = TRANSPORT_CASES.map((kase) => kase.name)
    expect(new Set(names).size).toBe(names.length)
    for (const kase of TRANSPORT_CASES) expect(kase.about.length).toBeGreaterThan(10)
  })

  it("expect only reasons the transport has, and the write caveat only on a failure", () => {
    for (const { name, expect: wanted } of TRANSPORT_CASES) {
      expect([...FAILURE_REASONS, "answered"], name).toContain(wanted.outcome)
      if (wanted.outcome === "answered") expect(wanted.mayHaveApplied, name).toBeUndefined()
    }
  })

  it("cover every failure reason the transport has", () => {
    const outcomes = new Set(TRANSPORT_CASES.map((kase) => kase.expect.outcome))
    expect(FAILURE_REASONS.filter((reason) => !outcomes.has(reason))).toEqual([])
  })

  it("hold each path value the rule refuses at the end of a read and inside a write", () => {
    const refused = TRANSPORT_CASES.filter((kase) => kase.name.startsWith("path-value-"))
    expect(
      refused.map((kase) => [kase.request.method, Object.values(kase.request.values ?? {})]),
    ).toEqual([
      ["GET", ["."]],
      ["GET", [".."]],
      ["GET", [""]],
      ["PUT", [".", "amount"]],
      ["PUT", ["..", "amount"]],
      ["PUT", ["", "amount"]],
    ])
  })
})

describe("what a case needs of a wiring", () => {
  const named = (cases: readonly TransportCase[]) => cases.map((kase) => kase.name)

  it("reads the credential, a read-only connection and the caller's abort off the case", () => {
    const needs = (connection: Partial<TransportCase["connection"]>, cancelAfterMs?: number) =>
      requirementsOf({
        ...KASE,
        connection: { ...KASE.connection, ...connection },
        request: { ...KASE.request, ...(cancelAfterMs === undefined ? {} : { cancelAfterMs }) },
      })
    expect(needs({})).toEqual([])
    expect(needs({ credential: { type: "basic", username: "u", password: "p" } })).toEqual([
      "basic",
    ])
    expect(needs({ credential: { type: "bearer", token: "t" } })).toEqual(["bearer"])
    expect(needs({ credential: { type: "caller", token: "t" } })).toEqual(["passthrough"])
    expect(needs({ credential: { type: "renewable", tokens: [] } }, 5)).toEqual([
      "renewal",
      "cancel",
    ])
    expect(needs({ readOnly: true })).toEqual(["read-only"])
    expect(needs({ readOnly: false })).toEqual([])
  })

  it("runs every case with every capability", () => {
    expect(casesFor(CASE_CAPABILITIES)).toEqual(TRANSPORT_CASES)
    expect(new Set(CASE_CAPABILITIES).size).toBe(6)
  })

  // A surface's test pins what it leaves out like this, so a gap stays visible: here a wiring
  // that knows Basic alone (Pulse for VS Code's C7 adapter today).
  it("leaves out exactly the cases a wiring cannot express", () => {
    const run = casesFor(["basic"])
    const left = TRANSPORT_CASES.filter((kase) => !run.includes(kase))
    expect(named(left)).toEqual([
      "cancelled-by-the-caller",
      "cancel-of-a-write-ignored",
      "unauthorized-bearer",
      "unauthorized-passthrough",
      "unauthorized-renewed",
      "unauthorized-after-the-one-retry",
      "unauthorized-renewed-write",
      "engine-text-echoes-secret-bearer",
      "token-line-break-inside",
      "token-line-break-trailing",
      "read-only-refuses-a-write",
      "read-only-sends-a-reading-post",
    ])
    expect(named(run)).toContain("unauthorized-basic")
    expect(named(casesFor([]))).not.toContain("unauthorized-basic")
  })
})

describe("caseFindings", () => {
  const seen = [{ method: "GET", target: "/r/a", body: "" }]
  const observed = { outcome: "status", status: 404, mayHaveApplied: false, text: "shown" } as const

  it("is empty when the observation and the engine match the case", () => {
    expect(caseFindings(KASE, observed, seen)).toEqual([])
  })

  it("names each difference in a sentence", () => {
    const off = {
      outcome: "redirect",
      status: 302,
      mayHaveApplied: true,
      text: "a secret",
    } as const
    const engine = [
      { method: "GET", target: "/r/b", authorization: "Basic x", body: "{}" },
      { method: "GET", target: "/r/b", body: "" },
    ]
    expect(caseFindings(KASE, off, engine)).toEqual([
      "outcome: expected status, observed redirect",
      "status: expected 404, observed 302",
      "mayHaveApplied: expected false, observed true",
      "sent: expected 1 requests, the engine saw 2",
      'authorization: expected [null], the engine saw ["Basic x",null]',
      'targets: expected ["/r/a"], the engine saw ["/r/b","/r/b"]',
      'bodies: expected [""], the engine saw ["{}",""]',
      'the observation does not show "shown"',
      'the observation shows "secret", which it never may',
    ])
  })

  it("checks only what a case expects", () => {
    const bare: TransportCase = { ...KASE, expect: { outcome: "answered", sent: 0 } }
    expect(caseFindings(bare, { outcome: "answered", text: "" }, [])).toEqual([])
  })
})

describe("credentialOfCase and pathOfCase", () => {
  it("fills each path value through the caller's encoding, an absent one as empty", () => {
    expect(pathOfCase(KASE.request, encodeURIComponent)).toBe("/a/1%202/b/")
    const bare = { method: "GET", path: "/a/{id}/b", intent: "read" } as const
    expect(pathOfCase(bare, encodeURIComponent)).toBe("/a//b")
  })

  it("checks a fixed token as a surface's boot does, before any request", () => {
    expect(() => credentialOfCase({ type: "bearer", token: "tok\n1" })).toThrow(CredentialError)
    expect(credentialOfCase({ type: "caller", token: "tok\n1" }).scheme).toBe("bearer")
  })

  it("builds each credential", async () => {
    expect(credentialOfCase({ type: "none" }).scheme).toBe("none")
    const basic = await credentialOfCase({
      type: "basic",
      username: "u",
      password: "p",
    }).authorization()
    expect(basic?.header).toBe("Basic dTpw")
    const bearer = await credentialOfCase({ type: "bearer", token: "tok-1" }).authorization()
    expect(bearer?.header).toBe("Bearer tok-1")
    const caller = credentialOfCase({ type: "caller", token: "tok-2" })
    expect([caller.renewable, (await caller.authorization())?.header]).toEqual([
      false,
      "Bearer tok-2",
    ])
  })

  it("renews a renewable one while it has a next token, only for the token it sent", async () => {
    const credential = credentialOfCase({ type: "renewable", tokens: ["t-1", "t-2"] })
    expect(credential.renewable).toBe(true)
    const first = await credential.authorization()
    expect(await credential.rejected({ header: "Bearer other", secrets: [] })).toBe(false)
    expect(first && (await credential.rejected(first))).toBe(true)
    const second = await credential.authorization()
    expect(second?.header).toBe("Bearer t-2")
    expect(second && (await credential.rejected(second))).toBe(false)
  })
})

/**
 * The published entries' lists: knip never reports what an entry exports, so a name added or
 * dropped is held here and decided in review. Types are erased at runtime: these are the runtime
 * names.
 */
describe("the entries", () => {
  it("export exactly the public API", () => {
    expect(Object.keys(http).sort()).toEqual([
      "CredentialError",
      "FAILURE_REASONS",
      "HttpFailure",
      "INTEGER_MODES",
      "MASK",
      "MAX_ANSWER_BYTES",
      "PathValueError",
      "STATUS_TEXT",
      "basicCredential",
      "bearerCredential",
      "bearerToken",
      "callerToken",
      "clipText",
      "createHttp",
      "decodeText",
      "encodePathValue",
      "joinUrl",
      "maskJsonText",
      "maskSecrets",
      "mediaTypeOf",
      "noCredential",
      "parseJson",
      "pathValueProblem",
      "problemOf",
      "requestUrlProblem",
      "rootOf",
      "secretForms",
      "staticToken",
      "statusTextOf",
      "stringifyJson",
    ])
    expect(Object.keys(testing).sort()).toEqual([
      "CASE_CAPABILITIES",
      "TRANSPORT_CASES",
      "caseFindings",
      "casesFor",
      "credentialOfCase",
      "pathOfCase",
      "recordingFetch",
      "requirementsOf",
    ])
  })

  it("export exactly the OAuth client protocol from ./oauth", () => {
    expect(Object.keys(oauth).sort()).toEqual([
      "EXPIRY",
      "TokenFailure",
      "authorizationUrl",
      "callbackResult",
      "canRefresh",
      "clientCredentialsTokens",
      "commandTokens",
      "createPkce",
      "decodeBase64Url",
      "discover",
      "isAccessToken",
      "isDue",
      "jwtClaims",
      "memoryTokenStore",
      "oauthUrlProblem",
      "refreshAt",
      "refreshingTokens",
      "renewsAfterRefusal",
      "requestToken",
      "revokeToken",
      "serverMetadata",
      "tokenKey",
    ])
  })

  it("export exactly the recording engine of a case from ./testing/loopback", () => {
    expect(Object.keys(loopback)).toEqual(["startCaseEngine"])
  })
})
