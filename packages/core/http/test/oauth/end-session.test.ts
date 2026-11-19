import { describe, expect, it } from "vitest"
import { endSessionUrl } from "../../src/oauth/index.js"

const ENDPOINT = "https://login.example.com/realms/camunda/protocol/openid-connect/logout"
const SIGNED_OUT = "https%3A%2F%2Fpulse.example.com%2Fapp%2Fsigned-out"
const REQUEST = {
  clientId: "pulse web",
  postLogoutRedirectUri: "https://pulse.example.com/app/signed-out",
}

describe("endSessionUrl", () => {
  it("names the client and where the browser goes afterwards", () => {
    expect(endSessionUrl(ENDPOINT, REQUEST)).toBe(
      `${ENDPOINT}?client_id=pulse+web&post_logout_redirect_uri=${SIGNED_OUT}`,
    )
  })

  it("puts the ID token hint first and the state last, as RP-Initiated Logout lists them", () => {
    const url = endSessionUrl(ENDPOINT, { ...REQUEST, idTokenHint: "h.p.s", state: "s/1 2" })
    expect(url).toBe(
      `${ENDPOINT}?id_token_hint=h.p.s&client_id=pulse+web&post_logout_redirect_uri=${SIGNED_OUT}&state=s%2F1+2`,
    )
  })

  it("keeps the endpoint's own query", () => {
    const url = endSessionUrl("https://tenant.example.com/oidc/logout?federated=a%20b", REQUEST)
    expect(url).toBe(
      `https://tenant.example.com/oidc/logout?federated=a%20b&client_id=pulse+web&post_logout_redirect_uri=${SIGNED_OUT}`,
    )
  })
})
