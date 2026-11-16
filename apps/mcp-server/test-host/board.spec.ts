import AxeBuilder from "@axe-core/playwright"
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test"
import {
  BOARD_HOST_ENV,
  BROKEN_BOARD,
  BROKEN_ENGINE,
  HEALTHY_ENGINE,
  INVOICES_BOARD,
} from "./engines.js"

/**
 * A board of the server's board files (`fixtures/boards`, ENGINE_BOARDS_DIR) as the cockpit's
 * app-level route in the BUILT bundle: `engine_open_cockpit` view `board` opens it without an
 * engine, the tiles of @miragon/pulse-blocks render the board feed's numbers of the stub engine
 * with the cockpit's slots (its table with a drill per row, its id, its BPMN canvas), the engine
 * that answers every request with a 503 shows failed in its place, and a widget the file breaks
 * shows refused. A tile opens the engine's own route, the trail leads back to the board, and the
 * board keeps the house rules: within the host's budget inline, every row in fullscreen, no
 * sideways scroll at 400 and 320 px, forced colours and dark, axe, and the stripped-result
 * re-run.
 */

const BOARD_ARGS = { view: "board", board: INVOICES_BOARD }
const TITLE = "Invoice operations"
/** The board view re-reads its feed after a stripped result: the host's one re-run of the tool. */
const OUTLAST_MS = 1_500

interface Scenario {
  args?: Record<string, unknown>
  structuredContent?: "keep" | "strip"
  theme?: "light" | "dark"
  locale?: string
  maxHeight?: number
  displayModes?: string[]
  width?: number
}

interface HostLog {
  originalResult: { isError?: boolean; content?: { type: string; text?: string }[] } | null
  toolCalls: { name: string; arguments: Record<string, unknown> }[]
  displayModeRequests: string[]
  sizeChanges: { width?: number; height?: number; at: number }[]
}

async function openBoard(page: Page, scenario: Scenario = {}): Promise<FrameLocator> {
  const base = process.env[BOARD_HOST_ENV]
  if (!base) throw new Error(`${BOARD_HOST_ENV} is unset. Run via \`playwright test -c test-host\``)
  const query = new URLSearchParams({
    tool: "engine_open_cockpit",
    args: JSON.stringify(scenario.args ?? BOARD_ARGS),
    structuredContent: scenario.structuredContent ?? "keep",
    resultDelayMs: "0",
    theme: scenario.theme ?? "light",
    locale: scenario.locale ?? "en-US",
    width: String(scenario.width ?? 960),
    maxHeight: String(scenario.maxHeight ?? 2000),
  })
  if (scenario.displayModes) query.set("displayModes", scenario.displayModes.join(","))
  await page.goto(`${base}/?${query.toString()}`)
  return page.frameLocator("#app")
}

async function hostLog(page: Page): Promise<HostLog> {
  return await page.evaluate(() => (window as unknown as { __hostLog: HostLog }).__hostLog)
}

const heading = (app: FrameLocator, name = TITLE) => app.getByRole("heading", { level: 1, name })
const tile = (app: FrameLocator, name: string) => app.getByRole("region", { name })
const instances = (app: FrameLocator) => tile(app, "Running instances of invoice")

/** The board has drawn: its title, and its diagram on the canvas. */
async function drawn(app: FrameLocator): Promise<void> {
  await expect(heading(app)).toBeVisible({ timeout: 15_000 })
  await expect(app.locator(".djs-container svg").first()).toBeVisible({ timeout: 15_000 })
}

async function documentOverflow(app: FrameLocator) {
  return await app.locator("html").evaluate((html) => ({
    scrollWidth: html.scrollWidth,
    clientWidth: html.clientWidth,
  }))
}

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .include("#app")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze()
  const violations = results.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
  }))
  expect(violations, label).toEqual([])
}

/** The colour a system colour keyword computes to in the view's frame. */
async function systemColour(locator: Locator, name: string): Promise<string> {
  return await locator.evaluate((_el, keyword) => {
    const probe = document.createElement("i")
    probe.style.color = keyword
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, name)
}

test.describe("a board, the cockpit's app-level route", () => {
  test("opens by tool without an engine: every tile with the stub's numbers, a failed engine in its place", async ({
    page,
  }) => {
    const app = await openBoard(page)
    await drawn(app)
    // The model's facts: the board's ids and numbers, no engine of the cockpit.
    const facts = JSON.parse((await hostLog(page)).originalResult?.content?.[0]?.text ?? "{}") as {
      view?: string
      engine?: unknown
      tiles?: Array<{ kind: string; count?: number }>
    }
    expect(facts).toMatchObject({ view: "board", board: INVOICES_BOARD, title: TITLE })
    expect(facts).not.toHaveProperty("engine")
    expect(facts.tiles?.map((t) => t.kind)).toEqual([
      "counter",
      "incidentSummary",
      "instanceList",
      "incidentList",
      "processDiagram",
      "refused",
    ])

    await expect(app.getByText(`2 engines: ${HEALTHY_ENGINE}, ${BROKEN_ENGINE}`)).toBeVisible()
    await expect(app.getByText(/^As of /)).toBeVisible()
    const counter = tile(app, "Waiting for approval")
    await expect(counter.locator("[data-part=counter-value]")).toHaveText("2")
    await expect(counter.getByText("from 1 of 2 engines")).toBeVisible()
    await expect(tile(app, "Instances with incident").getByText("0", { exact: true })).toBeVisible()
    for (const key of ["INV-2026-0042", "INV-2026-0043"]) {
      await expect(instances(app).getByRole("row").filter({ hasText: key })).toBeVisible()
    }
    await expect(instances(app).getByText(`${HEALTHY_ENGINE}: showing 2 of 2`)).toBeVisible()
    await expect(tile(app, "Open incidents").getByText(`${HEALTHY_ENGINE}: 0 open`)).toBeVisible()
    const diagram = tile(app, "Invoice Receipt")
    await expect(diagram.getByText(`${HEALTHY_ENGINE} · v3, the latest version`)).toBeVisible()
    await expect(diagram.locator(".djs-overlays").getByText("2", { exact: true })).toBeVisible()
    await expect(tile(app, 'Widget "chart"').getByText(/must be one of counter/)).toBeVisible()
    // The engine that does not answer, in describeError's words, its own text under Details.
    await expect(app.getByText(`Engine ${BROKEN_ENGINE} is unreachable (HTTP 503)`)).toBeVisible()
    // A board has no other engine to pick: it reads the engines its file names.
    await expect(
      app.getByText(
        "Check that the engine is running. Until then, the tiles show what the other engines answered.",
      ),
    ).toBeVisible()
    const engines = app.getByRole("group", { name: "Engines of this board" })
    await expect(engines.getByRole("button", { name: new RegExp(HEALTHY_ENGINE) })).toContainText(
      "CIB seven 2.2.0 · 3 running · 0 with incident",
    )
  })

  test("in German: the chrome, the tiles and the widget the file breaks", async ({ page }) => {
    const app = await openBoard(page, { locale: "de-DE" })
    await drawn(app)
    await expect(app.getByRole("button", { name: "Aktualisieren" })).toBeVisible()
    await expect(app.getByText(/^Stand /)).toBeVisible()
    const refused = tile(app, "Widget „chart“")
    await expect(
      refused.getByText("Pulse liest für dieses Widget nichts, bis du es korrigierst."),
    ).toBeVisible()
    await expect(refused.getByText(/muss eins von counter/)).toBeVisible()
    await expect(
      app.getByText(`Die Engine ${BROKEN_ENGINE} ist nicht erreichbar (HTTP 503)`),
    ).toBeVisible()
    await expect(
      app.getByText(
        "Prüf, ob die Engine läuft. Bis dahin zeigen die Kacheln, was die anderen Engines geantwortet haben.",
      ),
    ).toBeVisible()
    await expect(tile(app, "Laufende Instanzen von invoice")).toBeVisible()
  })

  test("a tile opens its engine's route, the trail leads back; an engine's chip opens its overview", async ({
    page,
  }) => {
    const app = await openBoard(page)
    await drawn(app)
    const row = instances(app).getByRole("row").filter({ hasText: "INV-2026-0042" })
    await row.getByRole("button", { name: /^Open instance/ }).click()
    // The stub serves that instance whole: its view on the stub engine, in the cockpit's head.
    await expect(app.getByLabel("Selected engine")).toHaveValue(HEALTHY_ENGINE, {
      timeout: 15_000,
    })
    await expect(app.getByText("INV-2026-0042").first()).toBeVisible({ timeout: 15_000 })
    const trail = app.getByRole("navigation", { name: "Breadcrumb" })
    await trail.getByRole("button", { name: TITLE }).click()
    await expect(heading(app)).toBeVisible()

    const engines = app.getByRole("group", { name: "Engines of this board" })
    await engines.getByRole("button", { name: new RegExp(HEALTHY_ENGINE) }).click()
    await expect(
      app.getByRole("navigation", { name: "Cockpit sections" }).getByRole("button", {
        name: "Overview",
      }),
    ).toHaveAttribute("aria-current", "page", { timeout: 15_000 })
  })

  test("a board file that gives no board is a tool error that names its problem", async ({
    page,
  }) => {
    const app = await openBoard(page, { args: { view: "board", board: BROKEN_BOARD } })
    await expect(app.getByText(/Board "broken" cannot be shown/).first()).toBeAttached({
      timeout: 15_000,
    })
    expect((await hostLog(page)).originalResult?.isError).toBe(true)
  })

  test("the tiles carry the classes of the blocks' build: Tailwind scans the package", async ({
    page,
  }) => {
    const app = await openBoard(page)
    await drawn(app)
    const card = tile(app, "Waiting for approval")
    const style = await card.evaluate((el) => {
      const own = getComputedStyle(el)
      const row = getComputedStyle(el.parentElement!)
      return {
        border: `${own.borderTopStyle} ${own.borderTopWidth}`,
        radius: own.borderTopLeftRadius,
        rowDisplay: row.display,
        rowFlow: row.gridAutoFlow,
        rowColumns: row.gridAutoColumns,
      }
    })
    // The grid's arbitrary column track exists only in the blocks' own classes.
    expect(style).toEqual({
      border: "solid 1px",
      radius: expect.not.stringMatching(/^0px$/) as unknown,
      rowDisplay: "grid",
      rowFlow: "column",
      rowColumns: expect.stringMatching(/^minmax\(0px, 1fr\)/) as unknown,
    })
    // A row of a tile's table keeps the row height, its drill at the row actions' 24 px.
    const row = instances(app).getByRole("row").filter({ hasText: "INV-2026-0042" })
    expect((await row.boundingBox())?.height).toBeLessThanOrEqual(29)
    const drill = row.getByRole("button", { name: /^Open instance/ })
    expect((await drill.boundingBox())?.height).toBe(24)
    // The notes under a tile's rows, an empty table's too, sit as pulse-ui's DataTable sets a
    // footer in the webview: centred in the tile and clear of its bottom.
    for (const name of ["Running instances of invoice", "Open incidents"]) {
      const card = tile(app, name)
      const notes = await card.getByRole("list", { name: "Per engine" }).boundingBox()
      const box = await card.boundingBox()
      if (!notes || !box) throw new Error(`${name}: no box for its notes`)
      const offCentre = notes.x + notes.width / 2 - (box.x + box.width / 2)
      expect(Math.abs(offCentre), `${name}: its notes are centred`).toBeLessThanOrEqual(2)
      expect(
        box.y + box.height - (notes.y + notes.height),
        `${name}: clear of the bottom`,
      ).toBeGreaterThanOrEqual(8)
    }
  })

  test("inline it stays within the host's budget; fullscreen shows every row", async ({ page }) => {
    const budget = 600
    const app = await openBoard(page, {
      width: 760,
      maxHeight: budget,
      displayModes: ["inline", "fullscreen"],
    })
    await expect(heading(app)).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => (await hostLog(page)).sizeChanges.at(-1)?.height ?? Number.NaN)
      .toBeLessThanOrEqual(budget)
    await app.getByRole("button", { name: "Fullscreen" }).click()
    await expect.poll(async () => (await hostLog(page)).displayModeRequests).toEqual(["fullscreen"])
    await expect(instances(app).locator("tbody > tr")).toHaveCount(2)
  })

  for (const width of [400, 320]) {
    test(`at ${width} px the document never scrolls sideways`, async ({ page }) => {
      const app = await openBoard(page, { width })
      await drawn(app)
      const { scrollWidth, clientWidth } = await documentOverflow(app)
      expect(scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(clientWidth)
      // The tiles stack one under the other in a narrow card.
      const flow = await tile(app, "Waiting for approval").evaluate(
        (el) => getComputedStyle(el.parentElement!).gridAutoFlow,
      )
      expect(flow).toBe("row")
    })
  }

  test("forced colours: a tile keeps its edge and a failed engine its icon", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" })
    const app = await openBoard(page)
    await drawn(app)
    const card = tile(app, "Waiting for approval")
    const canvasText = await systemColour(card, "CanvasText")
    const edge = await card.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        style: style.borderTopStyle,
        width: style.borderTopWidth,
        colour: style.borderTopColor,
      }
    })
    expect(edge).toEqual({ style: "solid", width: "1px", colour: canvasText })
    const icon = app
      .getByText(`Engine ${BROKEN_ENGINE} is unreachable (HTTP 503)`)
      .locator("xpath=ancestor::*[@data-slot='status-strip'][1]")
      .locator("svg")
      .first()
    await expect(icon).toBeVisible()
  })

  test("dark: the tiles on the dark card, the diagram's paper stays light", async ({ page }) => {
    const app = await openBoard(page, { theme: "dark" })
    await drawn(app)
    const seen = await tile(app, "Invoice Receipt").evaluate((el) => {
      const luminance = (colour: string) => {
        const [r, g, b] = (colour.match(/\d+(\.\d+)?/g) ?? []).map(Number)
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      }
      const paper = el.querySelector("[data-theme-mode=light]")
      return {
        dark: document.documentElement.classList.contains("dark"),
        card: luminance(getComputedStyle(el).backgroundColor),
        paper: paper?.getAttribute("data-theme-mode"),
      }
    })
    expect(seen.dark).toBe(true)
    expect(seen.card).toBeLessThan(0.3)
    expect(seen.paper).toBe("light")
  })

  test("a stripping host: one re-run of the view's own tool, with the invocation's arguments", async ({
    page,
  }) => {
    const app = await openBoard(page, { structuredContent: "strip" })
    await drawn(app)
    await page.waitForTimeout(OUTLAST_MS)
    const reRuns = (await hostLog(page)).toolCalls.filter((c) => c.name === "engine_open_cockpit")
    expect(reRuns).toEqual([{ name: "engine_open_cockpit", arguments: BOARD_ARGS }])
  })

  for (const theme of ["light", "dark"] as const) {
    test(`axe: the board, its diagram and its strips (WCAG 2.2 A/AA, ${theme})`, async ({
      page,
    }) => {
      await openBoard(page, { theme }).then(drawn)
      await expectAxeClean(page, `board (${theme})`)
    })
  }
})
