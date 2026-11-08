import AxeBuilder from "@axe-core/playwright"
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test"
import { BROKEN_ENGINE, HEALTHY_ENGINE } from "./engines.js"

/**
 * The cockpit's cross-engine overview in the BUILT bundle at the width a chat gives an inline
 * view (760 px), opened from the picker of the default deployment's two engines: the stub engine
 * and the one that answers every request with a 503. Its landscape is read from each engine's own
 * REST API: the tables keep every column they promise in view
 * without widening the document, their column groups are headed, the engine that does not answer
 * says so in words and gets no column, and the view passes axe in light and dark.
 */

const INLINE_WIDTH = 760
/** The broken engine's reads fail after the view's retries (TanStack's back-off). */
const UNREACHABLE_MS = 15_000

interface Host {
  theme?: "light" | "dark"
  locale?: string
  /** The host's height budget and display modes (absent: unstated, inline only). */
  maxHeight?: number
  displayModes?: string[]
}

const OPEN_FLEET: Record<string, string> = {
  "en-US": "Cross-engine overview",
  "de-DE": "Engine-übergreifende Übersicht",
}

async function openFleet(page: Page, host: Host = {}): Promise<FrameLocator> {
  const base = process.env.HOST_SIM_URL
  if (!base) throw new Error("HOST_SIM_URL is unset. Run via `playwright test -c test-host`")
  const locale = host.locale ?? "en-US"
  const query = new URLSearchParams({
    tool: "engine_open_cockpit",
    // No engine: the picker of the two, which offers the cross-engine overview.
    args: JSON.stringify({}),
    structuredContent: "keep",
    resultDelayMs: "0",
    theme: host.theme ?? "light",
    locale,
    width: String(INLINE_WIDTH),
  })
  if (host.maxHeight !== undefined) query.set("maxHeight", String(host.maxHeight))
  if (host.displayModes) query.set("displayModes", host.displayModes.join(","))
  await page.goto(`${base}/?${query.toString()}`)
  const app = page.frameLocator("#app")
  await app.getByRole("button", { name: OPEN_FLEET[locale] }).click({ timeout: 15_000 })
  return app
}

const engineTable = (app: FrameLocator, name = "Load and job backlog per engine") =>
  app.getByRole("region", { name })
const matrix = (app: FrameLocator) =>
  app.getByRole("region", { name: "Process definitions by engine" })

/**
 * Until the broken engine is counted unreachable, the layout is still moving. The count stands
 * above the tables, so it shows under any height budget.
 */
async function settled(app: FrameLocator, locale = "en-US"): Promise<void> {
  const unreachable = locale === "de-DE" ? "1 nicht erreichbar" : "1 unreachable"
  await expect(app.getByText(unreachable, { exact: true })).toBeVisible({
    timeout: UNREACHABLE_MS,
  })
}

async function documentOverflow(app: FrameLocator) {
  return await app.locator("html").evaluate((html) => ({
    scrollWidth: html.scrollWidth,
    clientWidth: html.clientWidth,
  }))
}

/** Each column head of a region's table: its text, whether it shows, and whether it lies inside the region. */
async function columnsInView(region: Locator) {
  return await region.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return [...el.querySelectorAll("thead tr:last-child th")].map((th) => {
      const head = th.getBoundingClientRect()
      return {
        label: th.textContent?.trim() ?? "",
        shown: getComputedStyle(th).display !== "none",
        inside: head.left >= box.left - 1 && head.right <= box.right + 1,
      }
    })
  })
}

test.describe("the cross-engine overview at the inline width (760 px)", () => {
  test("the landscape: headed column groups, the backlog in reach, the silent engine in words", async ({
    page,
  }) => {
    const app = await openFleet(page)
    await settled(app)
    const engines = engineTable(app)
    const { scrollWidth, clientWidth } = await documentOverflow(app)
    expect(scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(clientWidth)

    await expect(engines.getByRole("columnheader", { name: "Load (absolute)" })).toBeVisible()
    await expect(
      engines.getByRole("columnheader", { name: "Job backlog, comparable across engines" }),
    ).toBeVisible()
    const columns = await columnsInView(engines)
    for (const label of ["Executable jobs", "Suspended jobs", "Due later", "External tasks"]) {
      expect(
        columns.find((c) => c.label === label),
        label,
      ).toMatchObject({
        shown: true,
        inside: true,
      })
    }
    const down = engines.getByRole("row").filter({ hasText: BROKEN_ENGINE })
    await expect(down).toContainText("unreachable")

    // What runs where: the stub's processes named, a column for the engine that answered only.
    const processes = matrix(app)
    await expect(processes.getByText("Invoice Receipt")).toBeVisible()
    await expect(processes.getByRole("columnheader", { name: HEALTHY_ENGINE })).toBeVisible()
    await expect(processes.getByRole("columnheader", { name: BROKEN_ENGINE })).toHaveCount(0)
    await expect(
      app.getByText(`No column for ${BROKEN_ENGINE}: this engine has not answered.`),
    ).toBeVisible()
    await expect(app.getByRole("button", { name: "Analyze performance in chat" })).toHaveCount(0)
  })

  test("the landscape in German: its longer heads still keep every column in view", async ({
    page,
  }) => {
    const app = await openFleet(page, { locale: "de-DE" })
    await settled(app, "de-DE")
    const engines = engineTable(app, "Last und Job-Rückstand je Engine")
    await expect(
      engines.getByRole("columnheader", { name: "Job-Rückstand, über Engines vergleichbar" }),
    ).toBeVisible()
    // Everything but the inventory column, which gives way below 768 px.
    const columns = (await columnsInView(engines)).filter((c) => c.label !== "Definitionen")
    expect(columns).toHaveLength(8)
    expect(columns.filter((c) => !c.shown || !c.inside)).toEqual([])
  })

  test("axe: the cross-engine overview passes WCAG 2.1 A/AA (light and dark)", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      const app = await openFleet(page, { theme })
      await settled(app)
      const results = await new AxeBuilder({ page })
        .include("#app")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
      const violations = results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
      }))
      expect(violations, theme).toEqual([])
    }
  })
})

/**
 * Inline, a view is a card in the chat (issue 396): under the host's height budget a table that
 * pages nothing (`ListTable` on its own) shows the head of its rows, says how many there are, and
 * offers the rest: fullscreen where the host offers it, else the next rows in place. The budget
 * is the overview's own height less a row's worth, so the fit has to cut the last table, the
 * matrix of the stub's three processes.
 */
test.describe("an inline card under the host's height budget (issue 396)", () => {
  const bodyRows = (region: Locator) => region.locator("tbody tr")

  /** The settled overview's height in an unbounded inline card. */
  async function fullHeight(page: Page): Promise<number> {
    const app = await openFleet(page, { maxHeight: 4000, displayModes: ["inline"] })
    await settled(app)
    await expect(bodyRows(matrix(app))).toHaveCount(3)
    return await app.locator("[data-inline-fit]").evaluate((box) => box.scrollHeight)
  }

  test("a table shows the head of its rows and opens fullscreen for the rest", async ({ page }) => {
    const height = await fullHeight(page)
    const app = await openFleet(page, {
      maxHeight: height - 20,
      displayModes: ["inline", "fullscreen"],
    })
    await settled(app)
    const region = matrix(app)
    await expect(region.getByText(/^[12] of 3 shown$/)).toBeVisible()

    await region.getByRole("button", { name: "Show all" }).click()

    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              () =>
                (window as unknown as { __hostLog: { displayModeRequests: string[] } }).__hostLog,
            )
          ).displayModeRequests,
      )
      .toEqual(["fullscreen"])
    await expect(bodyRows(region)).toHaveCount(3)
    await expect(region.getByText(/shown$/)).toHaveCount(0)
  })

  test("without fullscreen, the next rows show in place", async ({ page }) => {
    const height = await fullHeight(page)
    const app = await openFleet(page, { maxHeight: height - 20, displayModes: ["inline"] })
    await settled(app)
    const region = matrix(app)
    await expect(region.getByText(/^[12] of 3 shown$/)).toBeVisible()

    await region.getByRole("button", { name: "Show more" }).click()

    await expect(bodyRows(region)).toHaveCount(3)
    await expect(region.getByRole("button", { name: "Show more" })).toHaveCount(0)
  })
})
