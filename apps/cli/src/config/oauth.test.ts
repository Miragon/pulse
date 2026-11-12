import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { PulseCliError } from "../errors.js"
import {
  parseRedirectPort,
  parseScopes,
  validateAudience,
  validateClientId,
  validateClientSecret,
  validateOAuthUrl,
  validateScopes,
} from "./oauth.js"

function failure(action: () => unknown): PulseCliError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(PulseCliError)
    expect((error as PulseCliError).code).toBe("CONFIG")
    return error as PulseCliError
  }
  throw new Error("expected an error")
}

const LABEL = "from PULSE_CLI_OAUTH_ISSUER"

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
      'The OAuth issuer (from PULSE_CLI_OAUTH_ISSUER) must not contain a query, got "https://as/?…"',
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
      'Invalid OAuth issuer "/realms/x" (from PULSE_CLI_OAUTH_ISSUER)',
    )
    const scheme = failure(() => validateOAuthUrl("user:pw@as", "issuer", LABEL))
    expect(scheme.message).toContain('got "***@as"')
    expect(scheme.message).not.toContain("pw")
  })
})

describe("client values", () => {
  it("trims a printable ASCII client id", () => {
    expect(validateClientId(" pulse-cli ", LABEL)).toBe("pulse-cli")
    for (const id of ["", "  ", "ä", "a\tb"]) {
      expect(failure(() => validateClientId(id, "from --oauth-client-id")).message).toBe(
        "The OAuth client id (from --oauth-client-id) must be printable ASCII and not empty",
      )
    }
  })

  it("keeps a client secret exactly, refusing control characters without repeating it", () => {
    expect(validateClientSecret(" s p ä ", LABEL)).toBe(" s p ä ")
    const error = failure(() =>
      validateClientSecret("top\nsecret", "from PULSE_CLI_OAUTH_CLIENT_SECRET"),
    )
    expect(error.message).toBe(
      "The OAuth client secret (from PULSE_CLI_OAUTH_CLIENT_SECRET) must not contain control characters (line breaks, NUL, tab, ...)",
    )
    expect(JSON.stringify(error.details)).not.toContain("top")
  })

  it("trims a printable ASCII audience", () => {
    expect(validateAudience(" engine-rest ", LABEL)).toBe("engine-rest")
    expect(failure(() => validateAudience(" ", "from PULSE_CLI_OAUTH_AUDIENCE")).message).toBe(
      "The OAuth audience (from PULSE_CLI_OAUTH_AUDIENCE) must be printable ASCII and not empty",
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
      failure(() => parseRedirectPort(value, "from PULSE_CLI_OAUTH_REDIRECT_PORT")).message,
    ).toBe(
      `The OAuth redirect port (from PULSE_CLI_OAUTH_REDIRECT_PORT) must be a whole number between 0 and 65535, got "${value}"`,
    )
  })
})
