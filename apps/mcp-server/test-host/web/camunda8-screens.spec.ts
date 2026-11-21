import { expect, test, type Page } from "@playwright/test"
import { c8Requests, FAILED_ORDER_KEY, INCIDENT_KEY } from "../c8-engine.js"
import { C8_CONTROL_ENV, C8_ENGINE, C8_OPERATE, C8_UNBOARDED_ENGINE } from "../engines.js"
import {
  collectErrors,
  expectNoAxeFinding,
  navEntry,
  recordCalls,
  rendered,
  signIn,
} from "./web-sim.js"

/**
 * The web app's screens on a Camunda 8 engine (D10, step 17 of the plan), on the `camunda8`
 * deployment over test:host's loopback cluster (c8-engine.ts and its world, c8-world.ts): the page
 * reads a Camunda 8 engine whole, while the chat still shows it on boards only (camunda8.spec.ts).
 * Its engine screen lists "Order fulfillment" with three running orders, one with an incident, and
 * says where a Camunda 8 engine's incidents show; the navigation offers its processes and neither
 * incidents nor jobs. Its process screen draws the Zeebe diagram with its counts and lists the
 * running orders; the cluster stops counting at 10,000 ended orders, so Ended and All read as a
 * lower bound ("10k+", "≥ 10,000" and "≥ 10,003" in their titles). The instance screen of ORD-7001 shows its
 * incident, its card's text read in place. Nothing writes, axe finds nothing, German too, and no
 * screen widens the page at 390 or 320 px (WCAG 1.4.10).
 */

const ENGINE = `/app/engines/${C8_ENGINE}`
const PROCESS = `${ENGINE}/processes/pulse-order`
const INSTANCE = `${ENGINE}/instances/${FAILED_ORDER_KEY}`

const heading = (page: Page) => page.getByRole("heading", { level: 1 })
const scope = (page: Page, name: RegExp) => page.getByRole("radio", { name })

/** The path and query the page's address shows. */
const here = (page: Page) => {
  const url = new URL(page.url())
  return `${url.pathname}${url.search}`
}

/** Whether the page scrolls sideways: no screen may widen it (WCAG 1.4.10). */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

/** The engine screen's hint where a Camunda 8 engine's incidents show: its strip's detail. */
const hintDetail = (page: Page, title: string) =>
  page.locator("[data-slot=status-strip]", { hasText: title }).locator("p > span").nth(1)

/** Whether a strip's detail shows whole on its line, never cut with an ellipsis. */
const showsWhole = (page: Page, title: string) =>
  hintDetail(page, title).evaluate((detail) => detail.scrollWidth <= detail.clientWidth)

/** What the cluster was asked since the last forget. */
const asked = (forget = false) => {
  const control = process.env[C8_CONTROL_ENV]
  if (!control) throw new Error(`${C8_CONTROL_ENV} is unset. Run via \`playwright test\``)
  return c8Requests(control, forget)
}

test.describe("the screens of a Camunda 8 engine", () => {
  test("its processes, without incidents and jobs, where its incidents show, and the way into a process", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    await signIn(page, ENGINE, { deployment: "camunda8" })
    await expect(heading(page)).toHaveText(C8_ENGINE, { timeout: 15_000 })
    await expect(page.locator("[data-slot=engine-product]")).toHaveText("Camunda 8 8.9.28")
    const processes = page.getByRole("table", { name: "Processes" })
    await expect(processes.getByRole("row", { name: /^Process Order fulfillment/ })).toBeVisible()
    const hint = "Incidents and jobs show at their instances"
    await expect(page.getByText(hint)).toBeVisible()
    await expect(hintDetail(page, hint)).toHaveText("Open a process, then an instance.")
    // The hint fits its one line on a laptop's width, with the navigation beside the screen.
    await page.setViewportSize({ width: 1024, height: 768 })
    expect(await showsWhole(page, hint)).toBe(true)
    // The profile names its Operate: the engine's own web app.
    await expect(
      page.getByRole("link", { name: "Open in Operate (opens in a new tab)" }),
    ).toHaveAttribute("href", C8_OPERATE)
    // Its section is its processes; the cockpit's incidents and jobs read Camunda 7 alone.
    await expect(navEntry(page, "Processes")).toHaveAttribute("aria-current", "page")
    await expect(navEntry(page, "Incidents")).toHaveCount(0)
    await expect(navEntry(page, "Jobs")).toHaveCount(0)
    await expect(page.getByText("boards only")).toHaveCount(0)
    // The screen, never the cockpit's gate of an engine shown on boards only.
    expect(calls.filter((call) => call.name === "engine_open_cockpit")).toEqual([])
    expect(calls.filter((call) => call.arguments?.engine === C8_ENGINE).map((c) => c.name)).toEqual(
      ["engine_screen_processes_data"],
    )
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)

    await processes.getByRole("row", { name: /^Process Order fulfillment/ }).click()
    await expect(heading(page)).toHaveText("Order fulfillment", { timeout: 15_000 })
    expect(here(page)).toBe(PROCESS)
  })

  test("a process: its diagram, its running orders, and the ended ones the cluster stopped counting", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await signIn(page, PROCESS, { deployment: "camunda8" })
    await expect(heading(page)).toHaveText("Order fulfillment", { timeout: 15_000 })
    await expect(page.getByRole("img", { name: "Diagram of Order fulfillment v2" })).toContainText(
      "Charge payment",
    )
    const table = page.getByRole("table", { name: "Instances" })
    await expect(table.getByRole("row", { name: /ORD-7001/ })).toBeVisible({ timeout: 15_000 })
    await expect(scope(page, /^Running 3$/)).toBeVisible()
    await expect(scope(page, /^With incident 1$/)).toBeVisible()
    // A count the cluster stopped at: compact, the lower bound in its title.
    // All counts the running orders and the ended ones the cluster counted: a lower bound too.
    for (const [name, bound] of [
      [/^Ended 10k\+$/, /^≥\s10,000$/u],
      [/^All 10k\+$/, /^≥\s10,003$/u],
    ] as const) {
      const count = scope(page, name).locator("[data-part=segment-count]")
      await expect(count).toHaveAttribute("title", bound)
    }
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)

    // The ended orders the cluster lists, a page of 50 and Load more.
    await scope(page, /^Ended/).click()
    await expect(table.locator("tbody > tr")).toHaveCount(50, { timeout: 15_000 })
    await expect(page).toHaveURL(/scope=ended/)
    await page.getByRole("button", { name: "Load more" }).click()
    await expect(table.locator("tbody > tr")).toHaveCount(100, { timeout: 15_000 })
  })

  test("an instance with its incident, its text read in place, the way back to its process", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await asked(true)
    await signIn(page, INSTANCE, { deployment: "camunda8" })
    await expect(heading(page)).toHaveText("ORD-7001", { timeout: 15_000 })
    const tabs = page.getByRole("tablist")
    await expect(tabs.getByRole("tab", { name: /^Incidents/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(page.getByText("the card gateway is unreachable").first()).toBeVisible()
    await expect(page.getByRole("img", { name: /^Diagram of / })).toContainText("Charge payment")
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)
    // No write: no retry and no hand-off.
    await expect(page.getByRole("button", { name: /retry|resolve|ask|chat/i })).toHaveCount(0)

    // The incident in focus at its address under the instance: its text read from the cluster.
    await page.goto(new URL(`${INSTANCE}/incidents/${INCIDENT_KEY}`, page.url()).toString())
    await expect(heading(page)).toHaveText("ORD-7001", { timeout: 15_000 })
    await expect.poll(asked).toContain(`GET /v2/incidents/${INCIDENT_KEY}`)

    await page
      .getByRole("link", { name: /Order fulfillment/ })
      .first()
      .click()
    await expect(heading(page)).toHaveText("Order fulfillment", { timeout: 15_000 })
  })

  test("in German, at 390 px: the engine screen's words and the lower bound", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: "de-DE",
      viewport: { width: 390, height: 780 },
    })
    try {
      const page = await context.newPage()
      await signIn(page, `/app/engines/${C8_UNBOARDED_ENGINE}`, { deployment: "camunda8" })
      await expect(heading(page)).toHaveText(C8_UNBOARDED_ENGINE, { timeout: 15_000 })
      const hint = "Incidents und Jobs stehen bei ihren Instanzen"
      await expect(page.getByText(hint)).toBeVisible()
      await expect(page.getByText("Öffne einen Prozess, dann eine Instanz.")).toBeVisible()
      await rendered(page)
      expect(await scrollsSideways(page)).toBe(false)
      await expectNoAxeFinding(page)
      await page.goto(
        new URL(`/app/engines/${C8_UNBOARDED_ENGINE}/processes/pulse-order`, page.url()).toString(),
      )
      const count = scope(page, /^Beendet/).locator("[data-part=segment-count]")
      await expect(count).toHaveAttribute("title", /^≥\s10\.000$/u, { timeout: 15_000 })
      await rendered(page)
      expect(await scrollsSideways(page)).toBe(false)
      await expectNoAxeFinding(page)
      // On a laptop's width the German hint fits its line too.
      await page.setViewportSize({ width: 1024, height: 768 })
      await page.goto(new URL(`/app/engines/${C8_UNBOARDED_ENGINE}`, page.url()).toString())
      await expect(page.getByText(hint)).toBeVisible({ timeout: 15_000 })
      expect(await showsWhole(page, hint)).toBe(true)
    } finally {
      await context.close()
    }
  })

  test("at 320 px: the engine screen with its hint and the process screen with its lower bound", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } })
    try {
      const page = await context.newPage()
      await signIn(page, ENGINE, { deployment: "camunda8" })
      await expect(heading(page)).toHaveText(C8_ENGINE, { timeout: 15_000 })
      await expect(page.getByText("Incidents and jobs show at their instances")).toBeVisible()
      await rendered(page)
      expect(await scrollsSideways(page)).toBe(false)
      await page.goto(new URL(PROCESS, page.url()).toString())
      await expect(scope(page, /^Ended 10k\+$/)).toBeVisible({ timeout: 15_000 })
      await rendered(page)
      expect(await scrollsSideways(page)).toBe(false)
    } finally {
      await context.close()
    }
  })
})
