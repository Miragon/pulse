import { describe, expect, it } from "vitest"
import { readEntraSettings } from "./oauth-entra.js"

/** Microsoft Entra ID's tenant: the one tenant's id it takes, and every id it refuses. */

const TENANT = "4f1b6d0e-2c3a-4e5f-8a9b-0c1d2e3f4a5b"
const API = "7d2e9c41-6b3f-4a8e-9f10-2b3c4d5e6f70"

/** The refusal of `run`, its message. */
function refusal(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected a refusal")
}

const read = (values: Record<string, string> = {}, tenant = TENANT, api = API) =>
  readEntraSettings(tenant, api, values)

describe("readEntraSettings: the tenant", () => {
  it("takes the tenant's id, in lower case as its tokens name it", () => {
    expect(read({}, TENANT.toUpperCase()).tenant).toBe(TENANT)
  })

  it.each(["common", "organizations", "consumers", "Organizations"])(
    "refuses %s, which signs in the accounts of every tenant",
    (tenant) => {
      expect(refusal(() => read({}, tenant))).toBe(
        `MCP_OAUTH_ENTRA_TENANT_ID "${tenant.toLowerCase()}" signs in the accounts of every tenant, and Pulse serves one tenant: name your tenant's id, a GUID (Microsoft Entra admin center, Overview).`,
      )
    },
  )

  it.each([
    [
      "9188040d-6c67-4c5b-b112-36a304b66dad",
      "the tenant of every personal Microsoft account (consumers)",
    ],
    [
      "9188040D-6C67-4C5B-B112-36A304B66DAD",
      "the tenant of every personal Microsoft account (consumers)",
    ],
    ["f8cdef31-a31e-4b4a-93e4-5f571e91255a", "Microsoft's own tenant of its first-party services"],
  ])("refuses the id %s, which is no customer's tenant", (tenant, what) => {
    expect(refusal(() => read({}, tenant))).toBe(
      `MCP_OAUTH_ENTRA_TENANT_ID "${tenant.toLowerCase()}" is ${what}, and Pulse serves one organization's tenant: name your tenant's id, a GUID (Microsoft Entra admin center, Overview).`,
    )
  })

  it.each(["contoso.onmicrosoft.com", "contoso.com", `${TENANT}x`, `x${TENANT}`, "4f1b6d0e"])(
    "refuses %s, which is no tenant id, without quoting it",
    (tenant) => {
      expect(refusal(() => read({}, tenant))).toBe(
        "MCP_OAUTH_ENTRA_TENANT_ID must be your tenant's id, a GUID (Microsoft Entra admin center, Overview): its tokens name the tenant by its id, never by a domain name.",
      )
    },
  )
})
