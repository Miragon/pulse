import { describe, expect, it } from "vitest"
import { readOidcSettings } from "./oauth-oidc.js"

/**
 * The generic OpenID Connect provider's audiences: an https URL on its own, any other only beside
 * a scope of Pulse's own, which no other app's token and no ID token carries.
 */

const ISSUER = "https://idp.example.test/oauth2/default"

/** The refusal of `run`, its message. */
function refusal(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected a refusal")
}

/** The boot's refusal of an audience that is no https URL without a scope of Pulse's own. */
const bareRefusal = (audience: string): string =>
  `MCP_OAUTH_OIDC_AUDIENCE names "${audience}", which is no https URL: a client's id (the audience of its ID tokens), another app's id or an audience every app shares (Okta's api://default) can be such an audience, so its tokens need a scope only Pulse's clients are granted. Name that scope in MCP_OAUTH_OIDC_SCOPES: OpenID Connect's own (openid, profile, email, address, phone, offline_access) are in every sign-in's token.`

describe("readOidcSettings: an audience no client's id can be, or a scope", () => {
  it.each(["https://pulse.example.test/mcp", "http://localhost:8400/mcp", "http://127.0.0.1/mcp"])(
    "takes the URL audience %s without a scope",
    (audience) => {
      expect(readOidcSettings(ISSUER, { audience }).audiences).toEqual([audience])
    },
  )

  it.each([
    ["a client id", "0oa1b2c3"],
    ["plain http off the machine itself", "http://pulse.example.test/mcp"],
    ["a URN", "urn:pulse:mcp"],
    ["an App ID URI", "api://pulse"],
    ["another scheme on the machine itself", "ftp://localhost/mcp"],
  ])("refuses %s without a scope, naming the first such audience", (_case, audience) => {
    expect(
      refusal(() =>
        readOidcSettings(ISSUER, { audience: `https://pulse.example.test/mcp,${audience},x` }),
      ),
    ).toBe(bareRefusal(audience))
  })

  it.each([
    "openid",
    "profile",
    "email",
    "address",
    "phone",
    "offline_access",
    "openid profile email address phone offline_access",
  ])(
    "refuses such an audience beside OpenID Connect's own scopes alone (%s), which every sign-in's token carries",
    (scopes) => {
      expect(refusal(() => readOidcSettings(ISSUER, { audience: "api://default", scopes }))).toBe(
        bareRefusal("api://default"),
      )
    },
  )

  it("takes such an audience beside a required scope of its own, OpenID Connect's beside it", () => {
    const settings = readOidcSettings(ISSUER, { audience: "0oa1b2c3", scopes: "openid pulse" })
    expect(settings.audiences).toEqual(["0oa1b2c3"])
    expect(settings.scopes).toEqual(["openid", "pulse"])
    expect(readOidcSettings(ISSUER, { audience: "0oa1b2c3", scopes: "pulse" }).scopes).toEqual([
      "pulse",
    ])
  })
})
