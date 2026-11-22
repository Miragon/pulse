import { expect, test, type Page, type Response } from "@playwright/test"
import { BROKEN_ENGINE, HEALTHY_ENGINE, REFUSED_C8_ENGINE } from "../engines.js"
import {
  collectErrors,
  expectNoAxeFinding,
  navEntry,
  originOf,
  recordCalls,
  rendered,
  signIn,
} from "./web-sim.js"

/**
 * The web app's engine screen (D10, step 7 of the plan): an engine's own address shows its
 * processes, the page's own screen over the engine screen's feed (`engine_screen_processes_data`),
 * built from the same blocks as the editors' engine tab, its numbers the feed's: rows, the engine's
 * own web app the feed names, the scopes and the search in the browser and in the address (Back
 * and a reload keep them), a row that opens its process (still the cockpit's view) and is a link,
 * Ctrl or Cmd with C, the Refresh; a refused profile keeps the cockpit's one state, an unreachable
 * engine its failure in the screen's words; at 320 px, in German and dark, axe finds nothing.
 */

const ENGINE_PAGE = `/app/engines/${HEALTHY_ENGINE}`
const FEED = "engine_screen_processes_data"

interface ScreenRow {
  readonly bpmnProcessId: string
  readonly name?: string
  readonly latestVersion: number
  readonly running: number
  readonly withIncident: number
  readonly incidents: number
}

interface FeedAnswer {
  readonly processes: readonly ScreenRow[]
  readonly totals: { processes: number; running: number; withIncident: number }
  readonly webApp: { readonly url: string; readonly vendor: string } | null
}

/** The answer of the page's first call of the screen's feed, as its server sent it. */
function feedAnswer(page: Page): Promise<FeedAnswer> {
  return page
    .waitForResponse(
      (response: Response) =>
        new URL(response.url()).pathname === "/app/api/call" &&
        (response.request().postDataJSON() as { name?: string }).name === FEED,
    )
    .then(async (response) => {
      const { result } = (await response.json()) as {
        result: { content: Array<{ text: string }>; structuredContent?: FeedAnswer }
      }
      return result.structuredContent ?? (JSON.parse(result.content[0].text) as FeedAnswer)
    })
}

const table = (page: Page, name = "Processes") => page.getByRole("table", { name })

/** The process names the table shows, in its order. */
const shownProcesses = (page: Page) =>
  table(page)
    .locator("tbody tr")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")))

const feedCalls = (calls: { name: string }[]) => calls.filter((call) => call.name === FEED).length

test.describe("the engine screen", () => {
  test("shows each process with the feed's numbers, under the engine's bar", async ({ page }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    const answer = feedAnswer(page)
    await signIn(page, ENGINE_PAGE)
    const { processes, totals, webApp } = await answer
    expect(processes.length).toBeGreaterThan(1)
    await expect(table(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEALTHY_ENGINE)
    await expect(page).toHaveTitle(`${HEALTHY_ENGINE} · Pulse`)
    await expect(navEntry(page, "Processes")).toHaveAttribute("aria-current", "page")
    // Every row the feed names, in its order, each with its latest version and its three counts.
    expect(await shownProcesses(page)).toEqual(
      processes.map((row) => `Process ${row.name ?? row.bpmnProcessId}`),
    )
    for (const row of processes) {
      const cells = table(page)
        .getByRole("row", { name: `Process ${row.name ?? row.bpmnProcessId}` })
        .getByRole("cell")
      await expect(cells.nth(1)).toHaveText(`v${row.latestVersion}`)
      await expect(cells.nth(2)).toHaveText(String(row.running))
      await expect(cells.nth(3)).toContainText(String(row.withIncident))
      await expect(cells.nth(4)).toContainText(String(row.incidents))
    }
    await expect(table(page).getByRole("columnheader", { name: "Incidents" })).toBeVisible()
    await expect(page.getByRole("button", { name: "What the counts say" })).toBeVisible()
    await expect(
      page.getByText(
        `${totals.processes} processes · ${totals.running} running · ${totals.withIncident} with incident · all versions`,
      ),
    ).toBeVisible()
    // The engine's own web app, where the feed names it: the provider derives one for this engine.
    expect(webApp).not.toBeNull()
    const bar = page.locator("[data-slot=view-bar]")
    await expect(bar.getByRole("link", { name: `Open in ${webApp?.vendor}` })).toHaveAttribute(
      "href",
      webApp?.url ?? "",
    )
    // The server's verdict on a Camunda 7 engine without an open root incident, as the header's
    // badge, read apart from the screen's numbers.
    await expect(bar.locator("[data-part=engine-verdict]")).toHaveText("Stable")
    expect(calls.filter((call) => call.name === "engine_screen_verdict_data")).toHaveLength(1)
    // When the numbers were read, and the Refresh: no write, no hand-off.
    await expect(page.locator("[data-slot=freshness-stamp]")).toContainText("As of")
    await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(1)
    await expect(page.getByText(/\bchat\b/i)).toHaveCount(0)
    expect(calls.map((call) => call.name)).not.toContain("engine_open_cockpit")
    expect(feedCalls(calls)).toBe(1)
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)
  })

  test("filters by scope and search in the browser, reading nothing again", async ({ page }) => {
    const calls = recordCalls(page)
    const answer = feedAnswer(page)
    await signIn(page, ENGINE_PAGE)
    const { processes } = await answer
    await expect(table(page)).toBeVisible({ timeout: 15_000 })
    const withIncident = processes.filter((row) => row.withIncident > 0)
    await page.getByRole("radio", { name: /^With incident/ }).click()
    await expect(table(page).locator("tbody tr")).toHaveCount(withIncident.length)
    await page.getByRole("radio", { name: /^All/ }).click()
    const search = page.getByRole("searchbox", { name: "Search by name or BPMN process ID" })
    await search.fill("invoice")
    await search.press("Enter")
    await expect(table(page).locator("tbody tr")).toHaveCount(1)
    expect(await shownProcesses(page)).toEqual(["Process Invoice Receipt"])
    await search.fill("no process is called like this")
    await search.press("Enter")
    await expect(page.getByText("No processes match this filter.")).toBeVisible()
    expect(feedCalls(calls)).toBe(1)
  })

  test("keeps the scope and the search in the address: Back from a process and a reload keep them", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, ENGINE_PAGE)
    await expect(table(page)).toBeVisible({ timeout: 15_000 })
    const search = () => new URL(page.url()).search
    const entries = () => page.evaluate(() => history.length)
    const before = await entries()
    const withIncident = page.getByRole("radio", { name: /^With incident/ })
    await withIncident.click()
    await expect.poll(search).toBe("?scope=incident")
    await page.getByRole("radio", { name: /^All/ }).click()
    await expect.poll(search).toBe("")
    const field = page.getByRole("searchbox", { name: "Search by name or BPMN process ID" })
    await field.fill("invoice")
    await field.press("Enter")
    await expect.poll(search).toBe("?q=invoice")
    // A filter names the entry anew, and the focus stays where the reader typed.
    expect(await entries()).toBe(before)
    await expect(field).toBeFocused()
    const row = table(page).getByRole("row", { name: "Process Invoice Receipt" })
    await expect(table(page).locator("tbody tr")).toHaveCount(1)
    await row.getByRole("cell").nth(1).click()
    await expect(page.getByRole("heading", { level: 1, name: "Invoice Receipt" })).toBeVisible({
      timeout: 15_000,
    })
    // Back: the screen with the filter it had.
    await page.goBack()
    await expect(row).toBeVisible({ timeout: 15_000 })
    expect(search()).toBe("?q=invoice")
    await expect(field).toHaveValue("invoice")
    await expect(table(page).locator("tbody tr")).toHaveCount(1)
    // A reload: the scope and the search the address names.
    await withIncident.click()
    await expect.poll(search).toBe("?scope=incident&q=invoice")
    await page.reload()
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEALTHY_ENGINE, {
      timeout: 15_000,
    })
    await expect(withIncident).toBeChecked({ timeout: 15_000 })
    await expect(field).toHaveValue("invoice")
    // The filter reads nothing, nor does Back to a screen read 60 s ago: the first read, the reload's.
    await expect.poll(() => feedCalls(calls)).toBe(2)
  })

  test("a row opens its process in the page, a new tab with Ctrl or Cmd, and copies its BPMN process ID", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: originOf() })
    await signIn(page, ENGINE_PAGE)
    const row = table(page).getByRole("row", { name: "Process Invoice Receipt" })
    await expect(row).toBeVisible({ timeout: 15_000 })
    // Ctrl or Cmd with C on the focused row: its BPMN process ID, and a toast that says so.
    await row.focus()
    await page.keyboard.press("ControlOrMeta+c")
    await expect(page.getByText("BPMN process ID copied")).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("invoice")
    // A link: Ctrl or Cmd with a click opens the process in a new tab, the page stays.
    const opened = context.waitForEvent("page")
    await row
      .getByRole("cell")
      .nth(1)
      .click({ modifiers: ["ControlOrMeta"] })
    const tab = await opened
    await tab.waitForLoadState()
    expect(new URL(tab.url()).pathname).toBe(`${ENGINE_PAGE}/processes/invoice`)
    await tab.close()
    expect(new URL(page.url()).pathname).toBe(ENGINE_PAGE)
    // A click opens it in the page, a new entry: the page's process screen.
    await row.getByRole("cell").nth(1).click()
    const process = page.getByRole("heading", { level: 1, name: "Invoice Receipt" })
    await expect(process).toBeVisible({ timeout: 15_000 })
    await expect(process).toBeFocused()
    expect(new URL(page.url()).pathname).toBe(`${ENGINE_PAGE}/processes/invoice`)
    await page.goBack()
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEALTHY_ENGINE, {
      timeout: 15_000,
    })
  })

  test("reads again on Refresh, the rows on screen while it reads", async ({ page }) => {
    const calls = recordCalls(page)
    await signIn(page, ENGINE_PAGE)
    await expect(table(page)).toBeVisible({ timeout: 15_000 })
    const refresh = page.getByRole("button", { name: "Refresh" })
    await refresh.click()
    await expect.poll(() => feedCalls(calls)).toBe(2)
    await expect(table(page)).toBeVisible()
    await expect(refresh).toBeFocused()
  })

  test("an unreachable engine says so in the screen's words under its bar, and Try again reads it again", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const calls = recordCalls(page)
    await signIn(page, `/app/engines/${BROKEN_ENGINE}`)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(BROKEN_ENGINE)
    const failure = page.getByRole("heading", {
      name: `Engine ${BROKEN_ENGINE} is unreachable (HTTP 503)`,
    })
    await expect(failure).toBeVisible({ timeout: 30_000 })
    const before = feedCalls(calls)
    await page.getByRole("button", { name: "Try again" }).click()
    await expect.poll(() => feedCalls(calls)).toBeGreaterThan(before)
    expect(calls.map((call) => call.name)).not.toContain("engine_open_cockpit")
    await expectNoAxeFinding(page)
  })

  test("a refused profile keeps its one state and the screen reads nothing of it", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, `/app/engines/${REFUSED_C8_ENGINE}`, { deployment: "refusedC8" })
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(REFUSED_C8_ENGINE, {
      timeout: 15_000,
    })
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: `Engine ${REFUSED_C8_ENGINE} cannot be used: its profile is refused`,
      }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)
    expect(feedCalls(calls)).toBe(0)
    await expectNoAxeFinding(page)
  })
})

test.describe("the engine screen at 320 px, in German, on a dark system", () => {
  test.use({ locale: "de-DE", colorScheme: "dark", viewport: { width: 320, height: 640 } })

  test("speaks German, drops the narrow columns, scrolls not sideways; axe finds nothing", async ({
    page,
  }) => {
    await signIn(page, ENGINE_PAGE)
    const processes = table(page, "Prozesse")
    await expect(processes).toBeVisible({ timeout: 15_000 })
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await expect(page.getByRole("button", { name: "Menü", exact: true })).toBeVisible()
    await expect(
      processes.getByRole("columnheader", { name: "Prozess", exact: true }),
    ).toBeVisible()
    await expect(processes.getByRole("columnheader", { name: "Mit Incident" })).toBeVisible()
    await expect(processes.getByRole("columnheader", { name: "Incidents" })).toBeVisible()
    // Under 40rem of its region the table drops the latest version and the running instances.
    await expect(processes.getByRole("columnheader", { name: "Neueste Version" })).toBeHidden()
    await expect(processes.getByRole("columnheader", { name: "Laufend" })).toBeHidden()
    await expect(
      page.getByText(/ Prozesse · .* laufend · .* mit Incident · alle Versionen$/),
    ).toBeVisible()
    await rendered(page)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false)
    await expectNoAxeFinding(page)
  })
})

test("the engine screen fits 320 px in English", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } })
  try {
    const page = await context.newPage()
    await signIn(page, ENGINE_PAGE)
    await expect(table(page)).toBeVisible({ timeout: 15_000 })
    await rendered(page)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false)
    await expectNoAxeFinding(page)
  } finally {
    await context.close()
  }
})
