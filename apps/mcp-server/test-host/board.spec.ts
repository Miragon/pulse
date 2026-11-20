import AxeBuilder from "@axe-core/playwright"
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test"
import {
  APPROVALS_BOARD,
  BOARD_HOST_ENV,
  BROKEN_BOARD,
  BROKEN_ENGINE,
  HEALTHY_ENGINE,
  INVOICES_BOARD,
  ONE_ENGINE_BOARD_HOST_ENV,
  REALISTIC_ENGINE,
  REALISTIC_HOST_ENV,
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
 * re-run. The landing lists the boards beside the engines, a refused file with its problem count,
 * and shows with one engine too when the server has boards; `engine_open_cockpit` view `landing`
 * opens it as a start view of its own, an app route without a feed.
 */

const BOARD_ARGS = { view: "board", board: INVOICES_BOARD }
const TITLE = "Invoice operations"
/** The board view re-reads its feed after a stripped result: the host's one re-run of the tool. */
const OUTLAST_MS = 1_500

interface Scenario {
  /** The deployment's variable: the one with both engines and the board files by default. */
  hostEnv?: string
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
  const hostEnv = scenario.hostEnv ?? BOARD_HOST_ENV
  const base = process.env[hostEnv]
  if (!base) throw new Error(`${hostEnv} is unset. Run via \`playwright test -c test-host\``)
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

/** Relative luminance (0 = black, 1 = white) of an element's computed background. */
async function backgroundLuminance(locator: Locator): Promise<number> {
  return await locator.evaluate((el) => {
    // A canvas normalizes any CSS colour syntax (color(srgb …), oklch …) to sRGB bytes.
    const ctx = document.createElement("canvas").getContext("2d")!
    ctx.fillStyle = getComputedStyle(el).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  })
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
    const summary = tile(app, "Instances with incident")
    await expect(summary.getByText("0", { exact: true })).toBeVisible()
    // The engine that did not answer stays out of the note too: only those that answered.
    await expect(
      summary.getByText("No instance has an open incident on the engines that answered."),
    ).toBeVisible()
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

  test("a tile's row opens its engine's route on a click, the trail leads back; an engine's chip opens its overview", async ({
    page,
  }) => {
    const app = await openBoard(page)
    await drawn(app)
    // One row convention: the row itself opens what it names, no drill in it.
    const row = instances(app)
      .getByRole("row", { name: /^Instance / })
      .filter({
        hasText: "INV-2026-0042",
      })
    await expect(row.getByRole("button", { name: /^Open/ })).toHaveCount(0)
    await row.getByRole("cell").first().click()
    // The stub serves that instance whole: its view on the stub engine, in the cockpit's head.
    await expect(app.getByLabel("Selected engine")).toHaveValue(HEALTHY_ENGINE, {
      timeout: 15_000,
    })
    await expect(app.getByText("INV-2026-0042").first()).toBeVisible({ timeout: 15_000 })
    // The trail is the way the reader came (N10): the board, then the instance, no overview the
    // reader never saw between them.
    const trail = app.getByRole("navigation", { name: "Breadcrumb" })
    await expect(trail.locator('[aria-current="page"]')).toHaveText("INV-2026-0042")
    await expect(trail.getByRole("button")).toHaveCount(1)
    await trail.getByRole("button", { name: TITLE }).click()
    await expect(heading(app)).toBeVisible()

    // The chip opens its engine's overview under the board: inline its trail, the board then the
    // overview, takes the sections' place.
    const engines = app.getByRole("group", { name: "Engines of this board" })
    await engines.getByRole("button", { name: new RegExp(HEALTHY_ENGINE) }).click()
    await expect(heading(app, `${HEALTHY_ENGINE} · Overview`)).toBeVisible({ timeout: 15_000 })
    await expect(trail.locator('[aria-current="page"]')).toHaveText("Overview")
    await expect(trail.getByRole("button", { name: TITLE })).toBeVisible()
    await expect(app.getByRole("navigation", { name: "Cockpit sections" })).toHaveCount(0)
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
    // A row of a tile's table keeps the row height and opens itself: no column of drills.
    const row = instances(app).getByRole("row").filter({ hasText: "INV-2026-0042" })
    expect((await row.boundingBox())?.height).toBeLessThanOrEqual(29)
    await expect(instances(app).getByRole("columnheader", { name: "Actions" })).toHaveCount(0)
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

  test("dark: the tiles on the dark card, the diagram's canvas in the theme (D10, point 7)", async ({
    page,
  }) => {
    const app = await openBoard(page, { theme: "dark" })
    await drawn(app)
    const card = tile(app, "Invoice Receipt")
    const dark = await app.locator("html").evaluate((html) => html.classList.contains("dark"))
    expect(dark).toBe(true)
    expect(await backgroundLuminance(card)).toBeLessThan(0.3)
    // The paper the canvas is drawn on is the dark ground, as the editors' canvas, its flows and
    // labels light on it.
    const canvas = card.getByRole("img", { name: "BPMN process diagram" })
    const paper = canvas.locator("xpath=ancestor::*[@data-slot='bpmn-canvas'][1]")
    expect(await backgroundLuminance(paper)).toBeLessThan(0.15)
    const ink = await canvas
      .locator(".djs-connection .djs-visual > path")
      .first()
      .evaluate((el) => {
        const pen = document.createElement("canvas").getContext("2d")!
        pen.fillStyle = getComputedStyle(el).stroke
        pen.fillRect(0, 0, 1, 1)
        const [r, g, b] = pen.getImageData(0, 0, 1, 1).data
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      })
    expect(ink).toBeGreaterThan(0.95)
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

test.describe("the landing lists the boards", () => {
  const landing = (app: FrameLocator) =>
    app.getByRole("heading", { level: 1, name: "Operations Cockpit" })
  const boards = (app: FrameLocator, name = "Boards") => app.getByRole("region", { name })

  test("beside the engines: a board by its title and engines, a refused file by its problem count; a board opens and its trail leads back", async ({
    page,
  }) => {
    // No engine resolves between two without a default: the cockpit opens on the landing.
    const app = await openBoard(page, { args: {} })
    await expect(landing(app)).toBeVisible({ timeout: 15_000 })
    const engines = app.getByRole("region", { name: "Engines" })
    await expect(engines.getByRole("button")).toHaveCount(2)
    const board = boards(app).getByRole("button", {
      name: new RegExp(`^${TITLE}\\s*,\\s*2 engines: ${HEALTHY_ENGINE}, ${BROKEN_ENGINE}$`),
    })
    await expect(board).toBeVisible()
    const refused = boards(app).locator("[data-status=refused]")
    await expect(refused).toContainText(BROKEN_BOARD)
    await expect(refused).toContainText(/file refused: 1 problem$/)
    await expect(
      boards(app).getByText(/problems are in the log the server writes at startup/),
    ).toBeVisible()
    // A row keeps the row height of the chooser's engines.
    expect((await board.boundingBox())?.height).toBeLessThanOrEqual(29)

    await board.click()
    await expect(heading(app)).toBeVisible({ timeout: 15_000 })
    const trail = app.getByRole("navigation", { name: "Breadcrumb" })
    await trail.getByRole("button", { name: "All engines" }).click()
    await expect(landing(app)).toBeVisible()
  })

  test("in German, and at 320 px without sideways scroll", async ({ page }) => {
    const app = await openBoard(page, { args: {}, locale: "de-DE", width: 320 })
    await expect(landing(app)).toBeVisible({ timeout: 15_000 })
    await expect(boards(app).getByRole("heading", { level: 2, name: "Boards" })).toBeVisible()
    await expect(boards(app).locator("[data-status=refused]")).toContainText(
      "Datei abgelehnt: 1 Problem",
    )
    const board = boards(app).getByRole("button", {
      name: new RegExp(`^${TITLE}\\s*,\\s*2 Engines:`),
    })
    await expect(board).toBeVisible()
    // The engines give way first: the title that names the board stays whole.
    const title = board.getByText(TITLE, { exact: true })
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const { scrollWidth, clientWidth } = await documentOverflow(app)
    expect(scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(clientWidth)
  })

  for (const [locale, engines, refused] of [
    ["en-US", "2 engines: stub, down", "file refused: 1 problem"],
    ["de-DE", "2 Engines: stub, down", "Datei abgelehnt: 1 Problem"],
  ] as const) {
    test(`at 320 px on a touch screen (${locale}) a board row names its board whole, what it says under it`, async ({
      browser,
    }) => {
      // 40 px rows and their wider padding: the name keeps every letter, the rest takes a line.
      const context = await browser.newContext({ hasTouch: true })
      try {
        const page = await context.newPage()
        const app = await openBoard(page, { args: {}, locale, width: 320 })
        await expect(landing(app)).toBeVisible({ timeout: 15_000 })
        for (const text of [TITLE, engines, BROKEN_BOARD, refused]) {
          const words = boards(app).getByText(text, { exact: true })
          await expect(words).toBeVisible()
          expect(await words.evaluate((el) => el.scrollWidth <= el.clientWidth), text).toBe(true)
        }
        const { scrollWidth, clientWidth } = await documentOverflow(app)
        expect(scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(clientWidth)
      } finally {
        await context.close()
      }
    })
  }

  for (const [locale, fleet] of [
    ["de-DE", "Engine-übergreifende Übersicht"],
    ["en-US", "Cross-engine overview"],
  ] as const) {
    test(`at 320 px (${locale}) the hero's cross-engine action wraps under it, inside the gutter`, async ({
      page,
    }) => {
      const app = await openBoard(page, { args: {}, locale, width: 320 })
      await expect(landing(app)).toBeVisible({ timeout: 15_000 })
      const action = app.getByRole("button", { name: fleet })
      await expect(action).toBeVisible()
      // The frame hides what overflows it: the action's box, never the document, shows where it
      // ends. It ends where the landing's lists end, its label whole.
      const [box, list] = await Promise.all([action.boundingBox(), boards(app).boundingBox()])
      expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(
        (list?.x ?? 0) + (list?.width ?? 0) + 0.5,
      )
      expect(await action.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    })
  }

  test("one engine with a board: the trail's first crumb leads to the landing, which opens the board", async ({
    page,
  }) => {
    // The sole engine resolves, so the cockpit opens on its overview, as without boards.
    const app = await openBoard(page, {
      hostEnv: ONE_ENGINE_BOARD_HOST_ENV,
      args: {},
      displayModes: ["inline", "fullscreen"],
    })
    const sections = app.getByRole("navigation", { name: "Cockpit sections" })
    await expect(sections.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
      { timeout: 15_000 },
    )
    await app.getByRole("button", { name: "Fullscreen" }).click()
    const trail = app.getByRole("navigation", { name: "Breadcrumb" })
    await trail.getByRole("button", { name: "All engines" }).click()
    await expect(landing(app)).toBeVisible()
    await expect(app.getByRole("region", { name: "Engines" }).getByRole("button")).toHaveCount(1)
    await boards(app)
      .getByRole("button", { name: new RegExp(`^Approvals\\s*,\\s*1 engine: ${HEALTHY_ENGINE}$`) })
      .click()
    await expect(heading(app, "Approvals")).toBeVisible({ timeout: 15_000 })
    await expect(tile(app, "Waiting for approval").locator("[data-part=counter-value]")).toHaveText(
      "2",
    )
    // Opened in the view, the board reads its app-only feed by its id.
    const feedCalls = (await hostLog(page)).toolCalls.filter((c) => c.name === "engine_board_data")
    expect(feedCalls).toEqual([
      { name: "engine_board_data", arguments: { board: APPROVALS_BOARD } },
    ])
    // The board's trail leads back to the landing: it shows with one engine beside a board.
    await expect(trail.getByRole("button", { name: "All engines" })).toBeVisible()
  })

  test("opens as a start view: one engine beside a board, the landing at once, its ids as facts", async ({
    page,
  }) => {
    const app = await openBoard(page, {
      hostEnv: ONE_ENGINE_BOARD_HOST_ENV,
      args: { view: "landing" },
    })
    await expect(landing(app)).toBeVisible({ timeout: 15_000 })
    await expect(app.getByRole("region", { name: "Engines" }).getByRole("button")).toHaveCount(1)
    const approvals = boards(app).getByRole("button", {
      name: new RegExp(`^Approvals\\s*,\\s*1 engine: ${HEALTHY_ENGINE}$`),
    })
    await expect(approvals).toBeVisible()
    // No engine's head and no trail: the landing is where the cockpit starts.
    await expect(app.getByRole("navigation", { name: "Cockpit sections" })).toHaveCount(0)
    await expect(app.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0)
    const log = await hostLog(page)
    expect(JSON.parse(log.originalResult?.content?.[0]?.text ?? "{}")).toEqual({
      view: "landing",
      engines: [HEALTHY_ENGINE],
      boards: [APPROVALS_BOARD],
    })
    // The landing has no feed of its own: a board's feed runs once one opens.
    expect(log.toolCalls.filter((c) => c.name === "engine_board_data")).toEqual([])
    await approvals.click()
    await expect(heading(app, "Approvals")).toBeVisible({ timeout: 15_000 })
    const trail = app.getByRole("navigation", { name: "Breadcrumb" })
    await trail.getByRole("button", { name: "All engines" }).click()
    await expect(landing(app)).toBeVisible()
  })

  test("opens as a start view on one engine without boards: that engine's overview", async ({
    page,
  }) => {
    const app = await openBoard(page, { hostEnv: REALISTIC_HOST_ENV, args: { view: "landing" } })
    const sections = app.getByRole("navigation", { name: "Cockpit sections" })
    await expect(sections.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
      { timeout: 15_000 },
    )
    await expect(landing(app)).toHaveCount(0)
    await expect(app.locator("[data-slot=engine-context]")).toHaveText(REALISTIC_ENGINE)
    expect(JSON.parse((await hostLog(page)).originalResult?.content?.[0]?.text ?? "{}")).toEqual({
      view: "landing",
      engines: [REALISTIC_ENGINE],
    })
  })

  test("axe: the landing with its boards (WCAG 2.2 A/AA)", async ({ page }) => {
    const app = await openBoard(page, { args: {} })
    await expect(boards(app).locator("[data-status=refused]")).toBeVisible({ timeout: 15_000 })
    await expectAxeClean(page, "landing with boards")
  })
})
