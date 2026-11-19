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
 * The web app through the boot's Entra ID provider at a fake tenant (the `entra` deployment): the
 * sign-in and every renewal go through the tenant's v2.0 authority without a resource, the page
 * shows the cockpit under the ID token's name, the sign-out ends the tenant's session without a
 * revocation (Entra ID has none), and a session whose grant was revoked ends once its token
 * expired.
 */

const JOBS_PAGE = `/app/engines/${HEALTHY_ENGINE}/jobs`

/** This browser's renewals at the deployment's provider: the scenarios beside it renew there too. */
const renewalsOf = (record: IdpRecord, session: string) =>
  record.grants.filter((grant) => grant.type === "refresh_token" && grant.session === session)

test.describe("the web app at Entra ID", () => {
  test("signs in through the v2.0 authority without a resource, shows the cockpit and renews", async ({
    page,
  }) => {
    const session = await signIn(page, JOBS_PAGE, { deployment: "entra" })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`Signed in as ${ALICE.name}`)).toBeAttached()
    const sections = page.getByRole("navigation", { name: "Cockpit sections" })
    await sections.getByRole("button", { name: "Incidents" }).click()
    await expect(page.getByText("No open incidents on this engine.")).toBeVisible({
      timeout: 15_000,
    })
    const record = await idpRecord("entra")
    expect(record.issuer).toMatch(/\/v2\.0$/)
    const renewals = renewalsOf(record, session)
    expect(renewals.length).toBeGreaterThan(0)
    for (const renewal of renewals) expect(renewal.resources).toEqual([])
    const exchanges = record.grants.filter((grant) => grant.type === "authorization_code")
    for (const exchange of exchanges) expect(exchange.resources).toEqual([])
  })

  test("signs out at the tenant's end of the session, which revokes nothing", async ({ page }) => {
    const session = await signIn(page, "/app", { deployment: "entra" })
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: "Sign out" }).click()
    await page.waitForURL((url) => url.pathname === "/app/signed-out")
    await expect(page.getByRole("heading", { name: "You signed out" })).toBeVisible()
    await expectNoAxeFinding(page)
    const record = await idpRecord("entra")
    expect(record.endedSessions.filter((ending) => ending.sid === session)).toEqual([
      {
        clientId: WEB_CLIENT_ID,
        postLogoutRedirectUri: `${originOf("entra")}/app/signed-out`,
        sid: session,
      },
    ])
    expect(record.revoked).toEqual([])
  })

  test("ends the session once the tenant refuses its renewal and the token expired", async ({
    page,
  }) => {
    const session = await signIn(page, JOBS_PAGE, { deployment: "entra" })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    // An admin's "Revoke sessions" for this user: the session's refresh tokens renew no more.
    await endGrant("entra", session)
    await page.waitForTimeout(SHORT_TOKEN_SECONDS * 1000 + 500)
    await page.getByRole("button", { name: "Refresh" }).click()
    await expect(page.getByText("Your session has ended")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: "Sign in again" })).toHaveCount(1)
    await expect(jobs.getByText("Card declined").first()).toBeVisible()
  })
})
