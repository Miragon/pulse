import { expect, test, type Page } from "@playwright/test"
import {
  BROKEN_ENGINE,
  C8_ENGINE,
  C8_UNBOARDED_ENGINE,
  HEALTHY_ENGINE,
  INVOICES_BOARD,
  REFUSED_C8_ENGINE,
} from "../engines.js"
import {
  ALICE,
  collectErrors,
  expectNoAxeFinding,
  navEntry,
  navigation,
  recordCalls,
  rendered,
  signIn,
} from "./web-sim.js"

/**
 * The web app's frame (variant B, "frame first"): a side navigation beside the view, in the
 * editors' look, the page's own screens (an engine's processes) and the cockpit's routes without
 * their head as its content. Every entry is a link of
 * the page that navigates without a reload, its current one `aria-current="page"` through Back and
 * Forward, focus on the new view's h1; under 64rem a drawer behind the menu every view bar shows
 * first, with the account and the sign-out in it; one read of the engine list per page view.
 */

const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true })

/** The page and its query, as the address bar names it. */
const here = (page: Page) => {
  const url = new URL(page.url())
  return `${url.pathname}${url.search}`
}

/** Marks the document: a reload loses the mark, a move inside the page keeps it. */
const mark = (page: Page) => page.evaluate(() => ((window as { pulseMark?: number }).pulseMark = 1))
const marked = (page: Page) =>
  page.evaluate(() => (window as { pulseMark?: number }).pulseMark === 1)

/** An engine's entry with its note: a browser's name puts a space before the note's comma. */
const noted = (page: Page, engine: string, note: string) =>
  navigation(page).getByRole("link", { name: new RegExp(`^${engine} ?, ${note}$`) })

/** The entries of the navigation the place on screen makes current. */
const currentEntries = (page: Page) =>
  navigation(page).locator('[aria-current="page"]').allTextContents()

test.describe("the page's side navigation", () => {
  test("every entry navigates without a reload, its entry current, the focus on the new h1", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const errors = collectErrors(page)
    await signIn(page, "/app")
    await expect(h1(page, "Operations Cockpit")).toBeVisible({ timeout: 15_000 })
    await mark(page)
    for (const [entry, address, heading, current] of [
      ["Cross-engine overview", "/app/fleet", "Cross-engine overview", "Cross-engine overview"],
      [HEALTHY_ENGINE, `/app/engines/${HEALTHY_ENGINE}`, HEALTHY_ENGINE, "Processes"],
      [
        "Incidents",
        `/app/engines/${HEALTHY_ENGINE}/incidents`,
        `${HEALTHY_ENGINE} · Incidents`,
        "Incidents",
      ],
      ["Jobs", `/app/engines/${HEALTHY_ENGINE}/jobs`, `${HEALTHY_ENGINE} · Jobs`, "Jobs"],
      ["Processes", `/app/engines/${HEALTHY_ENGINE}`, HEALTHY_ENGINE, "Processes"],
      [BROKEN_ENGINE, `/app/engines/${BROKEN_ENGINE}`, BROKEN_ENGINE, "Processes"],
      [
        "Invoice operations",
        `/app/boards/${INVOICES_BOARD}`,
        "Invoice operations",
        "Invoice operations",
      ],
      ["Start", "/app", "Operations Cockpit", "Start"],
    ] as const) {
      await navEntry(page, entry).click()
      const title = h1(page, heading)
      await expect(title, entry).toBeVisible({ timeout: 15_000 })
      expect(here(page), entry).toBe(address)
      expect(await currentEntries(page), entry).toEqual([current])
      await expect(title, entry).toBeFocused()
      expect(await marked(page), entry).toBe(true)
    }
    expect(errors).toEqual([])
  })

  test("its current entry follows Back and Forward, the focus on the h1 they lead to", async ({
    page,
  }) => {
    await signIn(page, `/app/engines/${HEALTHY_ENGINE}/incidents`)
    await expect(h1(page, `${HEALTHY_ENGINE} · Incidents`)).toBeVisible({ timeout: 15_000 })
    await mark(page)
    await navEntry(page, "Jobs").click()
    await expect(h1(page, `${HEALTHY_ENGINE} · Jobs`)).toBeVisible({ timeout: 15_000 })
    await page.goBack()
    const incidents = h1(page, `${HEALTHY_ENGINE} · Incidents`)
    await expect(incidents).toBeVisible({ timeout: 15_000 })
    expect(await currentEntries(page)).toEqual(["Incidents"])
    await expect(incidents).toBeFocused()
    await page.goForward()
    const jobs = h1(page, `${HEALTHY_ENGINE} · Jobs`)
    await expect(jobs).toBeVisible({ timeout: 15_000 })
    expect(await currentEntries(page)).toEqual(["Jobs"])
    await expect(jobs).toBeFocused()
    expect(await marked(page)).toBe(true)
  })

  test("is a real link: a Ctrl+click opens a new tab and leaves the page where it is", async ({
    page,
    context,
  }) => {
    await signIn(page, `/app/engines/${HEALTHY_ENGINE}`)
    await expect(h1(page, HEALTHY_ENGINE)).toBeVisible({ timeout: 15_000 })
    const opened = context.waitForEvent("page")
    await navEntry(page, "Jobs").click({ modifiers: ["ControlOrMeta"] })
    const tab = await opened
    await tab.waitForLoadState()
    expect(new URL(tab.url()).pathname).toBe(`/app/engines/${HEALTHY_ENGINE}/jobs`)
    expect(here(page)).toBe(`/app/engines/${HEALTHY_ENGINE}`)
    await tab.close()
  })

  test("costs one read of the engine list per page view and none per engine: it carries no counts", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, `/app/engines/${HEALTHY_ENGINE}/jobs`)
    await expect(page.getByRole("region", { name: "Jobs", exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await rendered(page)
    const lists = () => calls.filter((call) => call.name === "engine_list_engines")
    expect(lists()).toHaveLength(1)
    // A move inside the page reads it no second time.
    await navEntry(page, "Incidents").click()
    await expect(h1(page, `${HEALTHY_ENGINE} · Incidents`)).toBeVisible({ timeout: 15_000 })
    await rendered(page)
    expect(lists()).toHaveLength(1)
    await expect(navigation(page).getByText(/^\d/)).toHaveCount(0)
  })

  test("names who is signed in and holds the sign-out at its foot; axe finds nothing", async ({
    page,
  }) => {
    await signIn(page, `/app/engines/${HEALTHY_ENGINE}`)
    await expect(h1(page, HEALTHY_ENGINE)).toBeVisible({ timeout: 15_000 })
    const side = page.getByRole("banner")
    await expect(side.getByText(`Signed in as ${ALICE.name}`)).toBeAttached()
    await expect(side.getByRole("button", { name: "Sign out" })).toBeVisible()
    // The view takes the room beside the navigation: no 72rem sheet, 16 px off its edges.
    const nav = await side.boundingBox()
    const sheet = await page.locator("[data-slot=page-content]").boundingBox()
    const viewport = page.viewportSize()
    expect(sheet?.x).toBeCloseTo((nav?.x ?? 0) + (nav?.width ?? 0) + 16, 0)
    expect((sheet?.x ?? 0) + (sheet?.width ?? 0)).toBeCloseTo((viewport?.width ?? 0) - 16, 0)
    await rendered(page)
    await expectNoAxeFinding(page)
  })
})

test.describe("the page's drawer under 64rem", () => {
  for (const [locale, menu, signOut, close, start] of [
    ["en-US", "Menu", "Sign out", "Close menu", "Start"],
    ["de-DE", "Menü", "Abmelden", "Menü schließen", "Start"],
  ] as const) {
    test(`at 320 px holds the navigation, the account and the sign-out (${locale})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ locale, viewport: { width: 320, height: 640 } })
      try {
        const page = await context.newPage()
        await signIn(page, `/app/engines/${HEALTHY_ENGINE}/jobs`)
        const title = page.getByRole("heading", { level: 1 })
        await expect(title).toBeVisible({ timeout: 15_000 })
        await rendered(page)
        // No side at this width: the menu is the first element of the view's bar.
        await expect(navigation(page)).toBeHidden()
        const bar = page.locator("[data-slot=view-bar]").filter({ has: title })
        const button = bar.getByRole("button", { name: menu, exact: true })
        await expect(button).toBeVisible()
        expect(
          await bar.evaluate((el) => el.querySelector("button")?.getAttribute("aria-label")),
        ).toBe(menu)
        await expect(page.getByRole("button", { name: menu, exact: true })).toHaveCount(1)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          ),
        ).toBe(false)

        await button.click()
        const drawer = page.getByRole("dialog", { name: "Pulse" })
        await expect(drawer).toBeVisible()
        await expect(drawer.getByRole("navigation", { name: "Pulse" })).toBeVisible()
        await expect(drawer.getByText(ALICE.name, { exact: true })).toBeVisible()
        await expect(drawer.getByRole("button", { name: signOut })).toBeInViewport()
        await expect(drawer.getByRole("button", { name: close })).toBeVisible()
        await expectNoAxeFinding(page)
        // Escape closes it and gives the focus back to the menu.
        await page.keyboard.press("Escape")
        await expect(drawer).toBeHidden()
        await expect(button).toBeFocused()

        // An entry closes it and moves the page on, the focus on the new view's heading.
        await button.click()
        await drawer.getByRole("link", { name: start, exact: true }).click()
        await expect(drawer).toBeHidden()
        expect(here(page)).toBe("/app")
        const landing = page.getByRole("heading", { level: 1 })
        await expect(landing).toBeFocused({ timeout: 15_000 })
      } finally {
        await context.close()
      }
    })
  }

  test("at 320 px a long title gives way beside the menu, both on the bar's first line", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } })
    try {
      const page = await context.newPage()
      await signIn(page, `/app/engines/${HEALTHY_ENGINE}/jobs`)
      const title = page.getByRole("heading", { level: 1 })
      await expect(title).toBeVisible({ timeout: 15_000 })
      // A title longer than the room beside the menu, as a process's or a board's can be.
      await title.evaluate((heading) => {
        const words = heading.querySelector("span")?.firstChild
        if (words) words.nodeValue = "Order fulfillment with manual approval and escalation"
      })
      await rendered(page)
      const bar = page.locator("[data-slot=view-bar]").filter({ has: title })
      const menu = bar.getByRole("button", { name: "Menu", exact: true })
      const [menuBox, titleBox] = await Promise.all([menu.boundingBox(), title.boundingBox()])
      const middle = (box: typeof menuBox) => (box?.y ?? 0) + (box?.height ?? 0) / 2
      expect(Math.abs(middle(menuBox) - middle(titleBox))).toBeLessThan(2)
      // The title is cut with an ellipsis instead, and the page does not scroll sideways.
      expect(
        await title.evaluate((heading) => {
          const words = heading.querySelector("span")
          return words !== null && words.scrollWidth > words.clientWidth
        }),
      ).toBe(true)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false)
    } finally {
      await context.close()
    }
  })

  test("a view without a bar of its own keeps the menu in the page's row", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 700 } })
    try {
      const page = await context.newPage()
      await signIn(page, "/app/engines/no-such-engine")
      await expect(
        page.getByRole("heading", { level: 1, name: "Engine no-such-engine isn't on this server" }),
      ).toBeVisible({ timeout: 15_000 })
      const row = page.locator("[data-slot=page-menu-row]")
      await expect(row.getByRole("button", { name: "Menu" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(1)
      await expectNoAxeFinding(page)
    } finally {
      await context.close()
    }
  })
})

test.describe("the page's navigation in German, on a dark system", () => {
  test.use({ locale: "de-DE", colorScheme: "dark" })

  test("its words in German, the current entry's edge in the interaction colour; axe finds nothing", async ({
    page,
  }) => {
    await signIn(page, `/app/engines/${HEALTHY_ENGINE}/incidents`)
    await expect(h1(page, `${HEALTHY_ENGINE} · Incidents`)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    for (const name of ["Start", "Engine-übergreifende Übersicht", "Prozesse", "Jobs"]) {
      await expect(navEntry(page, name), name).toBeVisible()
    }
    await expect(page.getByRole("banner").getByRole("button", { name: "Abmelden" })).toBeVisible()
    const current = navEntry(page, "Incidents")
    await expect(current).toHaveAttribute("aria-current", "page")
    // The edge's colour against `--interaction` resolved where the entry stands (a probe's text).
    const [edge, interaction] = await current.evaluate((el) => {
      const probe = document.createElement("span")
      probe.style.color = "var(--interaction)"
      el.append(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      return [getComputedStyle(el).borderInlineStartColor, resolved]
    })
    expect(interaction).not.toBe("rgba(0, 0, 0, 0)")
    expect(edge).toBe(interaction)
    expect(await current.evaluate((el) => getComputedStyle(el).borderInlineStartWidth)).toBe("2px")
    // Only the current entry draws it.
    expect(
      await navEntry(page, "Jobs").evaluate((el) => getComputedStyle(el).borderInlineStartColor),
    ).not.toBe(interaction)
    await rendered(page)
    await expectNoAxeFinding(page)
  })
})

test.describe("the page's navigation beside Camunda 8 and refused profiles", () => {
  test("a Camunda 8 engine says it shows on boards only and opens its one state", async ({
    page,
  }) => {
    await signIn(page, "/app", { deployment: "camunda8" })
    await expect(h1(page, "Operations Cockpit")).toBeVisible({ timeout: 15_000 })
    for (const engine of [C8_ENGINE, C8_UNBOARDED_ENGINE]) {
      await expect(noted(page, engine, "boards only")).toBeVisible()
    }
    await noted(page, C8_ENGINE, "boards only").click()
    // Its own bar: its name the h1, which takes the focus, the Refresh the bar's one action.
    await expect(h1(page, C8_ENGINE)).toBeFocused({ timeout: 15_000 })
    await expect(
      page.getByRole("heading", { level: 2, name: `${C8_ENGINE} is a Camunda 8 engine` }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(1)
    expect(await currentEntries(page)).toEqual([`${C8_ENGINE}, boards only`])
    await expect(navEntry(page, "Jobs")).toHaveCount(0)
    await expectNoAxeFinding(page)
  })

  test("a refused profile shows its warning and opens its one state", async ({ page }) => {
    await signIn(page, "/app", { deployment: "refusedC8" })
    const entry = noted(page, REFUSED_C8_ENGINE, "refused")
    await expect(entry).toBeVisible({ timeout: 15_000 })
    await entry.click()
    await expect(h1(page, REFUSED_C8_ENGINE)).toBeFocused({ timeout: 15_000 })
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: `Engine ${REFUSED_C8_ENGINE} cannot be used: its profile is refused`,
      }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(1)
    await expect(entry).toHaveAttribute("aria-current", "page")
    await expectNoAxeFinding(page)
  })
})
