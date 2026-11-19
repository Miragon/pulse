import { expect, test } from "@playwright/test"
import { HEALTHY_ENGINE } from "../engines.js"
import {
  ALICE,
  endGrant,
  expectNoAxeFinding,
  idpRecord,
  originOf,
  type IdpRecord,
  SHORT_TOKEN_SECONDS,
  signIn,
  WEB_CLIENT_ID,
} from "./web-sim.js"

/**
 * The web app through the generic OpenID Connect provider at a fake ADFS (the `adfs` deployment):
 * the sign-in names the resource, the page shows the cockpit under the name the access token
 * carries, the sign-out ends ADFS's session without a revocation (ADFS has none), and a renewal
 * ADFS refuses ends the session once the token expired.
 */

const JOBS_PAGE = `/app/engines/${HEALTHY_ENGINE}/jobs`

/** This browser's renewals at the deployment's provider: the scenarios beside it renew there too. */
const renewalsOf = (record: IdpRecord, session: string) =>
  record.grants.filter((grant) => grant.type === "refresh_token" && grant.session === session)

test.describe("the web app at ADFS", () => {
  test("signs in for the resource, shows the cockpit under the upn and renews for the resource", async ({
    page,
  }) => {
    const session = await signIn(page, JOBS_PAGE, { deployment: "adfs" })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`Signed in as ${ALICE.upn}`)).toBeAttached()
    const resource = `${originOf("adfs")}/mcp`
    const sections = page.getByRole("navigation", { name: "Cockpit sections" })
    await sections.getByRole("button", { name: "Incidents" }).click()
    await expect(page.getByText("No open incidents on this engine.")).toBeVisible({
      timeout: 15_000,
    })
    const record = await idpRecord("adfs")
    const renewals = renewalsOf(record, session)
    expect(renewals.length).toBeGreaterThan(0)
    for (const renewal of renewals) expect(renewal.resources).toEqual([resource])
    const exchanges = record.grants.filter((grant) => grant.type === "authorization_code")
    for (const exchange of exchanges) expect(exchange.resources).toEqual([resource])
  })

  test("signs out at ADFS's end of the session, which revokes nothing", async ({ page }) => {
    const session = await signIn(page, "/app", { deployment: "adfs" })
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: "Sign out" }).click()
    await page.waitForURL((url) => url.pathname === "/app/signed-out")
    await expect(page.getByRole("heading", { name: "You signed out" })).toBeVisible()
    await expectNoAxeFinding(page)
    const record = await idpRecord("adfs")
    expect(record.endedSessions.filter((ending) => ending.sid === session)).toEqual([
      {
        clientId: WEB_CLIENT_ID,
        postLogoutRedirectUri: `${originOf("adfs")}/app/signed-out`,
        sid: session,
      },
    ])
    expect(record.revoked).toEqual([])
  })

  test("ends the session once ADFS refuses its renewal and the token expired", async ({ page }) => {
    const session = await signIn(page, JOBS_PAGE, { deployment: "adfs" })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    // ADFS's own sign-out leaves its refresh tokens renewing (its FAQ), so the grant itself ends,
    // as when ADFS takes back the user's access.
    await endGrant("adfs", session)
    await page.waitForTimeout(SHORT_TOKEN_SECONDS * 1000 + 500)
    await page.getByRole("button", { name: "Refresh" }).click()
    await expect(page.getByText("Your session has ended")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: "Sign in again" })).toHaveCount(1)
    await expect(jobs.getByText("Card declined").first()).toBeVisible()
  })
})
