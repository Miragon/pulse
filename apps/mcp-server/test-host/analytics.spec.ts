import AxeBuilder from "@axe-core/playwright"
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test"

/**
 * The analytics views in the BUILT bundle at the width a chat gives an inline
 * view (760 px), against the stub Prometheus (stub-prometheus.ts) and the stub
 * engine's `invoice` diagram for the names (U2, U13, U17 of #322): the
 * tables keep every column they promise in view without widening the
 * document, the activities and processes are named, the landscape's column
 * groups are headed and its comparable backlog and compare action stay in
 * reach, and the views pass axe in light and dark.
 */

const INLINE_WIDTH = 760

async function openAnalytics(
  page: Page,
  tool: string,
  theme: "light" | "dark" = "light",
  locale = "en-US",
  /** The host's height budget and display modes (absent: unbounded, inline only). */
  host: { maxHeight?: number; displayModes?: string[] } = {},
): Promise<FrameLocator> {
  const base = process.env.HOST_SIM_URL
  if (!base) throw new Error("HOST_SIM_URL is unset — run via `playwright test -c test-host`")
  const query = new URLSearchParams({
    tool,
    args: JSON.stringify({}),
    structuredContent: "keep",
    resultDelayMs: "0",
    theme,
    locale,
    width: String(INLINE_WIDTH),
  })
  if (host.maxHeight !== undefined) query.set("maxHeight", String(host.maxHeight))
  if (host.displayModes) query.set("displayModes", host.displayModes.join(","))
  await page.goto(`${base}/?${query.toString()}`)
  return page.frameLocator("#app")
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

test.describe("analytics at the inline width (760 px)", () => {
  test("the dashboard: every activity column in view, the activities named, no document scroll", async ({
    page,
  }) => {
    const app = await openAnalytics(page, "analytics_show_dashboard")
    const region = app.getByRole("region", {
      name: "Activities per process, sorted by total execution time",
    })
    await expect(region).toBeVisible({ timeout: 15_000 })
    const { scrollWidth, clientWidth } = await documentOverflow(app)
    expect(scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(clientWidth)

    // U2: total time (the sort key), executions, Avg and P95 all show and
    // lie inside the region — none scrolled out of sight.
    const columns = await columnsInView(region)
    expect(columns.map((c) => c.label).slice(0, 5)).toEqual([
      "Activity",
      "Total time",
      "Executions",
      "Avg",
      "P95",
    ])
    expect(columns.filter((c) => !c.shown || !c.inside)).toEqual([])
    await expect(region.getByRole("columnheader", { name: "Total time" })).toHaveAttribute(
      "aria-sort",
      "descending",
    )

    // U13: the name from the diagram first, the id quiet below it.
    const row = region.getByRole("row").filter({ hasText: "Approve Invoice" })
    await expect(row).toBeVisible()
    await expect(row).toContainText("approveInvoice")
    await expect(row).toContainText("User task")
    // A process without a served diagram keeps its id.
    await expect(region.getByText("Task_VerifyIdentity")).toBeVisible()

    // The breakdown is a table too, its figures inside the region.
    const breakdown = app.getByRole("region", {
      name: "Starts, completions, running instances and incidents per process",
    })
    await expect(breakdown.getByText("Invoice Receipt")).toBeVisible()
    expect((await columnsInView(breakdown)).filter((c) => !c.shown || !c.inside)).toEqual([])
  })

  test("the landscape: headed column groups, the comparable backlog and the compare action in reach", async ({
    page,
  }) => {
    const app = await openAnalytics(page, "analytics_show_engine_landscape")
    const engines = app.getByRole("region", { name: "Load and job backlog per engine" })
    await expect(engines).toBeVisible({ timeout: 15_000 })
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

    // The matrix: the shared process named, its comparison pinned inside the region.
    const matrix = app.getByRole("region", { name: "Process definitions by engine" })
    await expect(matrix.getByText("Invoice Receipt")).toBeVisible()
    const compare = matrix.getByRole("button", { name: /Compare “invoice” across its engines/ })
    await expect(compare).toBeVisible()
    const [button, box] = await Promise.all([compare.boundingBox(), matrix.boundingBox()])
    expect(button!.x + button!.width).toBeLessThanOrEqual(box!.x + box!.width + 1)
  })

  test("the dashboard in German: the activity columns still in view", async ({ page }) => {
    const app = await openAnalytics(page, "analytics_show_dashboard", "light", "de-DE")
    const region = app.getByRole("region", {
      name: "Aktivitäten je Prozess, sortiert nach gesamter Ausführungszeit",
    })
    await expect(region).toBeVisible({ timeout: 15_000 })
    const columns = await columnsInView(region)
    expect(columns.map((c) => c.label).slice(0, 5)).toEqual([
      "Aktivität",
      "Gesamtzeit",
      "Ausführungen",
      "Durchschn.",
      "P95",
    ])
    expect(columns.filter((c) => !c.shown || !c.inside)).toEqual([])
    await expect(region.getByText(/User-Task/).first()).toBeVisible()
  })

  test("the landscape in German: its longer heads still keep every column in view", async ({
    page,
  }) => {
    const app = await openAnalytics(page, "analytics_show_engine_landscape", "light", "de-DE")
    const engines = app.getByRole("region", { name: "Last und Job-Rückstand je Engine" })
    await expect(engines).toBeVisible({ timeout: 15_000 })
    await expect(
      engines.getByRole("columnheader", { name: "Job-Rückstand, über Engines vergleichbar" }),
    ).toBeVisible()
    // Everything but the inventory column, which gives way below 768 px.
    const columns = (await columnsInView(engines)).filter((c) => c.label !== "Definitionen")
    expect(columns).toHaveLength(8)
    expect(columns.filter((c) => !c.shown || !c.inside)).toEqual([])
  })

  test("axe: the analytics views pass WCAG 2.1 A/AA (light and dark)", async ({ page }) => {
    for (const [tool, region, theme] of [
      [
        "analytics_show_dashboard",
        "Activities per process, sorted by total execution time",
        "light",
      ],
      [
        "analytics_show_dashboard",
        "Activities per process, sorted by total execution time",
        "dark",
      ],
      ["analytics_show_engine_landscape", "Load and job backlog per engine", "light"],
      ["analytics_show_engine_landscape", "Load and job backlog per engine", "dark"],
    ] as const) {
      const app = await openAnalytics(page, tool, theme)
      await expect(app.getByRole("region", { name: region })).toBeVisible({ timeout: 15_000 })
      const results = await new AxeBuilder({ page })
        .include("#app")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
      const violations = results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
      }))
      expect(violations, `${tool} (${theme})`).toEqual([])
    }
  })
})

/**
 * Inline, a view is a card in the chat (#396): under the host's height budget
 * a table shows the head of its rows, says how many there are, and offers the
 * rest — fullscreen where the host offers it, else the next rows in place.
 * The stub's activity table has six rows; a 400 px budget leaves room for three.
 */
test.describe("an inline card under the host's height budget (#396)", () => {
  const activities = (app: FrameLocator) =>
    app.getByRole("region", { name: "Activities per process, sorted by total execution time" })
  const bodyRows = (region: Locator) => region.locator("tbody tr")

  test("a table shows the head of its rows and opens fullscreen for the rest", async ({ page }) => {
    const app = await openAnalytics(page, "analytics_show_dashboard", "light", "en-US", {
      maxHeight: 400,
      displayModes: ["inline", "fullscreen"],
    })
    const region = activities(app)
    await expect(region).toBeVisible({ timeout: 15_000 })
    await expect(bodyRows(region)).toHaveCount(3)
    await expect(region.getByText("3 of 6 shown")).toBeVisible()

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
    await expect(bodyRows(region)).toHaveCount(6)
    await expect(region.getByText("Task_VerifyIdentity")).toBeVisible()
    await expect(region.getByText(/shown$/)).toHaveCount(0)
  })

  test("without fullscreen, the next rows show in place", async ({ page }) => {
    const app = await openAnalytics(page, "analytics_show_dashboard", "light", "en-US", {
      maxHeight: 400,
      displayModes: ["inline"],
    })
    const region = activities(app)
    await expect(bodyRows(region)).toHaveCount(3, { timeout: 15_000 })

    await region.getByRole("button", { name: "Show more" }).click()

    await expect(bodyRows(region)).toHaveCount(6)
    await expect(region.getByRole("button", { name: "Show more" })).toHaveCount(0)
  })
})
