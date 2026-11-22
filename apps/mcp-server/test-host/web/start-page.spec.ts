import { expect, test, type Locator, type Page } from "@playwright/test"
import {
  BROKEN_ENGINE,
  C8_ENGINE,
  C8_UNBOARDED_ENGINE,
  HEALTHY_ENGINE,
  INVOICES_BOARD,
  ORDERS_BOARD,
  REFUSED_C8_ENGINE,
} from "../engines.js"
import {
  collectErrors,
  expectNoAxeFinding,
  navEntry,
  recordCalls,
  rendered,
  signIn,
  type Deployment,
} from "./web-sim.js"

/**
 * The web app's start page (D10, steps 20 and 21 of the plan) at `/app`: every engine of the server
 * side by side, a row each with its live state (a Camunda 7 engine's verdict, read from the server's
 * verdict feed, `engine_screen_verdict_data`; none for a Camunda 8 cluster, for which the server
 * decides none) and the figures its engine screen shows (one read per engine of the engine
 * screen's feed, `engine_screen_processes_data`, all at once, summed in the browser with the
 * screens' `FleetSums`: counts only, never a rate), what runs where, and the server's boards. A
 * Camunda 8 cluster has its numbers (the `camunda8` deployment over test:host's loopback cluster),
 * an engine that answers 503 keeps its row with its failure in a strip (the `main` deployment), a
 * refused profile is read nothing of and says the server's refusal in the server's words (the
 * `refusedC8` deployment). A row opens its engine's screen, which shows the same read, a board its
 * page. It replaces the cockpit's landing and its cross-engine overview on the page: no view is
 * called. German at 390 and 320 px without sideways scroll, axe finds nothing.
 */

const FEED = "engine_screen_processes_data"
const VERDICT_FEED = "engine_screen_verdict_data"

interface ScreenRow {
  readonly running: number
  readonly withIncident: number
  readonly incidents: number
  readonly incidentsAtLeast?: true
}

interface EngineScreenAnswer {
  readonly engine: string
  readonly info: { readonly product: string; readonly version: string } | null
  readonly processes: readonly ScreenRow[]
  readonly totals: { processes: number; running: number; withIncident: number }
}

/** Every answer of the engine screen's feed the page receives, by engine. */
function feedAnswers(page: Page): Map<string, EngineScreenAnswer> {
  const answers = new Map<string, EngineScreenAnswer>()
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname !== "/app/api/call") return
    if ((response.request().postDataJSON() as { name?: string }).name !== FEED) return
    const { result } = (await response.json()) as {
      result?: {
        isError?: boolean
        content?: Array<{ text: string }>
        structuredContent?: EngineScreenAnswer
      }
    }
    if (result === undefined || result.isError === true) return
    const text = result.content?.[0]?.text
    const screen =
      result.structuredContent ??
      (text === undefined ? undefined : (JSON.parse(text) as EngineScreenAnswer))
    if (screen !== undefined) answers.set(screen.engine, screen)
  })
  return answers
}

/** The answer of `engine`'s engine screen, once the page received it. */
async function answerOf(
  answers: Map<string, EngineScreenAnswer>,
  engine: string,
): Promise<EngineScreenAnswer> {
  await expect.poll(() => answers.has(engine), { message: engine, timeout: 15_000 }).toBe(true)
  return answers.get(engine)!
}

const engines = (page: Page) => page.getByRole("table", { name: "Engines" })
const engineRow = (page: Page, engine: string) =>
  engines(page).getByRole("row", { name: `Engine ${engine}` })

/** Whether the page scrolls sideways: no view may widen it (WCAG 1.4.10). */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

/** What a screen reader alone hears beside a figure: its alarm, why a dash stands. */
const SPOKEN = /Has open incidents|The engine didn't say what it is/g

/** The figures a row of the engine table shows, in its columns' order after the engine's state. */
async function figuresOf(row: Locator): Promise<string[]> {
  const cells = await row.locator("td").allTextContents()
  return cells.slice(2).map((cell) => cell.replace(SPOKEN, "").trim())
}

/** The state a row of the engine table shows: the verdict's word, or why it shows none. */
const stateOf = (row: Locator) => row.locator("td").nth(1)

/** The figures the start page shows for an engine screen: what its row must say. */
function expectedFigures(screen: EngineScreenAnswer): string[] {
  const incidents = screen.processes.reduce((sum, row) => sum + row.incidents, 0)
  const atLeast = screen.processes.some((row) => row.incidentsAtLeast === true)
  const count = (value: number) => value.toLocaleString("en-US")
  return [
    screen.info === null ? "—" : `${screen.info.product} ${screen.info.version}`,
    count(screen.totals.processes),
    count(screen.totals.running),
    count(screen.totals.withIncident),
    atLeast ? `≥\u00a0${count(incidents)}` : count(incidents),
  ]
}

/** The start page has read every engine its server reads: each row of `read` has its figures. */
async function readAll(page: Page, read: readonly string[]): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "All engines" })).toBeVisible({
    timeout: 15_000,
  })
  for (const engine of read) {
    await expect(engineRow(page, engine).locator("td").nth(5)).toHaveText(/^\d/, {
      timeout: 15_000,
    })
  }
}

test.describe("the start page", () => {
  test("shows every engine with its engine screen's figures, the down one keeping its row and its failure", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    const answers = feedAnswers(page)
    await signIn(page, "/app")
    await readAll(page, [HEALTHY_ENGINE])
    await expect(page).toHaveTitle("All engines · Pulse")
    await expect(navEntry(page, "Start")).toHaveAttribute("aria-current", "page")
    const bar = page.locator("[data-slot=view-bar]")
    await expect(bar.getByText("2 engines")).toBeVisible()
    await expect(bar.getByRole("button", { name: "Refresh" })).toBeVisible()
    await expect(page.locator("[data-slot=freshness-stamp]")).toContainText("As of")
    const stub = await answerOf(answers, HEALTHY_ENGINE)
    expect(await figuresOf(engineRow(page, HEALTHY_ENGINE))).toEqual(expectedFigures(stub))
    // The server's verdict on the stub engine, which holds no open root incident: Stable.
    await expect(page.getByRole("columnheader", { name: "State" })).toBeVisible()
    await expect(stateOf(engineRow(page, HEALTHY_ENGINE))).toHaveText("Stable", { timeout: 15_000 })
    // The engine that answers 503 keeps its row, a dash per figure, and its failure in a strip.
    await expect(engineRow(page, BROKEN_ENGINE)).toContainText("not read")
    await expect(stateOf(engineRow(page, BROKEN_ENGINE))).toHaveText("—not read")
    const strip = page.locator("[data-slot=status-strip]", {
      hasText: `${BROKEN_ENGINE} couldn't be read`,
    })
    await expect(strip).toContainText(`Engine ${BROKEN_ENGINE} is unreachable (HTTP 503)`)
    // What runs where on the engine read, the down one named; the boards and the refused file.
    await expect(page.getByRole("heading", { level: 2, name: "What runs where" })).toBeVisible()
    await expect(page.getByRole("table", { name: "Processes by engine" })).toBeVisible()
    await expect(
      page.getByText("Engines run different processes, so this view shows counts, never rates."),
    ).toBeVisible()
    await expect(page.getByText(`Not read, so not in this view: ${BROKEN_ENGINE}`)).toBeVisible()
    await expect(
      page
        .getByRole("table", { name: "Boards" })
        .getByRole("row", { name: "Board Invoice operations" }),
    ).toHaveAttribute("data-href", `/app/boards/${INVOICES_BOARD}`)
    // One read per engine, no view, nothing written, nothing handed to a chat.
    expect(calls.map((call) => call.name)).not.toContain("engine_open_cockpit")
    expect(
      calls
        .filter((call) => call.name === FEED)
        .map((call) => call.arguments?.engine)
        .sort(),
    ).toEqual([BROKEN_ENGINE, HEALTHY_ENGINE].sort())
    // Each Camunda 7 engine's verdict, read once beside its engine screen.
    expect(
      calls
        .filter((call) => call.name === VERDICT_FEED)
        .map((call) => call.arguments?.engine)
        .sort(),
    ).toEqual([BROKEN_ENGINE, HEALTHY_ENGINE].sort())
    await expect(page.getByText(/\bchat\b/i)).toHaveCount(0)
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)
  })

  test("a row opens its engine's screen, which shows the same read, and a board row its page", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, "/app")
    await readAll(page, [HEALTHY_ENGINE])
    const figures = await figuresOf(engineRow(page, HEALTHY_ENGINE))
    await engineRow(page, HEALTHY_ENGINE).click()
    await expect(page.getByRole("heading", { level: 1, name: HEALTHY_ENGINE })).toBeFocused({
      timeout: 15_000,
    })
    expect(new URL(page.url()).pathname).toBe(`/app/engines/${HEALTHY_ENGINE}`)
    const [, processes, running, withIncident] = figures
    await expect(
      page.getByText(
        `${processes} processes · ${running} running · ${withIncident} with incident · all versions`,
      ),
    ).toBeVisible({ timeout: 15_000 })
    // The engine screen shows the start page's read: no second call of its feed.
    expect(
      calls.filter((call) => call.name === FEED && call.arguments?.engine === HEALTHY_ENGINE),
    ).toHaveLength(1)
    await page.goBack()
    await readAll(page, [HEALTHY_ENGINE])
    await page
      .getByRole("table", { name: "Boards" })
      .getByRole("row", { name: "Board Invoice operations" })
      .click()
    await expect(page.getByRole("heading", { level: 1, name: "Invoice operations" })).toBeVisible({
      timeout: 15_000,
    })
    expect(new URL(page.url()).pathname).toBe(`/app/boards/${INVOICES_BOARD}`)
  })

  test("a Camunda 8 cluster has its numbers, the same as its engine screen's, no state, and a column in what runs where", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    const answers = feedAnswers(page)
    await signIn(page, "/app", { deployment: "camunda8" })
    await readAll(page, [HEALTHY_ENGINE, C8_ENGINE, C8_UNBOARDED_ENGINE])
    await expect(page.locator("[data-slot=view-bar]").getByText("3 engines")).toBeVisible()
    for (const engine of [C8_ENGINE, C8_UNBOARDED_ENGINE]) {
      const screen = await answerOf(answers, engine)
      expect(await figuresOf(engineRow(page, engine)), engine).toEqual(expectedFigures(screen))
      await expect(engineRow(page, engine)).toContainText("Camunda")
      // No verdict, honestly: the server decides none for Camunda 8, and the page reads none.
      await expect(stateOf(engineRow(page, engine))).toHaveText(
        "—Pulse judges no state for this engine",
      )
    }
    await expect(stateOf(engineRow(page, HEALTHY_ENGINE))).toHaveText("Stable", { timeout: 15_000 })
    expect(
      calls.filter((call) => call.name === VERDICT_FEED).map((call) => call.arguments?.engine),
    ).toEqual([HEALTHY_ENGINE])
    // Its incident counted at its process, as its engine screen's column Incidents counts it.
    expect(
      (await answerOf(answers, C8_ENGINE)).processes.reduce((sum, row) => sum + row.incidents, 0),
    ).toBeGreaterThan(0)
    const matrix = page.getByRole("table", { name: "Processes by engine" })
    await expect(matrix.getByRole("columnheader")).toHaveText([
      "Process",
      HEALTHY_ENGINE,
      C8_ENGINE,
      C8_UNBOARDED_ENGINE,
      "With incident",
    ])
    await expect(page.getByRole("table", { name: "Boards" }).locator("tbody tr")).toHaveCount(1)
    await expect(
      page
        .getByRole("table", { name: "Boards" })
        .getByRole("row", { name: "Board Order operations" }),
    ).toHaveAttribute("data-href", `/app/boards/${ORDERS_BOARD}`)
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)
    await engineRow(page, C8_ENGINE).click()
    await expect(page.getByRole("heading", { level: 1, name: C8_ENGINE })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole("table", { name: "Processes" })).toBeVisible({ timeout: 15_000 })
  })

  test("a refused profile keeps its row, read nothing of, and says the server's refusal in its words", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, "/app", { deployment: "refusedC8" })
    await readAll(page, [HEALTHY_ENGINE])
    await expect(
      page.locator("[data-slot=view-bar]").getByText("2 engines · 1 refused"),
    ).toBeVisible()
    await expect(engineRow(page, REFUSED_C8_ENGINE)).toContainText("profile refused")
    const strip = page.locator("[data-slot=status-strip]", {
      hasText: `${REFUSED_C8_ENGINE} couldn't be read`,
    })
    await expect(strip).toContainText(
      `Engine ${REFUSED_C8_ENGINE} cannot be used: its profile is refused`,
    )
    await expect(
      strip.getByText(
        new RegExp(
          `^\\[ENGINE_PROFILE_REFUSED\\] Engine "${REFUSED_C8_ENGINE}" is configured, but its profile cannot be used: `,
        ),
      ),
    ).toBeAttached()
    await expect(page.getByText(/Input validation error/)).toHaveCount(0)
    expect(calls.filter((call) => call.arguments?.engine === REFUSED_C8_ENGINE)).toEqual([])
    await expectNoAxeFinding(page)
    // Its row opens the profile's one state at the engine's own address.
    await engineRow(page, REFUSED_C8_ENGINE).click()
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(REFUSED_C8_ENGINE, {
      timeout: 15_000,
    })
    expect(new URL(page.url()).pathname).toBe(`/app/engines/${REFUSED_C8_ENGINE}`)
  })
})

/**
 * The start page in German at a phone's width and at 320 px: its bar, its tables and its strips
 * stay within the page, a table's columns that do not fit scroll in its own region, and axe finds
 * nothing.
 */
test.describe("the start page in German on a phone", () => {
  for (const [width, deployment] of [
    [390, "camunda8"],
    [320, "camunda8"],
    [390, "main"],
    [320, "main"],
  ] as const satisfies readonly (readonly [number, Deployment])[]) {
    test(`fits ${width} px without scrolling sideways (${deployment})`, async ({ browser }) => {
      const context = await browser.newContext({
        locale: "de-DE",
        viewport: { width, height: 760 },
      })
      try {
        const page = await context.newPage()
        await signIn(page, "/app", { deployment })
        await expect(page.getByRole("heading", { level: 1, name: "Alle Engines" })).toBeVisible({
          timeout: 15_000,
        })
        await expect(
          page
            .getByRole("table", { name: "Engines" })
            .getByRole("row", { name: `Engine ${HEALTHY_ENGINE}` })
            .locator("td")
            .nth(5),
        ).toHaveText(/^\d/, { timeout: 15_000 })
        await expect(page.getByRole("heading", { level: 2, name: "Was wo läuft" })).toBeVisible({
          timeout: 15_000,
        })
        await expect(page.getByRole("table", { name: "Prozesse je Engine" })).toBeVisible()
        await rendered(page)
        expect(await scrollsSideways(page)).toBe(false)
        await expectNoAxeFinding(page)
      } finally {
        await context.close()
      }
    })
  }
})
