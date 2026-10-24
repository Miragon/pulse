import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { OperateError } from "../errors.js"
import { profileAuthProblem } from "./auth.js"
import {
  hasOAuthKeys,
  isLoopbackHost,
  parseRedirectPort,
  parseScopes,
  validateAudience,
  validateClientId,
  validateClientSecret,
  validateOAuthUrl,
  validateScopes,
} from "./oauth.js"

function failure(action: () => unknown): OperateError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError)
    expect((error as OperateError).code).toBe("CONFIG")
    return error as OperateError
  }
  throw new Error("expected an error")
}

const LABEL = "from OPERATE_OAUTH_ISSUER"

describe("validateOAuthUrl", () => {
  it.each([
    "https://login.example.com/realms/camunda",
    "https://login.example.com/",
    "http://localhost:8180/realms/x",
    "http://127.0.0.1:8080/realms/x",
    "http://127.1.2.3/x",
    "http://[::1]:9000/x",
  ])("accepts %s exactly as given", (url) => {
    expect(validateOAuthUrl(` ${url} `, "issuer", LABEL)).toBe(url)
  })

  it("keeps the query of an endpoint, but not of an issuer", () => {
    expect(validateOAuthUrl("https://as/authorize?tenant=x", "authorization endpoint", LABEL)).toBe(
      "https://as/authorize?tenant=x",
    )
    expect(failure(() => validateOAuthUrl("https://as/?x=1", "issuer", LABEL)).message).toBe(
      'The OAuth issuer (from OPERATE_OAUTH_ISSUER) must not contain a query, got "https://as/?…"',
    )
  })

  it.each([
    [
      "http://login.example.com/x",
      'must use https:// (http:// only for localhost, 127.0.0.1 or [::1]), got "http://login.example.com/x"',
    ],
    [
      "http://localhost.example.com/x",
      'must use https:// (http:// only for localhost, 127.0.0.1 or [::1]), got "http://localhost.example.com/x"',
    ],
    [
      "ftp://as/x",
      'must use https:// (http:// only for localhost, 127.0.0.1 or [::1]), got "ftp://as/x"',
    ],
    ["https://as/x#frag", 'must not contain a fragment, got "https://as/x?…"'],
    ["https://as/x#", 'must not contain a fragment, got "https://as/x?…"'],
    ["https://user:pw@as/x", 'must not contain credentials, got "https://***@as/x"'],
  ])("refuses %s", (url, problem) => {
    const error = failure(() =>
      validateOAuthUrl(url, "token endpoint", 'auth.tokenEndpoint of profile "p"'),
    )
    expect(error.message).toBe(
      `The OAuth token endpoint (auth.tokenEndpoint of profile "p") ${problem}`,
    )
    expect(error.details.hint).toBe(
      "Example issuer: https://login.example.com/realms/camunda. Local test identity providers may use http://localhost.",
    )
  })

  it("refuses a relative URL, never repeating credentials", () => {
    expect(failure(() => validateOAuthUrl("/realms/x", "issuer", LABEL)).message).toBe(
      'Invalid OAuth issuer "/realms/x" (from OPERATE_OAUTH_ISSUER)',
    )
    const scheme = failure(() => validateOAuthUrl("user:pw@as", "issuer", LABEL))
    expect(scheme.message).toContain('got "***@as"')
    expect(scheme.message).not.toContain("pw")
  })

  it("knows the loopback hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "127.255.0.9", "[::1]"])
      expect(isLoopbackHost(host)).toBe(true)
    for (const host of ["localhost.x", "128.0.0.1", "10.0.0.1", "::1", "127.0.0"])
      expect(isLoopbackHost(host)).toBe(false)
  })
})

describe("client values", () => {
  it("trims a printable ASCII client id", () => {
    expect(validateClientId(" operate-cli ", LABEL)).toBe("operate-cli")
    for (const id of ["", "  ", "ä", "a\tb"]) {
      expect(failure(() => validateClientId(id, "from --oauth-client-id")).message).toBe(
        "The OAuth client id (from --oauth-client-id) must be printable ASCII and not empty",
      )
    }
  })

  it("keeps a client secret exactly, refusing control characters without repeating it", () => {
    expect(validateClientSecret(" s p ä ", LABEL)).toBe(" s p ä ")
    const error = failure(() =>
      validateClientSecret("top\nsecret", "from OPERATE_OAUTH_CLIENT_SECRET"),
    )
    expect(error.message).toBe(
      "The OAuth client secret (from OPERATE_OAUTH_CLIENT_SECRET) must not contain control characters (line breaks, NUL, tab, ...)",
    )
    expect(JSON.stringify(error.details)).not.toContain("top")
  })

  it("trims a printable ASCII audience", () => {
    expect(validateAudience(" engine-rest ", LABEL)).toBe("engine-rest")
    expect(failure(() => validateAudience(" ", "from OPERATE_OAUTH_AUDIENCE")).message).toBe(
      "The OAuth audience (from OPERATE_OAUTH_AUDIENCE) must be printable ASCII and not empty",
    )
  })
})

describe("scopes", () => {
  it("splits on spaces and commas", () => {
    expect(parseScopes("openid offline_access")).toEqual(["openid", "offline_access"])
    expect(parseScopes(" openid,profile ,, email\tx ")).toEqual(["openid", "profile", "email", "x"])
    expect(parseScopes("")).toEqual([])
  })

  it("accepts RFC 6749 scope-tokens without duplicates", () => {
    expect(validateScopes(["openid", "api://x/.default", "a!b"], LABEL)).toEqual([
      "openid",
      "api://x/.default",
      "a!b",
    ])
    expect(failure(() => validateScopes(["ok", 'a"b'], "from --oauth-scopes")).message).toBe(
      'Invalid OAuth scope "a"b" (from --oauth-scopes)',
    )
    expect(failure(() => validateScopes(["a\\b"], LABEL)).message).toBe(
      `Invalid OAuth scope "a\\b" (${LABEL})`,
    )
    expect(failure(() => validateScopes(["ä"], LABEL)).code).toBe("CONFIG")
    expect(failure(() => validateScopes(["openid", "openid"], LABEL)).message).toBe(
      `The OAuth scope "openid" is listed twice (${LABEL})`,
    )
  })

  it("round-trips scope lists through the text form", () => {
    const token = fc.stringMatching(/^[\x21\x23-\x2b\x2d-\x5b\x5d-\x7e]{1,10}$/)
    fc.assert(
      fc.property(fc.uniqueArray(token, { maxLength: 5 }), (scopes) => {
        expect(validateScopes(parseScopes(scopes.join(" ")), LABEL)).toEqual(scopes)
        expect(parseScopes(scopes.join(","))).toEqual(scopes)
      }),
    )
  })
})

describe("parseRedirectPort", () => {
  it("accepts 0..65535 as number or digits", () => {
    expect(parseRedirectPort("0", LABEL)).toBe(0)
    expect(parseRedirectPort(" 8765 ", LABEL)).toBe(8765)
    expect(parseRedirectPort(65_535, LABEL)).toBe(65_535)
  })

  it.each(["65536", "-1", "1.5", "x", "", 70_000, 1.5])("refuses %j", (value) => {
    expect(
      failure(() => parseRedirectPort(value, "from OPERATE_OAUTH_REDIRECT_PORT")).message,
    ).toBe(
      `The OAuth redirect port (from OPERATE_OAUTH_REDIRECT_PORT) must be a whole number between 0 and 65535, got "${value}"`,
    )
  })
})

describe("profileAuthProblem with OAuth keys", () => {
  it("accepts the documented OAuth shapes", () => {
    for (const auth of [
      {
        type: "oauth",
        issuer: "https://as",
        clientId: "c",
        scopes: ["openid"],
        audience: "a",
        redirectPort: 0,
      },
      {
        type: "oauth",
        authorizationEndpoint: "https://as/a",
        tokenEndpoint: "https://as/t",
        clientId: "c",
        clientSecretEnv: "S",
      },
      { type: "oauth", clientSecret: "literal", scopes: [] },
      { type: "none", issuer: "https://as", clientId: "c" },
      { type: "oauth" },
    ]) {
      expect(profileAuthProblem("p", auth), JSON.stringify(auth)).toBeUndefined()
    }
  })

  it.each([
    [
      { type: "oauth", issuer: "" },
      'profile "p" has an invalid auth.issuer (expected a URL such as https://login.example.com/realms/x)',
    ],
    [
      { type: "oauth", scopes: "openid" },
      'profile "p" has an invalid auth.scopes (expected an array of distinct scopes such as ["openid", "offline_access"])',
    ],
    [
      { type: "oauth", scopes: ["openid", "openid"] },
      'profile "p" has an invalid auth.scopes (expected an array of distinct scopes such as ["openid", "offline_access"])',
    ],
    [
      { type: "oauth", scopes: ["a b"] },
      'profile "p" has an invalid auth.scopes (expected an array of distinct scopes such as ["openid", "offline_access"])',
    ],
    [
      { type: "oauth", redirectPort: 70000 },
      'profile "p" has an invalid auth.redirectPort (expected a whole number between 0 and 65535)',
    ],
    [
      { type: "oauth", redirectPort: "8080" },
      'profile "p" has an invalid auth.redirectPort (expected a whole number between 0 and 65535)',
    ],
    [
      { type: "oauth", clientSecretEnv: "my-secret" },
      'profile "p" has an invalid auth.clientSecretEnv (expected the name of an environment variable, e.g. OPERATE_CLIENT_SECRET)',
    ],
    [
      { type: "oauth", clientId: " " },
      'profile "p" has an invalid auth.clientId (expected a non-empty string)',
    ],
    [
      { type: "oauth", username: "u", issuer: "https://as", clientId: "c" },
      'profile "p" mixes Basic auth keys (username) and OAuth keys (issuer, clientId); keep one',
    ],
    [
      { type: "basic", issuer: "https://as" },
      'profile "p" has OAuth keys (issuer) but its auth.type is basic; set "type": "oauth"',
    ],
    [
      { clientId: "c" },
      'profile "p" has OAuth keys (clientId) but its auth.type is not set; set "type": "oauth"',
    ],
    [
      { type: "oauth", username: "u" },
      'profile "p" has Basic auth keys (username) but its auth.type is oauth; set "type": "basic"',
    ],
    [
      { type: "oauth", clientSecret: "x", clientSecretEnv: "S" },
      'profile "p" sets both auth.clientSecret and auth.clientSecretEnv; keep one (clientSecretEnv is recommended)',
    ],
    [
      { type: "oauth", tokenEndpoint: "https://as/t" },
      'profile "p" sets auth.tokenEndpoint without the other endpoint; set both auth.authorizationEndpoint and auth.tokenEndpoint, or neither (discovery from auth.issuer)',
    ],
  ])("reports %j", (auth, problem) => {
    expect(profileAuthProblem("p", auth)).toBe(problem)
  })

  it("leaves unknown types to resolution", () => {
    expect(profileAuthProblem("p", { type: "digest", clientId: "c" })).toBeUndefined()
  })

  it("never quotes values", () => {
    const problem = profileAuthProblem("p", { type: "basic", clientSecret: "very-secret" })
    expect(problem).not.toContain("very-secret")
  })

  it("knows when a stored auth object has OAuth settings", () => {
    expect(hasOAuthKeys({ type: "none", clientId: "c" })).toBe(true)
    expect(hasOAuthKeys({ type: "oauth" })).toBe(false)
    expect(hasOAuthKeys(undefined)).toBe(false)
  })
})
