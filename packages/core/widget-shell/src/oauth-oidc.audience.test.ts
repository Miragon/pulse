import { describe, expect, it } from "vitest"
import { readOidcSettings } from "./oauth-oidc.js"

/**
 * The generic OpenID Connect provider's audiences: an https URL or ADFS's audience of a Web API on
 * its own, any other only beside a scope of Pulse's own, which no other app's token and no ID token
 * carries.
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
  `MCP_OAUTH_OIDC_AUDIENCE names "${audience}", which is no https URL and no ADFS audience of a Web API (microsoft:identityserver:<identifier>): a client's id (the audience of its ID tokens), another app's id or an audience every app shares (Okta's api://default) can be such an audience, so its tokens need a scope only Pulse's clients are granted. Name that scope in MCP_OAUTH_OIDC_SCOPES: OpenID Connect's own (openid, profile, email, address, phone, offline_access) are in every sign-in's token.`

describe("readOidcSettings: an audience no client's id can be, or a scope", () => {
  it.each(["https://pulse.example.test/mcp", "http://localhost:8400/mcp", "http://127.0.0.1/mcp"])(
    "takes the URL audience %s without a scope",
    (audience) => {
      expect(readOidcSettings(ISSUER, { audience }).audiences).toEqual([audience])
    },
  )

  it.each([
    "microsoft:identityserver:5e3c1a7b-2f4d-4c8e-9a6b-1d0f2e3c4b5a",
    "microsoft:identityserver:pulse",
  ])(
    "takes ADFS's audience of a Web API %s without a scope, which only its access tokens carry",
    (audience) => {
      expect(readOidcSettings(ISSUER, { audience }).audiences).toEqual([audience])
    },
  )

  it.each([
    ["a client id", "0oa1b2c3"],
    ["ADFS's prefix without an identifier", "microsoft:identityserver:"],
    [
      "ADFS's prefix in another case, which its tokens never carry",
      "Microsoft:IdentityServer:pulse",
    ],
    ["ADFS's prefix under a URN", "urn:microsoft:identityserver:pulse"],
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
