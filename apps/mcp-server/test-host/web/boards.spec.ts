import { expect, test, type Page } from "@playwright/test"
import {
  BROKEN_BOARD,
  BROKEN_ENGINE,
  C8_ENGINE,
  HEALTHY_ENGINE,
  INVOICES_BOARD,
  ORDERS_BOARD,
} from "../engines.js"
import {
  collectErrors,
  expectNoAxeFinding,
  navEntry,
  type PageCall,
  recordCalls,
  rendered,
  signIn,
} from "./web-sim.js"

/**
 * The board list and the board pages of the web app on the real server: `/app` opens the cockpit's
 * landing (`engine_open_cockpit` view `landing`), the engines and the server's boards, with one
 * engine too where the server has boards; `/app/boards/<id>` opens a board (view `board`), titled
 * by the board's title once the view shows it (by its id before). Both are read-only and show what
 * the chat shows: the same board feed, the same tiles of @miragon/pulse-blocks. A board the server
 * shows not, or whose file gives none, is a refusal no retry changes: what happened and what to do
 * on the page, no Try again. The main deployment reads test:host's board files over the stub
 * engine and the broken one (`fixtures/boards`); the short one has one engine and no board; the
 * camunda8 one reads a board over the stub engine and a Camunda 8 cluster
 * (`fixtures/camunda8-boards`), which the server reads on boards only.
 */

const TITLE = "Invoice operations"
const BOARD_PAGE = `/app/boards/${INVOICES_BOARD}`

const landing = (page: Page) => page.getByRole("heading", { level: 1, name: "Operations Cockpit" })
const boards = (page: Page) => page.getByRole("region", { name: "Boards" })
const boardHeading = (page: Page) => page.getByRole("heading", { level: 1, name: TITLE })
const tile = (page: Page, name: string) => page.getByRole("region", { name })
const trail = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" })
const viewCalls = (calls: PageCall[]) => calls.filter((call) => call.name === "engine_open_cockpit")

/** The board has drawn: its title and its diagram on the canvas. */
async function drawn(page: Page): Promise<void> {
  await expect(boardHeading(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(".djs-container svg").first()).toBeVisible({ timeout: 15_000 })
}

test.describe("the board list", () => {
  test("/app lists two engines and the boards: a board by its title and engines, a refused file by its problem count", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    await signIn(page)
    await expect(landing(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("region", { name: "Engines" }).getByRole("button")).toHaveCount(2)
    const board = boards(page).getByRole("button", {
      name: new RegExp(`^${TITLE}\\s*,\\s*2 engines: ${HEALTHY_ENGINE}, ${BROKEN_ENGINE}$`),
    })
    await expect(board).toBeVisible()
    const refused = boards(page).locator("[data-status=refused]")
    await expect(refused).toContainText(BROKEN_BOARD)
    await expect(refused).toContainText(/file refused: 1 problem$/)
    await expect(page).toHaveTitle("Operations Cockpit · Pulse")
    expect(viewCalls(calls)).toEqual([
      { name: "engine_open_cockpit", arguments: { view: "landing" } },
    ])
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)

    // A board opens in the page, the title and the address following it (N1); the navigation's
    // Start is the way home, so no trail repeats it, and Back leads to the list in the page, which
    // calls the view tool no second time.
    await board.click()
    await drawn(page)
    await expect(page).toHaveTitle(`${TITLE} · Pulse`)
    expect(new URL(page.url()).pathname).toBe(BOARD_PAGE)
    await expect(trail(page)).toHaveCount(0)
    await page.goBack()
    await expect(landing(page)).toBeVisible()
    await expect(page).toHaveTitle("Operations Cockpit · Pulse")
    expect(new URL(page.url()).pathname).toBe("/app")
    expect(viewCalls(calls)).toHaveLength(1)
    // A reload shows the board again, from the address.
    await page.goForward()
    await drawn(page)
    await page.reload()
    await drawn(page)
  })

  test("with one engine and no board, /app opens that engine, its processes the page's own screen", async ({
    page,
  }) => {
    await signIn(page, "/app", { deployment: "short" })
    await expect(navEntry(page, "Processes")).toHaveAttribute("aria-current", "page", {
      timeout: 15_000,
    })
    await expect(page.getByRole("table", { name: "Processes" })).toBeVisible({ timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe(`/app/engines/${HEALTHY_ENGINE}`)
    await expect(landing(page)).toHaveCount(0)
  })
})

test.describe("a board's page", () => {
  test("shows the board with its tiles over two engines, the broken one in its place, titled by its title", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    await signIn(page, BOARD_PAGE)
    await drawn(page)
    await expect(page).toHaveTitle(`${TITLE} · Pulse`)
    expect(viewCalls(calls)).toEqual([
      { name: "engine_open_cockpit", arguments: { view: "board", board: INVOICES_BOARD } },
    ])
    await expect(page.getByText(`2 engines: ${HEALTHY_ENGINE}, ${BROKEN_ENGINE}`)).toBeVisible()
    const counter = tile(page, "Waiting for approval")
    await expect(counter.locator("[data-part=counter-value]")).toHaveText("2")
    await expect(counter.getByText("from 1 of 2 engines")).toBeVisible()
    const instances = tile(page, "Running instances of invoice")
    await expect(instances.getByRole("row").filter({ hasText: "INV-2026-0042" })).toBeVisible()
    await expect(page.getByText(`Engine ${BROKEN_ENGINE} is unreachable (HTTP 503)`)).toBeVisible()
    await expect(tile(page, 'Widget "chart"').getByText(/must be one of counter/)).toBeVisible()
    // The navigation's Start leads to the list, where two engines and the boards are to pick
    // from, its entry of the board the current one: no trail repeats it on a page.
    await expect(navEntry(page, "Start")).toHaveAttribute("href", "/app")
    await expect(navEntry(page, TITLE)).toHaveAttribute("aria-current", "page")
    await expect(trail(page)).toHaveCount(0)
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)
  })

  test("a tile's row opens the cockpit on its engine on a click, through the page's caller, and the trail leads back", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, BOARD_PAGE)
    await drawn(page)
    // One row convention on a page too: the row opens what it names, no drill in it.
    const row = tile(page, "Running instances of invoice")
      .getByRole("row", { name: /^Instance / })
      .filter({ hasText: "INV-2026-0042" })
    await expect(row.getByRole("button", { name: /^Open/ })).toHaveCount(0)
    await row.getByRole("cell").first().click()
    // The navigation opens the engine the instance runs on, its sections under it.
    await expect(navEntry(page, "Processes")).toHaveAttribute(
      "href",
      `/app/engines/${HEALTHY_ENGINE}`,
      { timeout: 15_000 },
    )
    // The instance's bar names it, the trail on its row above it.
    await expect(page.getByRole("heading", { level: 1, name: "INV-2026-0042" })).toBeVisible({
      timeout: 15_000,
    })
    expect(
      calls.filter((call) => call.name === "engine_instance_detail_data").at(-1)?.arguments,
    ).toMatchObject({ engine: HEALTHY_ENGINE })
    // The page offers no write on the instance it drilled into.
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0)
    // The address names the instance on its engine (N1); the trail, the board then the instance.
    expect(new URL(page.url()).pathname).toMatch(
      new RegExp(`^/app/engines/${HEALTHY_ENGINE}/instances/[^/]+$`),
    )
    await trail(page).getByRole("button", { name: TITLE }).click()
    await expect(boardHeading(page)).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(BOARD_PAGE)
  })

  test("a tile's row opened by Enter on an instance whose read fails: its name stays the page's one heading and its title", async ({
    page,
  }) => {
    await signIn(page, BOARD_PAGE)
    await drawn(page)
    const row = tile(page, "Running instances of invoice")
      .getByRole("row", { name: /^Instance / })
      .filter({ hasText: "INV-2026-0043" })
    await row.focus()
    await page.keyboard.press("Enter")
    // The stub engine serves this instance nothing: its read fails, once the view's retries did.
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(["INV-2026-0043"])
    await expect(page).toHaveTitle("INV-2026-0043 · Pulse")
    await expectNoAxeFinding(page)
  })

  test("a board file that gives no board: says so in the box, its problems in the log, no Try again", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, `/app/boards/${BROKEN_BOARD}`)
    const alert = page.getByRole("alert")
    const refused = "This board can't be shown: its file gives no board"
    await expect(alert.getByRole("heading", { level: 1, name: refused })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      alert.getByText(
        "Its problems are under Details and in the server's log at startup. Ask whoever runs this server to fix the file.",
      ),
    ).toBeVisible()
    await expect(
      alert.getByText(/^\[BOARD_REFUSED\] Board "broken" cannot be shown/),
    ).toBeAttached()
    await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expect(page).toHaveTitle(`${refused} · Pulse`)
    expect(viewCalls(calls)).toHaveLength(1)
    await expectNoAxeFinding(page)
  })

  test("an unknown id: says the board is not on this server and where the boards are, no Try again", async ({
    page,
  }) => {
    await signIn(page, "/app/boards/shipping")
    const alert = page.getByRole("alert")
    await expect(
      alert.getByRole("heading", { level: 1, name: "This board isn't on this server" }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      alert.getByText("Go to Pulse's start page, which shows this server's boards and engines."),
    ).toBeVisible()
    await expect(
      alert.getByText(`[UNKNOWN_BOARD] Unknown board id "shipping". Boards: ${INVOICES_BOARD}.`),
    ).toBeAttached()
    await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expect(page.getByText(/\bchat\b/i)).toHaveCount(0)
    await expectNoAxeFinding(page)

    // The box holds the way there, beside its words; the navigation's Start leads there too.
    await expect(navEntry(page, "Start")).toHaveAttribute("href", "/app")
    await alert.getByRole("link", { name: "Go to the start page" }).click()
    await expect(landing(page)).toBeVisible({ timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe("/app")
  })
})

test.describe("a board's page in German, on a dark system", () => {
  test.use({ locale: "de-DE", colorScheme: "dark" })

  test("words the board in German and titles the page by the board's title", async ({ page }) => {
    await signIn(page, BOARD_PAGE)
    await expect(boardHeading(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: "Aktualisieren" })).toBeVisible()
    await expect(page).toHaveTitle(`${TITLE} · Pulse`)
    await expect(tile(page, "Laufende Instanzen von invoice")).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("lang", "de")
    await expectNoAxeFinding(page)
  })

  // D10, point 7: the page's diagram follows the theme as the editors' canvas does, the system's
  // dark first, then the theme the page sets on its document.
  test("draws the diagram on the dark canvas, and on the light one once the page sets light", async ({
    page,
  }) => {
    await signIn(page, BOARD_PAGE)
    await drawn(page)
    const canvas = page.locator("[data-slot='bpmn-canvas']").first()
    await expect(canvas.locator(".djs-connection").first()).toBeAttached({ timeout: 15_000 })
    const dark = await canvasInk(page)
    expect(dark.paper).toBeLessThan(0.05)
    expect(dark.flow).toBeGreaterThan(0.95)
    expect(dark.label).toBeGreaterThan(0.95)
    await page.evaluate(() => document.documentElement.setAttribute("data-cd-theme", "light"))
    await expect.poll(async () => (await canvasInk(page)).paper).toBeGreaterThan(0.95)
    const light = await canvasInk(page)
    expect(light.flow).toBeLessThan(0.05)
    expect(light.label).toBeLessThan(0.05)
  })
})

/** WCAG relative luminance of the first canvas's paper, a flow's stroke and a label's fill. */
async function canvasInk(page: Page): Promise<{ paper: number; flow: number; label: number }> {
  return await page
    .locator("[data-slot='bpmn-canvas']")
    .first()
    .evaluate((paper) => {
      const pen = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
      const luminance = (value: string) => {
        pen.clearRect(0, 0, 1, 1)
        pen.fillStyle = value
        pen.fillRect(0, 0, 1, 1)
        const [r, g, b] = [...pen.getImageData(0, 0, 1, 1).data].map((c) => {
          const x = c / 255
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const style = (selector: string) => getComputedStyle(paper.querySelector(selector)!)
      return {
        paper: luminance(getComputedStyle(paper).backgroundColor),
        flow: luminance(style(".djs-connection .djs-visual > path").stroke),
        label: luminance(style("text").fill),
      }
    })
}

test.describe("a board's page over a Camunda 7 engine and a Camunda 8 one", () => {
  const ORDERS_TITLE = "Order operations"
  const ordersHeading = (page: Page) => page.getByRole("heading", { level: 1, name: ORDERS_TITLE })

  test("shows both engines' numbers and the Zeebe diagram; a Camunda 8 engine's tiles and chip open nothing", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    await signIn(page, `/app/boards/${ORDERS_BOARD}`, { deployment: "camunda8" })
    await expect(ordersHeading(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(".djs-container svg").first()).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveTitle(`${ORDERS_TITLE} · Pulse`)
    expect(viewCalls(calls)).toEqual([
      { name: "engine_open_cockpit", arguments: { view: "board", board: ORDERS_BOARD } },
    ])
    const engines = page.getByRole("group", { name: "Engines of this board" })
    await expect(
      engines.getByRole("button", { name: new RegExp(`^${HEALTHY_ENGINE} CIB seven `) }),
    ).toBeVisible()
    await expect(engines.locator("[data-part=board-engine]")).toHaveText(
      `${C8_ENGINE}Camunda 8 8.9.28 · 3 running · 1 with incident`,
    )
    await expect(tile(page, "Orders in flight").locator("[data-part=counter-value]")).toHaveText(
      "3",
    )
    await expect(
      tile(page, "Order fulfillment").getByRole("img", { name: "BPMN process diagram" }),
    ).toContainText("Charge payment")
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)

    // No view of the cockpit reads a Camunda 8 engine: the board offers no way into one, so its
    // instances are plain rows and its chip opens nothing; it reads nothing of it but the board's.
    await expect(
      tile(page, "Running instances of pulse-order").getByRole("row", { name: /^Instance / }),
    ).toHaveCount(0)
    await expect(
      tile(page, "Running instances of pulse-order").locator("tbody tr[tabindex]"),
    ).toHaveCount(0)
    await expect(engines.getByRole("button")).toHaveCount(1)
    expect(calls.filter((call) => call.arguments?.engine === C8_ENGINE).map((c) => c.name)).toEqual(
      ["engine_bpmn_xml_data"],
    )
  })
})
