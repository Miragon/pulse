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

    // A board opens in the page, the title following it; its trail leads back to the list, the
    // address stays.
    await board.click()
    await drawn(page)
    await expect(page).toHaveTitle(`${TITLE} · Pulse`)
    await trail(page).getByRole("button", { name: "All engines" }).click()
    await expect(landing(page)).toBeVisible()
    await expect(page).toHaveTitle("Operations Cockpit · Pulse")
    expect(new URL(page.url()).pathname).toBe("/app")
  })

  test("with one engine and no board, /app opens that engine", async ({ page }) => {
    await signIn(page, "/app", { deployment: "short" })
    const sections = page.getByRole("navigation", { name: "Cockpit sections" })
    await expect(sections.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
      { timeout: 15_000 },
    )
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
    // The trail leads to the list, where two engines and the boards are to pick from.
    await expect(trail(page).getByRole("button", { name: "All engines" })).toBeVisible()
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)
  })

  test("a tile drills into the cockpit on its engine, through the page's caller, and the trail leads back", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, BOARD_PAGE)
    await drawn(page)
    const row = tile(page, "Running instances of invoice")
      .getByRole("row")
      .filter({ hasText: "INV-2026-0042" })
    await row.getByRole("button", { name: /^Open instance/ }).click()
    await expect(page.getByLabel("Selected engine")).toHaveValue(HEALTHY_ENGINE, {
      timeout: 15_000,
    })
    await expect(page.getByText("INV-2026-0042").first()).toBeVisible({ timeout: 15_000 })
    expect(
      calls.filter((call) => call.name === "engine_instance_detail_data").at(-1)?.arguments,
    ).toMatchObject({ engine: HEALTHY_ENGINE })
    // The page offers no write on the instance it drilled into.
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0)
    await trail(page).getByRole("button", { name: TITLE }).click()
    await expect(boardHeading(page)).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(BOARD_PAGE)
  })

  test("a tile's drill into an instance whose read fails: its name stays the page's one heading and its title", async ({
    page,
  }) => {
    await signIn(page, BOARD_PAGE)
    await drawn(page)
    const row = tile(page, "Running instances of invoice")
      .getByRole("row")
      .filter({ hasText: "INV-2026-0043" })
    await row.getByRole("button", { name: /^Open instance/ }).click()
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

    // The box holds the way there, beside its words; the bar's product name leads there too.
    await expect(page.getByRole("link", { name: "Pulse, start page" })).toHaveAttribute(
      "href",
      "/app",
    )
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
})

test.describe("a board's page over a Camunda 7 engine and a Camunda 8 one", () => {
  const ORDERS_TITLE = "Order operations"
  const ordersHeading = (page: Page) => page.getByRole("heading", { level: 1, name: ORDERS_TITLE })

  test("shows both engines' numbers and the Zeebe diagram; a Camunda 8 drill leads to the gate and back", async ({
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
    await expect(
      engines.getByRole("button", {
        name: `${C8_ENGINE} Camunda 8 8.9.28 · 3 running · 1 with incident`,
      }),
    ).toBeVisible()
    await expect(tile(page, "Orders in flight").locator("[data-part=counter-value]")).toHaveText(
      "3",
    )
    await expect(
      tile(page, "Order fulfillment").getByRole("img", { name: "BPMN process diagram" }),
    ).toContainText("Charge payment")
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)

    // The cockpit reads a Camunda 8 engine on boards only: its instance opens the gate, which reads
    // nothing and names the board, and the trail leads back to the board's page.
    await tile(page, "Running instances of pulse-order")
      .getByRole("button", { name: "Open instance …27388111" })
      .click()
    await expect(
      page.getByRole("heading", { level: 1, name: `${C8_ENGINE} is a Camunda 8 engine` }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole("list", { name: `Boards that name ${C8_ENGINE}` }).getByRole("button"),
    ).toHaveCount(1)
    expect(calls.filter((call) => call.arguments?.engine === C8_ENGINE).map((c) => c.name)).toEqual(
      ["engine_bpmn_xml_data"],
    )
    await expectNoAxeFinding(page)
    await trail(page).getByRole("button", { name: ORDERS_TITLE }).click()
    await expect(ordersHeading(page)).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(`/app/boards/${ORDERS_BOARD}`)
  })
})
