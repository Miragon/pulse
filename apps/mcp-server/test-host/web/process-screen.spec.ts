import { expect, test, type Page } from "@playwright/test"
import { CHAIN_ENGINE } from "../engines.js"
import {
  collectErrors,
  expectNoAxeFinding,
  originOf,
  recordCalls,
  rendered,
  signIn,
} from "./web-sim.js"

/**
 * The web app's process screen (D10, step 16 of the plan), on the `chain` deployment, whose one
 * engine replays an Operaton run of the conformance world (chain-engine.ts) with the histories the
 * process screen's lists read. Its numbers are the kit world's (WORLD_SCREENS of
 * @miragon/pulse-screens/testing, which the editors' definition view shows of the same world and
 * the server's feeds build of the recording): "Order fulfillment" at v2 with one running instance
 * and the notice that v1 still runs two, one with an incident; at v1 a root incident at
 * Activity_ChargePayment; "Dispatch order" with one running instance at its call activity, which
 * waits for an incident in the instance it called, and a button to "Print label". A version is an
 * entry of the page's history, which Back restores; the scopes, the business key and a count's
 * click name the entry anew; Escape clears the element; Load more appends a page; a row opens its
 * instance; nothing offers a write or a hand-off; axe finds nothing, dark, German and at 390 px,
 * where the diagram stacks above at least three rows of the list.
 */

const ENGINE = `/app/engines/${CHAIN_ENGINE}`
const ORDER = `${ENGINE}/processes/pulse-order`
const DISPATCH = `${ENGINE}/processes/pulse-dispatch`

/** Where the scenario's screenshots go for a look by eye (the counts on dark paper). */
const SHOTS = process.env.WEB_SIM_SHOTS

const heading = (page: Page) => page.getByRole("heading", { level: 1 })
const picker = (page: Page) => page.getByRole("combobox", { name: "Version" })
const table = (page: Page) => page.getByRole("table", { name: "Instances" })
const rows = (page: Page) => table(page).locator("tbody > tr")
const scope = (page: Page, name: RegExp) => page.getByRole("radio", { name })

/** The path and query the page's address shows. */
const here = (page: Page) => {
  const url = new URL(page.url())
  return `${url.pathname}${url.search}`
}

/** The entries of the tab's history. */
const entries = (page: Page) => page.evaluate(() => history.length)

/** The business keys of the list's rows, as they show. */
const keys = (page: Page) => rows(page).locator("td:nth-child(2)").allTextContents()

/** No control of the page writes to the engine, selects rows or hands off to a chat. */
async function expectNoWrite(page: Page): Promise<void> {
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: /retry|resolve|suspend|cancel|migrat|ask|chat/i }),
  ).toHaveCount(0)
}

test.describe("the process screen", () => {
  test("opens another version in a new entry, which Back restores, and refines its list in place", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const errors = collectErrors(page)
    await signIn(page, ORDER, { deployment: "chain" })
    await expect(heading(page)).toHaveText("Order fulfillment", { timeout: 15_000 })
    // The versions with their counts, as the editors' definition view words them.
    await expect(picker(page).locator("option")).toHaveText([
      "v2 · 1 running",
      "v1 · 2 running · 1 with incident",
    ])
    await expect(
      page.getByText("2 instances still run on older versions, 1 of them with incident."),
    ).toBeVisible()
    await expect.poll(() => keys(page)).toEqual(["ORD-2001"])
    await expectNoWrite(page)
    const start = await entries(page)

    // The notice's way to v1: a new entry, the focus on the heading.
    await page.getByRole("button", { name: "Show v1" }).click()
    await expect(page).toHaveURL(new RegExp(`${ORDER}\\?version=1$`))
    expect(await entries(page)).toBe(start + 1)
    await expect(picker(page)).toHaveValue(/^pulse-order:1:/)
    await expect(heading(page)).toBeFocused()
    await expect.poll(() => keys(page)).toEqual(["ORD-1002", "ORD-1001"])
    await expect(scope(page, /^Running/)).toContainText("2")
    await expect(scope(page, /^With incident/)).toContainText("1")
    await expect(scope(page, /^Ended/)).toContainText("1")
    await expect(scope(page, /^All/)).toContainText("3")

    // A scope names the entry anew: no entry of its own, the focus where it was.
    await scope(page, /^All/).click()
    await expect(page).toHaveURL(new RegExp(`${ORDER}\\?version=1&scope=all$`))
    expect(await entries(page)).toBe(start + 1)
    await expect.poll(() => keys(page)).toEqual(["ORD-1003", "ORD-1002", "ORD-1001"])
    await expect(scope(page, /^All/)).toBeFocused()

    // A count of the diagram filters to its element and its scope, in place; Escape clears it.
    const count = page.getByRole("button", { name: /^Charge payment: 1 incident\. Show/ })
    await expect(count).toHaveAttribute("data-scope", "withIncident")
    await count.click()
    await expect(page).toHaveURL(
      new RegExp(`${ORDER}\\?version=1&scope=incident&element=Activity_ChargePayment$`),
    )
    expect(await entries(page)).toBe(start + 1)
    await expect(page.locator("[data-part=filter-chip][data-kind=element]")).toContainText(
      "Charge payment",
    )
    await expect.poll(() => keys(page)).toEqual(["ORD-1002"])
    await expect(count).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(page).toHaveURL(new RegExp(`${ORDER}\\?version=1&scope=incident$`))
    await expect(page.locator("[data-part=filter-chip][data-kind=element]")).toHaveCount(0)

    // The exact business key, in place.
    await scope(page, /^All/).click()
    await page.getByRole("searchbox", { name: "Search by business key" }).fill("ORD-1003")
    await expect(page).toHaveURL(new RegExp(`${ORDER}\\?version=1&scope=all&key=ORD-1003$`))
    await expect.poll(() => keys(page)).toEqual(["ORD-1003"])
    expect(await entries(page)).toBe(start + 1)

    // Back: the latest version, as the entry left it.
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${ORDER}$`))
    await expect(picker(page)).toHaveValue(/^pulse-order:2:/)
    await expect(heading(page)).toBeFocused()
    await expect.poll(() => keys(page)).toEqual(["ORD-2001"])
    // Forward: v1 with the filter its entry kept, after a reload too.
    await page.goForward()
    await expect(page).toHaveURL(new RegExp(`${ORDER}\\?version=1&scope=all&key=ORD-1003$`))
    await expect.poll(() => keys(page)).toEqual(["ORD-1003"])
    await page.reload()
    await expect.poll(() => keys(page), { timeout: 15_000 }).toEqual(["ORD-1003"])
    await expect(page.getByRole("searchbox", { name: "Search by business key" })).toHaveValue(
      "ORD-1003",
    )

    // A pick in the picker: a new entry, the screen and the focus on the picker kept.
    const before = await entries(page)
    await picker(page).focus()
    await picker(page).selectOption({ index: 0 })
    await expect(page).toHaveURL(new RegExp(`${ORDER}\\?version=2$`))
    expect(await entries(page)).toBe(before + 1)
    await expect.poll(() => keys(page)).toEqual(["ORD-2001"])
    await expect(picker(page)).toBeFocused()
    await expect(heading(page)).toHaveText("Order fulfillment")
    expect(errors).toEqual([])
  })

  test("loads the next page after the rows shown, and a row opens its instance", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const calls = recordCalls(page)
    await signIn(page, `${DISPATCH}?scope=ended`, { deployment: "chain" })
    await expect(heading(page)).toHaveText("Dispatch order", { timeout: 15_000 })
    await expect(rows(page)).toHaveCount(50, { timeout: 15_000 })
    await expect(scope(page, /^Ended/)).toContainText("61")
    await expect(scope(page, /^All/)).toContainText("62")
    await expect
      .poll(() => keys(page).then((shown) => shown.slice(0, 2)))
      .toEqual(["DSP-2999", "DSP-2959"])
    await page.getByRole("button", { name: "Load more" }).click()
    await expect(rows(page)).toHaveCount(61)
    // The focus goes on to the first new row, never to the page's body.
    await expect(rows(page).nth(50)).toBeFocused()
    await expect.poll(() => keys(page).then((shown) => shown.at(-1))).toBe("DSP-2900")
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0)
    const later = calls.filter((call) => call.name === "engine_screen_instances_data").at(-1)
    expect(later?.arguments).toMatchObject({ scope: "ended", after: expect.any(String) })
    // A row opens its instance, a new entry; Back comes to the process screen again.
    await scope(page, /^Running/).click()
    await expect.poll(() => keys(page)).toEqual(["DSP-3001"])
    await table(page).getByRole("row", { name: "Instance DSP-3001" }).click()
    await expect(heading(page)).toHaveText("DSP-3001", { timeout: 15_000 })
    await page.goBack()
    await expect(heading(page)).toHaveText("Dispatch order")
    await expect.poll(() => keys(page)).toEqual(["DSP-3001"])
  })

  test("draws the counts of a call activity apart and opens what it calls", async ({ page }) => {
    await signIn(page, DISPATCH, { deployment: "chain" })
    const cluster = page.locator("[data-badge-for=Activity_PrintShippingLabel]")
    await expect(cluster).toBeVisible({ timeout: 15_000 })
    // One incident in the instance it called, quiet and never part of the incident count; one running.
    await expect(cluster.locator("[data-part=canvas-badge]")).toHaveText(["1", "1"])
    await expect(cluster.locator("[data-part=canvas-badge]").first()).toHaveAttribute(
      "data-kind",
      "incidentsInCalledInstances",
    )
    await expect(page.locator(".djs-shape.highlight-incident")).toHaveCount(0)
    if (SHOTS !== undefined) {
      await rendered(page)
      await page.locator("[data-slot=process-diagram]").screenshot({
        path: `${SHOTS}/process-call-activity.png`,
      })
    }
    await expect(scope(page, /^With incident/)).toContainText("1")
    const call = page.getByRole("link", { name: "Open called process Print label" })
    await expect(call).toHaveAttribute(
      "href",
      new RegExp(`${ENGINE}/processes/pulse-label\\?version=1$`),
    )
    await call.click()
    await expect(page).toHaveURL(new RegExp(`${ENGINE}/processes/pulse-label\\?version=1$`))
    await expect(heading(page)).toHaveText("Print label", { timeout: 15_000 })
    await page.goBack()
    await expect(heading(page)).toHaveText("Dispatch order")
  })

  test("in German, dark and at 390 px it stacks the diagram above three rows, and axe finds nothing", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await signIn(page, `${ORDER}?version=1&scope=all`, { deployment: "chain" })
    await expect(rows(page)).toHaveCount(3, { timeout: 15_000 })
    await rendered(page)
    await expectNoAxeFinding(page)
    await page.emulateMedia({ colorScheme: "dark" })
    await page.reload()
    await expect(page.locator("[data-badge-for=Activity_ChargePayment]")).toBeVisible({
      timeout: 15_000,
    })
    await rendered(page)
    if (SHOTS !== undefined) {
      await page.screenshot({ path: `${SHOTS}/process-dark.png` })
    }
    await expectNoAxeFinding(page)
    const german = await page
      .context()
      .browser()!
      .newContext({ locale: "de-DE", colorScheme: "dark" })
    const de = await german.newPage()
    await de.setViewportSize({ width: 390, height: 844 })
    await signIn(de, `${ORDER}?version=1&scope=all`, { deployment: "chain" })
    await expect(de.getByRole("table", { name: "Instanzen" }).locator("tbody > tr")).toHaveCount(
      3,
      { timeout: 15_000 },
    )
    await expect(de.getByRole("radio", { name: /^Alle/ })).toBeVisible()
    await rendered(de)
    if (SHOTS !== undefined) await de.screenshot({ path: `${SHOTS}/process-de-390.png` })
    expect(await de.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    // The list keeps its id and state on a phone, the business key and the start dropped, so its
    // region never scrolls sideways.
    const instances = de.getByRole("table", { name: "Instanzen" })
    await expect(instances.getByRole("columnheader", { name: "Geschäftsschlüssel" })).toBeHidden()
    await expect(instances.getByRole("columnheader", { name: "Gestartet" })).toBeHidden()
    await expect(instances.getByRole("columnheader", { name: "Status" })).toBeInViewport()
    expect(
      await de
        .getByRole("region", { name: "Instanzen", exact: true })
        .evaluate((region) => region.scrollWidth - region.clientWidth),
    ).toBe(0)
    // No split under 64rem: the diagram at a height of its own, three rows under it in the window.
    await expect(de.getByRole("separator")).toHaveCount(0)
    const frame = await de.locator("[data-slot=process-diagram-frame]").boundingBox()
    expect(frame?.height).toBeGreaterThanOrEqual(240)
    expect(frame?.height).toBeLessThanOrEqual(560)
    for (const row of await de
      .getByRole("table", { name: "Instanzen" })
      .locator("tbody > tr")
      .all()) {
      await expect(row).toBeInViewport()
    }
    await expectNoAxeFinding(de)
    // The latest version, under the notice that older ones run: the diagram leaves the strip its
    // height, so the list's rows stay in the window under it.
    await de.goto(`${originOf("chain")}${ORDER}?scope=all`)
    await expect(de.locator("[data-slot=process-strips] [data-slot=status-strip]")).toHaveCount(1, {
      timeout: 15_000,
    })
    const latest = de.getByRole("table", { name: "Instanzen" }).locator("tbody > tr")
    await expect(latest).toHaveCount(1, { timeout: 15_000 })
    const strips = (await de.locator("[data-slot=process-strips]").boundingBox())?.height ?? 0
    expect(strips).toBeGreaterThan(0)
    await expect
      .poll(async () => {
        const left = await de
          .locator("[data-slot=process-diagram-frame]")
          .evaluate((frame) => frame.style.getPropertyValue("--process-strips"))
        return Math.abs(Number.parseFloat(left) - strips) <= 1
      })
      .toBe(true)
    await expect(latest.first()).toBeInViewport()
    await german.close()
  })

  test("replaces the old address of a process's instances by the process's own", async ({
    page,
  }) => {
    await signIn(page, ENGINE, { deployment: "chain" })
    await page.goto(`${originOf("chain")}${ENGINE}/instances?process=pulse-dispatch`)
    await expect(page).toHaveURL(new RegExp(`${DISPATCH}$`), { timeout: 15_000 })
    await expect(heading(page)).toHaveText("Dispatch order")
    expect(here(page)).toBe(DISPATCH)
  })
})
