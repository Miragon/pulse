import { expect, test, type Page } from "@playwright/test"
import { C8_ENGINE, HEALTHY_ENGINE, REFUSED_C8_ENGINE } from "../engines.js"
import { collectErrors, expectNoAxeFinding, recordCalls, signIn } from "./web-sim.js"

/**
 * The web app's search across engines (D10, step 18 of the plan), on the `search` deployment: the
 * stub engine (Camunda 7, its history holding an ended invoice of order ORD-7003 and the running
 * invoices INV-2026-0042 and INV-2026-0043), test:host's loopback Camunda 8 cluster (the running
 * order ORD-7003) and a refused Camunda 8 profile. The navigation's field searches, every engine is
 * asked apart: a running and an ended instance show on two engines while the refused profile, read
 * nothing of, is a row of the strip as the server refuses it; exactly one hit takes the search's entry, so Back leads to
 * where the search started; none says what was searched, of the engines that could be searched. Nothing writes, axe finds nothing, and the
 * search widens no page at 320 px (WCAG 1.4.10).
 */

const START = `/app/engines/${HEALTHY_ENGINE}`

const heading = (page: Page) => page.getByRole("heading", { level: 1 })

/** The path and query the page's address shows. */
const here = (page: Page) => {
  const url = new URL(page.url())
  return `${url.pathname}${url.search}`
}

/** Searches `text` from the navigation's field on its side. */
async function search(page: Page, text: string) {
  const field = page
    .getByRole("banner")
    .getByRole("search", { name: "Find an instance" })
    .getByRole("searchbox", { name: "Find an instance" })
  await field.fill(text)
  await field.press("Enter")
}

/** The hits' table, a row per instance found. */
const found = (page: Page) => page.getByRole("table", { name: "Found instances" })

test.describe("the search across engines", () => {
  test("finds a running and an ended instance on two engines, the refused profile a row of the strip", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    await signIn(page, START, { deployment: "search" })
    await expect(heading(page)).toHaveText(HEALTHY_ENGINE, { timeout: 15_000 })
    await expect(
      page.getByRole("banner").getByText("ID or business key, exact", { exact: true }),
    ).toBeVisible()

    await search(page, "ORD-7003")
    await expect(heading(page)).toHaveText("ORD-7003", { timeout: 15_000 })
    expect(here(page)).toBe("/app/search?q=ORD-7003")
    await expect(
      page.getByText("2 instances found · 2 engines searched · exact search"),
    ).toBeVisible()
    const ended = found(page).getByRole("row", { name: `Instance ORD-7003 on ${HEALTHY_ENGINE}` })
    const running = found(page).getByRole("row", { name: `Instance ORD-7003 on ${C8_ENGINE}` })
    await expect(ended).toContainText("Invoice Receipt v3")
    await expect(ended).toContainText("Completed")
    await expect(running).toContainText("Order fulfillment v2")
    await expect(running).toContainText("Running")
    await expect(running).toHaveAttribute(
      "data-href",
      `/app/engines/${C8_ENGINE}/instances/2251799813685400`,
    )
    const refused = page.locator("[data-slot=status-strip]", {
      hasText: `${REFUSED_C8_ENGINE} couldn't be searched`,
    })
    await expect(refused).toBeVisible()
    await expect(refused).toContainText(
      `Engine ${REFUSED_C8_ENGINE} cannot be used: its profile is refused`,
    )
    // Every engine asked apart for the text alone, the refused profile read nothing of; no write.
    const finds = calls.filter((call) => call.name === "engine_screen_find_data")
    expect(finds.map((call) => call.arguments?.engine).sort()).toEqual(
      [C8_ENGINE, HEALTHY_ENGINE].sort(),
    )
    expect(finds.every((call) => call.arguments?.text === "ORD-7003")).toBe(true)
    expect(
      calls.every((call) => !/^engine_(set|resolve|delete|modify|retry)/.test(call.name)),
    ).toBe(true)
    await expectNoAxeFinding(page)
    // A row opens its instance, a new entry of the page's history.
    await running.click()
    await expect(page).toHaveURL(
      new RegExp(`/app/engines/${C8_ENGINE}/instances/2251799813685400$`),
    )
    await page.goBack()
    await expect(heading(page)).toHaveText("ORD-7003")
    expect(errors).toEqual([])
  })

  test("takes the search's entry with the one instance found, so Back leads to where it started", async ({
    page,
  }) => {
    await signIn(page, START, { deployment: "search" })
    await expect(heading(page)).toHaveText(HEALTHY_ENGINE, { timeout: 15_000 })

    await search(page, "INV-2026-0042")
    await expect(page).toHaveURL(
      new RegExp(`/app/engines/${HEALTHY_ENGINE}/instances/pi-invoice-42$`),
      {
        timeout: 15_000,
      },
    )
    await expect(heading(page)).toHaveText("pi-invoice-42")
    await page.goBack()
    await expect(heading(page)).toHaveText(HEALTHY_ENGINE)
    expect(here(page)).toBe(START)
  })

  test("says what it searched and that the search is exact where no engine that could be searched found an instance", async ({
    page,
  }) => {
    await signIn(page, "/app/search?q=ORD-70", { deployment: "search" })
    await expect(heading(page)).toHaveText("ORD-70", { timeout: 15_000 })
    // The refused profile could not be searched, so the page speaks of the others alone.
    await expect(
      page.getByText(
        'No engine that could be searched has an instance with the ID or the business key "ORD-70". Pulse finds the whole ID or the exact business key, never a part of one.',
      ),
    ).toBeVisible()
    await expect(page.getByText(`${REFUSED_C8_ENGINE} couldn't be searched`)).toBeVisible()
    await expect(
      page.getByText("0 instances found · 2 engines searched · exact search"),
    ).toBeVisible()
    await expect(
      page.getByRole("banner").getByRole("searchbox", { name: "Find an instance" }),
    ).toHaveValue("ORD-70")
  })

  test("widens no page at 320 px, and speaks German", async ({ browser }) => {
    const context = await browser.newContext({
      locale: "de-DE",
      viewport: { width: 320, height: 640 },
    })
    try {
      const page = await context.newPage()
      await signIn(page, "/app/search?q=ORD-7003", { deployment: "search" })
      await expect(heading(page)).toHaveText("ORD-7003", { timeout: 15_000 })
      await expect(
        page.getByText("2 Instanzen gefunden · 2 Engines durchsucht · genaue Suche"),
      ).toBeVisible()
      await expect(page.getByRole("table", { name: "Gefundene Instanzen" })).toBeVisible()
      await expect(
        page.getByText(`${REFUSED_C8_ENGINE} konnte nicht durchsucht werden`),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false)
      await expectNoAxeFinding(page)
      // Under 64rem the search sits in the drawer behind the menu.
      await page.getByRole("button", { name: "Menü" }).first().click()
      const drawer = page.getByRole("dialog", { name: "Pulse" })
      await expect(drawer.getByRole("searchbox", { name: "Instanz suchen" })).toHaveValue(
        "ORD-7003",
      )
    } finally {
      await context.close()
    }
  })
})
