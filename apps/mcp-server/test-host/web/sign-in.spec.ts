import { expect, test, type Page } from "@playwright/test"
import { BROKEN_ENGINE, HEALTHY_ENGINE } from "../engines.js"
import {
  ALICE,
  chooseUser,
  expectNoAxeFinding,
  idpRecord,
  originOf,
  type IdpRecord,
  recordCalls,
  signIn,
  WEB_CLIENT_ID,
} from "./web-sim.js"

/**
 * The web app's sign-in on the real server: a page needs a session, so a browser without one goes
 * to the identity provider and comes back to the page it asked for, its query kept; the sign-out
 * ends the session at the provider too; the server renews a session's token before it expires, and
 * a renewal the provider refuses ends the session with a notice whose sign-in comes back to the page.
 */

const JOBS_PAGE = `/app/cockpit?view=jobs&engine=${HEALTHY_ENGINE}`

/**
 * The calls the API refused from now on because the session was gone (401), each as its tool and
 * its arguments, so one read asked twice shows twice and two engines' reads of one feed do not.
 */
function refusedCalls(page: Page): string[] {
  const calls: string[] = []
  page.on("response", (response) => {
    const request = response.request()
    if (new URL(request.url()).pathname !== "/app/api/call" || response.status() !== 401) return
    const call = request.postDataJSON() as { name: string; arguments?: unknown }
    calls.push(`${call.name} ${JSON.stringify(call.arguments ?? {})}`)
  })
  return calls
}
const SESSION_COOKIE = "__Host-pulse-session"

test.describe("signing in", () => {
  test("sends a browser without a session to the identity provider, then shows the cockpit", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await page.goto(`${originOf()}/app`)
    // The provider's login page, on its own origin.
    expect(new URL(page.url()).origin).not.toBe(originOf())
    await chooseUser(page)
    await page.waitForURL(`${originOf()}/app`)

    // /app is the cockpit's landing: the engines and the server's boards to pick from.
    await expect(page.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByRole("button", { name: new RegExp(`^${HEALTHY_ENGINE}\\b`) }),
    ).toBeVisible()
    // The engine that answers 503 says so from its first failed read, as the board's strip does,
    // well before the query client's retries (1 + 2 + 4 s) would end.
    await expect(
      page.getByRole("button", { name: new RegExp(`^${BROKEN_ENGINE}\\b.*\\bunreachable$`) }),
    ).toBeVisible({ timeout: 3_000 })
    // The bar names who signed in and offers the sign-out.
    await expect(page.getByText(`Signed in as ${ALICE.name}`)).toBeAttached()
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible()
    expect(calls.filter((call) => call.name === "engine_open_cockpit")).toEqual([
      { name: "engine_open_cockpit", arguments: { view: "landing" } },
    ])
  })

  test("comes back to a deep link with its query after the sign-in", async ({ page }) => {
    const calls = recordCalls(page)
    await signIn(page, JOBS_PAGE)
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    const sections = page.getByRole("navigation", { name: "Cockpit sections" })
    await expect(sections.getByRole("button", { name: "Jobs" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(calls.find((call) => call.name === "engine_open_cockpit")?.arguments).toEqual({
      view: "jobs",
      engine: HEALTHY_ENGINE,
    })
  })

  test("signs out at the identity provider too, and /app asks to sign in again", async ({
    page,
    context,
  }) => {
    const session = await signIn(page)
    await expect(page.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    // This browser's session alone: the scenarios beside it sign in and out at the same provider.
    const ended = (record: IdpRecord) =>
      record.endedSessions.filter((ending) => ending.sid === session)
    const revoked = (record: IdpRecord) =>
      record.revoked.filter((revocation) => revocation.session === session)
    const before = await idpRecord()
    expect(ended(before)).toEqual([])
    expect(revoked(before)).toEqual([])
    await page.getByRole("button", { name: "Sign out" }).click()

    await page.waitForURL((url) => url.pathname === "/app/signed-out")
    await expect(page.getByRole("heading", { name: "You signed out" })).toBeVisible()
    await expectNoAxeFinding(page)
    const after = await idpRecord()
    // The provider ended the session the web client asked it to, and took back its refresh token.
    expect(ended(after)).toEqual([
      expect.objectContaining({
        clientId: WEB_CLIENT_ID,
        postLogoutRedirectUri: `${originOf()}/app/signed-out`,
      }),
    ])
    expect(revoked(after)).toHaveLength(1)
    const cookies = await context.cookies(originOf())
    expect(cookies.map((cookie) => cookie.name)).not.toContain(SESSION_COOKIE)

    await page.goto(`${originOf()}/app`)
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible()
    expect(new URL(page.url()).origin).not.toBe(originOf())
  })
})

// The short deployment's identity provider issues access tokens of 5 s, which the server renews
// before each call it forwards.
test.describe("a session's token", () => {
  test("is renewed before it expires, and the page goes on", async ({ page }) => {
    const session = await signIn(page, JOBS_PAGE, { deployment: "short" })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    // This browser's renewals alone: the scenario beside it renews on the same provider.
    const renewals = (record: IdpRecord) =>
      record.grants.filter((grant) => grant.type === "refresh_token" && grant.session === session)
        .length
    const before = renewals(await idpRecord("short"))
    const sections = page.getByRole("navigation", { name: "Cockpit sections" })
    await sections.getByRole("button", { name: "Incidents" }).click()
    await expect(page.getByText("No open incidents on this engine.")).toBeVisible({
      timeout: 15_000,
    })
    expect(renewals(await idpRecord("short"))).toBeGreaterThan(before)
    await expect(page.getByText("Your session has ended")).toHaveCount(0)
  })

  test("ends with the session when the identity provider refuses the renewal, and a sign-in keeps the page", async ({
    page,
    context,
  }) => {
    await signIn(page, JOBS_PAGE, { deployment: "short" })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })

    // The session ends at the provider (a sign-out elsewhere, say): this browser's own, by the
    // provider's cookie, so its refresh token renews no more and no other scenario's session ends.
    const { issuer } = await idpRecord("short")
    const ended = await context.request.get(`${issuer}/protocol/openid-connect/logout`)
    expect(ended.status()).toBe(200)
    const refused = refusedCalls(page)

    // A refresh of the list on screen: the frame's notice says it once, with the one way out;
    // the list keeps its rows and says nothing of it, no alert, no Try again, no Updating….
    await page.getByRole("button", { name: "Refresh" }).click()
    await expect(page.getByText("Your session has ended")).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => refused.length, { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(jobs.getByText("Card declined").first()).toBeVisible()
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
    await expect(page.getByText("Couldn't update the list")).toHaveCount(0)
    await expect(page.getByText(/You're signed out/)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expect(page.getByText("Updating…")).toHaveCount(0)
    await expect(page.getByText("Your session has ended")).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Sign in again" })).toHaveCount(1)
    // No read is retried: past the query client's first retry (1 s), each was refused once.
    await page.waitForTimeout(1_500)
    expect(new Set(refused).size).toBe(refused.length)

    // A section opened after it: its title stays the page's heading, its reads refused once, and
    // each of its parts says only that it is not loaded: no box, no second word of the session.
    const sections = page.getByRole("navigation", { name: "Cockpit sections" })
    await sections.getByRole("button", { name: "Incidents" }).click()
    await expect(
      page.getByRole("heading", { level: 1, name: `${HEALTHY_ENGINE} · Incidents` }),
    ).toBeVisible()
    await expect(page.getByText("This content couldn't be loaded").first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
    await expect(page.getByText(/You're signed out/)).toHaveCount(0)
    await expect(page.getByText("Your session has ended")).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expectNoAxeFinding(page)

    // No silent redirect: the page stays until the user signs in again, and comes back to it.
    expect(page.url()).toBe(`${originOf("short")}${JOBS_PAGE}`)
    await page.getByRole("button", { name: "Sign in again" }).click()
    await chooseUser(page)
    await page.waitForURL(`${originOf("short")}${JOBS_PAGE}`)
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Your session has ended")).toHaveCount(0)
  })
})

// The main deployment, its engines and boards; the session ends by its cookie, gone from the browser.
test.describe("a session that ends while the cockpit is open", () => {
  test("leaves the engines' rows to say nothing of the engines, and the notice to say it once", async ({
    page,
    context,
  }) => {
    const refused = refusedCalls(page)
    await signIn(page, JOBS_PAGE)
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    await context.clearCookies({ name: SESSION_COOKIE })
    await page.getByRole("button", { name: "Refresh" }).click()
    await expect(page.getByText("Your session has ended")).toBeVisible({ timeout: 15_000 })

    // The landing's rows read now and meet the ended session: no engine refused a login, and
    // none is down, so no row says so; each says it read nothing, without a tone.
    const trail = page.getByRole("navigation", { name: "Breadcrumb" })
    await trail.getByRole("button", { name: "All engines" }).click()
    for (const engine of [HEALTHY_ENGINE, BROKEN_ENGINE]) {
      const row = page.getByRole("button", { name: new RegExp(`^${engine}\\s*,\\s*not loaded$`) })
      await expect(row).toHaveAttribute("data-status", "notLoaded", { timeout: 15_000 })
    }
    await expect(page.getByText(/credentials rejected|unreachable/)).toHaveCount(0)
    await expect(page.getByText("Your session has ended")).toHaveCount(1)
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
    // Each read asked once: the ended session is no failure a retry changes.
    await page.waitForTimeout(1_500)
    expect(refused.length).toBeGreaterThan(0)
    expect(new Set(refused).size).toBe(refused.length)
    await expectNoAxeFinding(page)
  })
})
