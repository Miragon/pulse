import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Locator, type Page } from "@playwright/test"
import {
  BROKEN_ENGINE,
  C8_ENGINE,
  C8_OPERATE,
  C8_UNBOARDED_ENGINE,
  HEALTHY_ENGINE,
  INVOICES_BOARD,
  REFUSED_C8_ENGINE,
} from "../engines.js"
import {
  chooseUser,
  collectErrors,
  expectNoAxeFinding,
  idpRecord,
  originOf,
  recordCalls,
  rendered,
  signIn,
} from "./web-sim.js"

/**
 * The cockpit as a page of the server (#573): apps/web mounts its app with widget-shell's
 * `mountApp` and shows the engine module's views in it with `PageView`, under the browser adapter
 * instead of ext-apps' `App`, and its caller
 * posts each tool call to the server's `/app/api/call`, which forwards it to `/mcp` with the
 * session's token. The views are the chat's, built from the same sources: the view tool's data,
 * every feed, the browser's language and theme, and no hand-off, since the page posts to no chat.
 * A page writes nothing: the deployment's toolset registers the widget writes, and the page offers
 * none, nor asks the gate feed. Every page has one main landmark and one h1, which titles it, and
 * says what to do on the page, never in a chat.
 */

const SERVER = path.resolve(import.meta.dirname, "..", "..")
const WEB_BUILD = path.resolve(SERVER, "..", "web", "dist")
const OVERVIEW_PAGE = `/app/engines/${HEALTHY_ENGINE}`
const JOBS_PAGE = `/app/engines/${HEALTHY_ENGINE}/jobs`
/** The stub's invoice instance: two open incidents whose jobs have no retries, one variable. */
const INSTANCE_PAGE = `/app/engines/${HEALTHY_ENGINE}/instances/pi-invoice-42`
const DEFINITIONS_TABLE =
  "Deployed process definitions with running instances, jobs without retries and incidents"
const STUB_DEFINITIONS = ["Customer Onboarding", "Invoice Receipt", "Order Fulfillment"]

/** The page's script's name in the build (`assets/…`), as the build's index.html loads it. */
function pageScriptName(): string {
  const index = readFileSync(path.join(WEB_BUILD, "index.html"), "utf8")
  const [, src] = /<script type="module" crossorigin src="\/app\/([^"]+)"/.exec(index) ?? []
  if (src === undefined) throw new Error("apps/web/dist/index.html loads no script")
  return src
}

/** The page's script, as the build holds it. */
const pageScript = (): string => readFileSync(path.join(WEB_BUILD, pageScriptName()), "utf8")

/** Whether the page scrolls sideways: wider content than its viewport. */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

/** The tools `/mcp` lists to a caller with the deployment's access token. */
async function listedTools(token: string): Promise<string[]> {
  const response = await fetch(`${originOf()}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  })
  const text = await response.text()
  const json = text.trimStart().startsWith("{")
    ? text
    : (text.split("\n").find((line) => line.startsWith("data: ")) ?? "").slice("data: ".length)
  const { result } = JSON.parse(json) as { result: { tools: { name: string }[] } }
  return result.tools.map((tool) => tool.name)
}

test.describe("the cockpit as a page", () => {
  test("mounts over the page's caller: one view call, every row, no fullscreen switch", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    await signIn(page, OVERVIEW_PAGE)

    const table = page.getByRole("table", { name: DEFINITIONS_TABLE })
    await expect(table).toBeVisible({ timeout: 15_000 })
    // One main landmark, the view frame's: the cockpit's route renders none of its own.
    await expect(page.getByRole("main")).toHaveCount(1)
    await expect(page).toHaveTitle(`${HEALTHY_ENGINE} · Overview · Pulse`)
    // A page owns its viewport: every row, no inline fit and its footer, no switch to fullscreen.
    for (const name of STUB_DEFINITIONS) await expect(table.getByText(name)).toBeVisible()
    await expect(page.getByText(/of 3 shown/)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Fullscreen" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "All processes", exact: true })).toHaveCount(1)
    // The page called the view tool itself, once: an engine's own address starts on the landing,
    // which every server's tool takes, and the cockpit opens the engine.
    expect(calls.filter((call) => call.name === "engine_open_cockpit")).toEqual([
      { name: "engine_open_cockpit", arguments: { view: "landing" } },
    ])
    // The locale gate resolved the browser's language and wrote it on the document.
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)
  })

  test("a section of the cockpit reads its feed through the page's caller", async ({ page }) => {
    const calls = recordCalls(page)
    await signIn(page, OVERVIEW_PAGE)
    const sections = page.getByRole("navigation", { name: "Cockpit sections" })
    await sections.getByRole("button", { name: "Jobs" }).click({ timeout: 15_000 })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    expect(
      calls.filter((call) => call.name === "engine_jobs_data").at(-1)?.arguments,
    ).toMatchObject({ engine: HEALTHY_ENGINE })
    // The document's title follows the view the page moved on to.
    await expect(page).toHaveTitle(`${HEALTHY_ENGINE} · Jobs · Pulse`)
  })

  test("names the engine in each engine section's heading and title", async ({ page }) => {
    await expectEngineSections(page, ["Overview", "Incidents", "Jobs"])
  })

  // One row convention on every surface (owner direction 2026-11-18): a page's rows open as the
  // chat's and the webview's do, each named by what it opens, with no column of drills.
  test("a row opens what it names on Enter or a click, as in the chat and the webview", async ({
    page,
  }) => {
    await signIn(page, OVERVIEW_PAGE)
    const process = page
      .getByRole("table", { name: DEFINITIONS_TABLE })
      .getByRole("row", { name: "Process Invoice Receipt" })
    await expect(process).toBeVisible({ timeout: 15_000 })
    await process.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { level: 1, name: "Invoice Receipt" })).toBeVisible({
      timeout: 15_000,
    })
    // An instance's incidents: a click on a row opens its incident, no drill in it.
    await page.goto(`${originOf()}${INSTANCE_PAGE}`)
    const incidents = page.getByRole("region", { name: "Incidents of this instance" })
    const incident = incidents.getByRole("row", { name: /^Incident at chargeCard, / })
    await expect(incident).toBeVisible({ timeout: 15_000 })
    await expect(incidents.getByRole("button", { name: /^Open\b/ })).toHaveCount(0)
    await expectNoAxeFinding(page)
    await incident.getByRole("cell").first().click()
    await expect(page.getByRole("heading", { level: 1, name: "chargeCard" })).toBeVisible({
      timeout: 15_000,
    })
  })

  test("hides the chat's hand-offs, and every menu, column or section that holds them alone", async ({
    page,
  }) => {
    await signIn(page, JOBS_PAGE)
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: "Assess in chat" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^Copy prompt/ })).toHaveCount(0)
    // A failed job's menu holds two hand-offs and nothing else, and a page offers no retry: no
    // menu button that opens empty, no actions column that no row fills.
    await expect(page.getByRole("button", { name: /^More actions/ })).toHaveCount(0)
    await expect(jobs.getByRole("columnheader", { name: "Actions" })).toHaveCount(0)

    // The fleet's analyses are hand-offs only: the section goes with them, its heading too.
    await page.goto(`${originOf()}/app`)
    await page.getByRole("button", { name: "Cross-engine overview" }).click({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Cross-engine overview" })).toBeVisible()
    await expect(page.getByText("Analyses across all engines")).toHaveCount(0)
    await expect(page.getByText(/\bchat\b/i)).toHaveCount(0)
  })

  test("offers no write and asks no gate, while the deployment's toolset registers the writes", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, INSTANCE_PAGE)
    // The deployment registers the widget writes for the same user: /mcp lists them.
    const { issued } = await idpRecord()
    const tools = await listedTools(issued.access.at(-1) ?? "")
    expect(tools).toEqual(
      expect.arrayContaining(["engine_set_job_retries", "engine_widget_actions_data"]),
    )

    // The chat's view of this instance on such a deployment offers Retry and Edit by these names
    // (test:host's compact-frame.spec.ts), so a renamed write fails there, not silently here.
    const incidents = page.getByRole("region", { name: "Incidents of this instance" })
    await expect(incidents.locator("tbody tr")).toHaveCount(2, { timeout: 15_000 })
    await rendered(page)
    await expect(incidents.getByRole("button", { name: "Retry" })).toHaveCount(0)
    await page
      .getByRole("tab", { name: /^Variables/ })
      .first()
      .click()
    const variables = page.getByRole("region", { name: "Process instance variables" })
    await expect(variables.getByText("amount")).toBeVisible()
    await expect(variables.getByRole("button", { name: "Edit" })).toHaveCount(0)
    await expect(variables.getByRole("columnheader", { name: "Actions" })).toHaveCount(0)
    await rendered(page)
    expect(calls.map((call) => call.name)).toContain("engine_open_cockpit")
    expect(calls.map((call) => call.name)).not.toContain("engine_widget_actions_data")
  })

  test("a start the tool refuses says why and what to do on the page, with no Try again", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, `/app/cockpit?view=no-such-view&engine=${HEALTHY_ENGINE}`)
    const alert = page.getByRole("alert")
    const refused = "The server refused this request"
    await expect(alert.getByRole("heading", { level: 1, name: refused })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      alert.getByText(
        "You'll find the reason under Details. Open the view from Pulse's start page instead.",
      ),
    ).toBeVisible()
    await expect(alert.getByText(/^Input validation error: /)).toBeAttached()
    await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expect(alert.getByRole("link", { name: "Go to the start page" })).toHaveAttribute(
      "href",
      "/app",
    )
    await expect(page.getByText(/\bchat\b/i)).toHaveCount(0)
    await expect(page).toHaveTitle(`${refused} · Pulse`)
    expect(calls.filter((call) => call.name === "engine_open_cockpit")).toHaveLength(1)
    await expectNoAxeFinding(page)
  })

  test("loads its script compressed with brotli, decoded byte for byte the build's file", async ({
    page,
  }) => {
    const name = pageScriptName()
    const loaded = page.waitForResponse((response) => response.url().endsWith(`/app/${name}`))
    await signIn(page, OVERVIEW_PAGE)
    const response = await loaded
    const file = readFileSync(path.join(WEB_BUILD, name))
    const headers = await response.allHeaders()
    expect(response.status()).toBe(200)
    expect(headers["content-encoding"]).toBe("br")
    expect(headers.vary).toBe("Accept-Encoding")
    expect(Number(headers["content-length"])).toBeLessThan(file.byteLength)
    expect((await response.body()).equals(file)).toBe(true)
  })

  test("the page's script holds no MCP Apps runtime, which the chat's bundle does", () => {
    // The handshake every ext-apps `App` sends first.
    const handshake = "ui/initialize"
    expect(pageScript()).not.toContain(handshake)
    expect(readFileSync(path.join(SERVER, "dist", "mcp-app.js"), "utf8")).toContain(handshake)
  })
})

/**
 * The page's address follows the cockpit (N1) and the page navigates itself: every view has its
 * canonical address (`/app/engines/<engine>/…`), a drill and a section are each a new entry of the
 * browser's history; Back and Forward are the entries around it, the trail as it was left there and
 * no second call of the view tool; a reload and a sign-in show the view the address names; an old
 * address (`/app/cockpit?view=…`) gives way to the view's own in its entry; an engine switch keeps
 * its section (N7) and rewrites the address; the cross-engine overview is a page of its own,
 * /app/fleet; the bar's Pulse leads to /app in the page.
 */
test.describe("the page's address", () => {
  const OVERVIEW = `/app/engines/${HEALTHY_ENGINE}`
  const PROCESS = `/app/engines/${HEALTHY_ENGINE}/processes/invoice`
  const INCIDENTS = (engine: string) => `/app/engines/${engine}/incidents`
  /** The page and its query, as the address bar names it. */
  const here = (page: Page) => {
    const url = new URL(page.url())
    return `${url.pathname}${url.search}`
  }
  /** The entries of the tab's history. */
  const entries = (page: Page) => page.evaluate(() => history.length)
  const viewCalls = (calls: { name: string }[]) =>
    calls.filter((call) => call.name === "engine_open_cockpit").length
  const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name })
  const LANDING = "Operations Cockpit"

  test("each drill is an entry of its own, a reload stays, Back and Forward step through them", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, "/app")
    await expect(h1(page, LANDING)).toBeVisible({ timeout: 15_000 })
    const start = await entries(page)
    await page.getByRole("button", { name: new RegExp(`^${HEALTHY_ENGINE}\\b`) }).click()
    await expect(h1(page, `${HEALTHY_ENGINE} · Overview`)).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(OVERVIEW)
    expect(await entries(page)).toBe(start + 1)
    await page
      .getByRole("region", { name: DEFINITIONS_TABLE, exact: true })
      .getByRole("row", { name: "Process Invoice Receipt" })
      .click()
    await expect(h1(page, "Invoice Receipt")).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(PROCESS)
    expect(await entries(page)).toBe(start + 2)
    // The drills read their feeds: the view tool was called once, for the page's start.
    expect(viewCalls(calls)).toBe(1)

    // A reload: the view the address names, its trail back to its section.
    await page.reload()
    await expect(h1(page, "Invoice Receipt")).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(PROCESS)
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Overview")
    expect(viewCalls(calls)).toBe(2)

    // Back: the overview, then the landing, in the page, no call of the view tool.
    await page.goBack()
    await expect(h1(page, `${HEALTHY_ENGINE} · Overview`)).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(OVERVIEW)
    await page.goBack()
    await expect(h1(page, LANDING)).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe("/app")
    expect(viewCalls(calls)).toBe(2)

    // Forward: the overview, then the process, in the page again.
    await page.goForward()
    await expect(h1(page, `${HEALTHY_ENGINE} · Overview`)).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(OVERVIEW)
    await page.goForward()
    await expect(h1(page, "Invoice Receipt")).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(PROCESS)
    expect(viewCalls(calls)).toBe(2)
  })

  test("a section is an entry of its own; an engine switch keeps it and rewrites the address", async ({
    page,
  }) => {
    await signIn(page, OVERVIEW)
    await expect(h1(page, `${HEALTHY_ENGINE} · Overview`)).toBeVisible({ timeout: 15_000 })
    const start = await entries(page)
    const sections = page.getByRole("navigation", { name: "Cockpit sections" })
    const incidents = sections.getByRole("button", { name: "Incidents" })
    await incidents.click()
    await expect(h1(page, `${HEALTHY_ENGINE} · Incidents`)).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(INCIDENTS(HEALTHY_ENGINE))
    expect(await entries(page)).toBe(start + 1)

    // The address names the engine on screen, never the one the page left.
    await page.getByLabel("Selected engine").selectOption(BROKEN_ENGINE)
    await expect(h1(page, `${BROKEN_ENGINE} · Incidents`)).toBeVisible({ timeout: 15_000 })
    await expect(incidents).toHaveAttribute("aria-current", "page")
    expect(here(page)).toBe(INCIDENTS(BROKEN_ENGINE))
    expect(await entries(page)).toBe(start + 2)

    await page.goBack()
    await expect(h1(page, `${HEALTHY_ENGINE} · Incidents`)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel("Selected engine")).toHaveValue(HEALTHY_ENGINE)
    expect(here(page)).toBe(INCIDENTS(HEALTHY_ENGINE))
  })

  test("the cross-engine overview is /app/fleet: a reload stays there, Back leads to the landing", async ({
    page,
  }) => {
    await signIn(page, "/app")
    await page.getByRole("button", { name: "Cross-engine overview" }).click({ timeout: 15_000 })
    const fleet = h1(page, "Cross-engine overview")
    await expect(fleet).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe("/app/fleet")
    await page.reload()
    await expect(fleet).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe("/app/fleet")
    await page.goBack()
    await expect(h1(page, LANDING)).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe("/app")
  })

  /** One address of each pattern of the page over the stub engine, and the h1 its view shows. */
  const ADDRESSES: readonly (readonly [string, string])[] = [
    ["/app", LANDING],
    ["/app/fleet", "Cross-engine overview"],
    [`/app/boards/${INVOICES_BOARD}`, "Invoice operations"],
    [OVERVIEW, `${HEALTHY_ENGINE} · Overview`],
    [PROCESS, "Invoice Receipt"],
    [`${PROCESS}?scope=incident`, "Invoice Receipt"],
    [`${OVERVIEW}/instances`, "Running instances"],
    [`${OVERVIEW}/instances?process=invoice`, "invoice"],
    [`${OVERVIEW}/instances/pi-invoice-42`, "INV-2026-0042"],
    [`${OVERVIEW}/instances/pi-invoice-42?tab=history`, "History"],
    [`${OVERVIEW}/instances/pi-invoice-42/incidents/inc-charge`, "chargeCard"],
    [INCIDENTS(HEALTHY_ENGINE), `${HEALTHY_ENGINE} · Incidents`],
    [`${OVERVIEW}/incidents/cause?activity=chargeCard&type=failedJob`, "chargeCard"],
    [`${OVERVIEW}/jobs`, `${HEALTHY_ENGINE} · Jobs`],
    [`${OVERVIEW}/jobs?failed=true`, `${HEALTHY_ENGINE} · Jobs`],
  ]

  test("every pattern shows its view at its address, and a reload shows the same", async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await signIn(page, "/app")
    for (const [address, heading] of ADDRESSES) {
      const title = page.getByRole("heading", { level: 1, name: heading, exact: true })
      await page.goto(`${originOf()}${address}`)
      await expect(title, address).toBeVisible({ timeout: 15_000 })
      expect(here(page), address).toBe(address)
      await page.reload()
      await expect(title, address).toBeVisible({ timeout: 15_000 })
      expect(here(page), address).toBe(address)
    }
  })

  test("an old address gives way to the view's own in its entry, and Back skips it", async ({
    page,
  }) => {
    await signIn(page, "/app")
    await expect(h1(page, LANDING)).toBeVisible({ timeout: 15_000 })
    const old = (query: string) => `/app/cockpit?${query}&engine=${HEALTHY_ENGINE}`
    for (const [address, canonical, heading] of [
      [old("view=overview"), OVERVIEW, `${HEALTHY_ENGINE} · Overview`],
      [
        old("view=jobs&failedOnly=true"),
        `${OVERVIEW}/jobs?failed=true`,
        `${HEALTHY_ENGINE} · Jobs`,
      ],
      [
        old("view=history&processInstanceId=pi-invoice-42"),
        `${OVERVIEW}/instances/pi-invoice-42?tab=history`,
        "History",
      ],
      [`/app/cockpit?engine=${HEALTHY_ENGINE}`, OVERVIEW, `${HEALTHY_ENGINE} · Overview`],
    ] as const) {
      const before = await entries(page)
      await page.goto(`${originOf()}${address}`)
      await expect(h1(page, heading), address).toBeVisible({ timeout: 15_000 })
      expect(here(page), address).toBe(canonical)
      expect(await entries(page), address).toBe(before + 1)
    }
    await page.goBack()
    await expect(h1(page, "History")).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(`${OVERVIEW}/instances/pi-invoice-42?tab=history`)
  })

  // An engine's own address starts on the landing; an engine the server does not configure is still
  // a refused start there, as the tool refuses it at any other address of it: the address stays.
  test("an engine the server does not configure is a refused start at its address, an old one's too", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    const address = "/app/engines/no-such-engine"
    await signIn(page, address)
    const alert = page.getByRole("alert")
    const refused = "Engine no-such-engine isn't on this server"
    const heading = alert.getByRole("heading", { level: 1, name: refused })
    await expect(heading).toBeVisible({ timeout: 15_000 })
    await expect(
      alert.getByText("Go to Pulse's start page, which shows this server's engines and boards."),
    ).toBeVisible()
    await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expect(page.getByText(/no longer configured/)).toHaveCount(0)
    await expect(page).toHaveTitle(`${refused} · Pulse`)
    expect(here(page)).toBe(address)
    expect(calls.filter((call) => call.arguments?.engine === "no-such-engine")).toEqual([])
    await expectNoAxeFinding(page)
    await page.reload()
    await expect(heading).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(address)
    await page.goto(`${originOf()}/app/cockpit?view=overview&engine=no-such-engine`)
    await expect(heading).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(address)
    await alert.getByRole("link", { name: "Go to the start page" }).click()
    await expect(h1(page, LANDING)).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe("/app")
  })

  test("a sign-in returns to a deep address with its query, and to an old one's own", async ({
    page,
  }) => {
    const deep = `${PROCESS}?scope=incident`
    await signIn(page, deep)
    await expect(h1(page, "Invoice Receipt")).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(deep)
    await page.context().clearCookies()
    await page.goto(`${originOf()}${`/app/cockpit?view=jobs&engine=${HEALTHY_ENGINE}`}`)
    await chooseUser(page)
    await page.waitForURL(`${originOf()}${OVERVIEW}/jobs`)
    await expect(h1(page, `${HEALTHY_ENGINE} · Jobs`)).toBeVisible({ timeout: 15_000 })
  })

  test("the bar's Pulse leads to the start page in the page, a new entry Back leaves", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, PROCESS)
    await expect(h1(page, "Invoice Receipt")).toBeVisible({ timeout: 15_000 })
    const before = await entries(page)
    await page.getByRole("banner").getByRole("link", { name: "Pulse, start page" }).click()
    await expect(h1(page, LANDING)).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe("/app")
    expect(await entries(page)).toBe(before + 1)
    expect(viewCalls(calls)).toBe(1)
    await page.goBack()
    await expect(h1(page, "Invoice Receipt")).toBeVisible({ timeout: 15_000 })
    expect(here(page)).toBe(PROCESS)
  })

  test("Skip to content is the page's first stop: it focuses the view's h1 and adds no entry", async ({
    page,
  }) => {
    await signIn(page, OVERVIEW)
    const title = h1(page, `${HEALTHY_ENGINE} · Overview`)
    await expect(title).toBeVisible({ timeout: 15_000 })
    await rendered(page)
    const before = await entries(page)
    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "Skip to content" })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
    await page.keyboard.press("Enter")
    await expect(title).toBeFocused()
    expect(new URL(page.url()).hash).toBe("")
    expect(await entries(page)).toBe(before)
  })
})

test.describe("the cockpit as a page in German, on a dark system", () => {
  test.use({ locale: "de-DE", colorScheme: "dark" })

  test("takes the browser's language and the system's theme, and follows a theme the page sets", async ({
    page,
  }) => {
    await signIn(page, OVERVIEW_PAGE)
    await expect(page.getByRole("heading", { name: "Alle Prozesse", exact: true })).toHaveCount(1, {
      timeout: 15_000,
    })
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible()
    const html = page.locator("html")
    await expect(html).toHaveAttribute("lang", "de")
    await expect(html).toHaveAttribute("data-theme", "dark")
    await expect(html).toHaveClass(/\bdark\b/)
    await expectNoAxeFinding(page)
    await page.evaluate(() => document.documentElement.setAttribute("data-cd-theme", "light"))
    await expect(html).toHaveAttribute("data-theme", "light")
    await expect(html).not.toHaveClass(/\bdark\b/)
  })

  test("names the engine in each engine section's heading and title, in German", async ({
    page,
  }) => {
    await expectEngineSections(page, ["Übersicht", "Incidents", "Jobs"])
  })

  test("fits 320 px without scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await signIn(page, OVERVIEW_PAGE)
    await expect(page.getByRole("heading", { name: "Alle Prozesse", exact: true })).toHaveCount(1, {
      timeout: 15_000,
    })
    await rendered(page)
    expect(await scrollsSideways(page)).toBe(false)
    await expectNoAxeFinding(page)
  })

  test("the landing fits 320 px, its cross-engine action wrapped under the hero", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await signIn(page)
    await expectLandingFits(page, "Engine-übergreifende Übersicht")
  })
})

/**
 * The engine sections (overview, incidents, jobs) each head their page `<engine> · <section>`, in
 * the page's language (`sections`, in that order), which titles the document.
 */
async function expectEngineSections(page: Page, sections: readonly string[]): Promise<void> {
  await signIn(page, OVERVIEW_PAGE)
  for (const [path, section] of ["", "/incidents", "/jobs"].map(
    (below, index) => [below, sections[index]] as const,
  )) {
    await page.goto(`${originOf()}/app/engines/${HEALTHY_ENGINE}${path}`)
    const heading = `${HEALTHY_ENGINE} · ${section}`
    await expect(page.getByRole("heading", { level: 1 })).toHaveText([heading], { timeout: 15_000 })
    await expect(page).toHaveTitle(`${heading} · Pulse`)
  }
}

/** Every word of `text` in `scope` shows: nothing of it cut, nothing overflowing its box. */
async function expectWhole(scope: Locator, text: string): Promise<void> {
  const words = scope.getByText(text, { exact: true })
  await expect(words).toBeVisible()
  expect(await words.evaluate((el) => el.scrollWidth <= el.clientWidth), text).toBe(true)
}

/** At 320 px the landing scrolls not sideways, its hero's action whole within the gutter. */
async function expectLandingFits(page: Page, fleet: string): Promise<void> {
  const action = page.getByRole("button", { name: fleet })
  await expect(action).toBeVisible({ timeout: 15_000 })
  const boards = page.getByRole("region", { name: "Boards" })
  await expect(boards.getByRole("button")).toHaveCount(1)
  await rendered(page)
  expect(await scrollsSideways(page)).toBe(false)
  // The action ends where the landing's lists end, inside the gutter, its label whole.
  const [box, list] = await Promise.all([action.boundingBox(), boards.boundingBox()])
  expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(
    (list?.x ?? 0) + (list?.width ?? 0) + 0.5,
  )
  expect(await action.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expectNoAxeFinding(page)
}

test("the landing fits 320 px in English, its engines and its boards", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await signIn(page)
  await expectLandingFits(page, "Cross-engine overview")
})

/**
 * The jobs' scope at 320 px in either language, the counts the tiles held: both segments in
 * view, and the page never scrolls sideways.
 */
test.describe("the jobs' scope at 320 px", () => {
  for (const [locale, group, caption] of [
    ["en-US", "Show jobs", "Without retries"],
    ["de-DE", "Jobs zeigen", "Ohne Versuche"],
  ] as const) {
    test(`shows both segments, no sideways scroll (${locale})`, async ({ browser }) => {
      const context = await browser.newContext({ locale, viewport: { width: 320, height: 640 } })
      try {
        const page = await context.newPage()
        await signIn(page, JOBS_PAGE)
        const scope = page.getByRole("radiogroup", { name: group })
        await expect(scope.getByRole("radio", { name: new RegExp(`^${caption}`) })).toBeVisible({
          timeout: 15_000,
        })
        await rendered(page)
        await expect(scope.getByRole("radio")).toHaveCount(2)
        // Each segment keeps its label on one line: a segment without room wraps whole.
        const heights = await scope.evaluate((el) =>
          [...el.querySelectorAll<HTMLElement>("[role=radio]")].map((radio) =>
            Math.round(radio.getBoundingClientRect().height),
          ),
        )
        expect(new Set(heights).size, "every segment the same one-line height").toBe(1)
        expect(await scrollsSideways(page)).toBe(false)
      } finally {
        await context.close()
      }
    })
  }
})

/**
 * On a touch screen at 320 px (40 px rows, their wider padding) a board row names its board
 * whole and puts what it says of it under the name where both do not fit beside each other.
 */
test.describe("the landing's boards at 320 px on a touch screen", () => {
  for (const [locale, engines, refused] of [
    ["en-US", "2 engines: stub, down", "file refused: 1 problem"],
    ["de-DE", "2 Engines: stub, down", "Datei abgelehnt: 1 Problem"],
  ] as const) {
    test(`names each board whole, what it says under it (${locale})`, async ({ browser }) => {
      const context = await browser.newContext({
        locale,
        hasTouch: true,
        viewport: { width: 320, height: 640 },
      })
      try {
        const page = await context.newPage()
        await signIn(page)
        const boards = page.getByRole("region", { name: "Boards" })
        await expect(boards.getByRole("button")).toHaveCount(1, { timeout: 15_000 })
        await rendered(page)
        for (const text of ["Invoice operations", engines, "broken", refused]) {
          await expectWhole(boards, text)
        }
        expect(await scrollsSideways(page)).toBe(false)
        await expectNoAxeFinding(page)
      } finally {
        await context.close()
      }
    })
  }
})

/**
 * The landing of the Camunda 8 deployment at 320 px, in either language: its default engine's row
 * (the badge, the longest words) names its engine whole and puts what it says under the name where
 * both do not fit beside each other, its arrow inside the row (WCAG 1.4.10).
 */
test.describe("the landing's engines of the Camunda 8 deployment at 320 px", () => {
  for (const [locale, onBoards, onNoBoard] of [
    ["en-US", "Camunda 8, on boards", "Camunda 8, on no board yet"],
    ["de-DE", "Camunda 8, auf Boards", "Camunda 8, noch auf keinem Board"],
  ] as const) {
    test(`names each engine whole, its words and its arrow inside the row (${locale})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ locale, viewport: { width: 320, height: 640 } })
      try {
        const page = await context.newPage()
        await signIn(page, "/app", { deployment: "camunda8" })
        const engines = page.getByRole("region", { name: "Engines" })
        await expect(engines.getByRole("button")).toHaveCount(3, { timeout: 15_000 })
        await rendered(page)
        for (const text of [HEALTHY_ENGINE, C8_ENGINE, C8_UNBOARDED_ENGINE, onBoards, onNoBoard]) {
          await expectWhole(engines, text)
        }
        const arrows = await engines.evaluate((el) =>
          [...el.querySelectorAll("button")].map((button) => {
            const row = button.getBoundingClientRect()
            const arrow = button.querySelector(":scope > svg:last-of-type")!.getBoundingClientRect()
            return arrow.right <= row.right + 0.5 && button.scrollWidth <= button.clientWidth
          }),
        )
        expect(arrows).toEqual([true, true, true])
        expect(await scrollsSideways(page)).toBe(false)
        await expectNoAxeFinding(page)
      } finally {
        await context.close()
      }
    })
  }
})

/**
 * The pages that show no view, each with its one heading as its title, in the page's words: the
 * signed-out page per reason (the server's, no session needed), and the pages whose session
 * ended before their first read or could not be read (the session route's answer stubbed).
 */
test.describe("the pages without a view", () => {
  const REASONS = {
    denied: "Sign-in was refused",
    expired: "Your sign-in took too long",
    failed: "Sign-in didn't work",
    audience: "Your sign-in isn't valid for this server",
    signed_out: "You signed out",
    unavailable: "The sign-in service doesn't answer",
  }

  test("the signed-out page names each reason in its h1 and its title", async ({ page }) => {
    for (const [reason, heading] of Object.entries(REASONS)) {
      await page.goto(`${originOf()}/app/signed-out?reason=${reason}`)
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
      await expect(page).toHaveTitle(`${heading} · Pulse`)
      await expectNoAxeFinding(page)
    }
  })

  for (const [state, answer, heading] of [
    [
      "ended before its first read",
      { status: 401, body: '{"code":"signed_out","message":"No session."}' },
      "Your session has ended",
    ],
    ["whose session could not be read", { status: 502, body: "busy" }, "Pulse doesn't answer"],
  ] as const) {
    test(`a page ${state}: its h1, its title, one main`, async ({ page }) => {
      await signIn(page, JOBS_PAGE)
      await page.route("**/app/api/session", (route) =>
        route.fulfill({ ...answer, contentType: "application/json" }),
      )
      await page.reload()
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
      await expect(page).toHaveTitle(`${heading} · Pulse`)
      await expect(page.getByRole("main")).toHaveCount(1)
      await expectNoAxeFinding(page)
    })
  }
})

test.describe("a page whose engine doesn't answer", () => {
  // The cockpit keeps its head (its sections, the switcher, the way to the other engines) over the
  // route, which says so in its place: where the start of its view fails for the engine, not for
  // the page, and where the engine's own address starts the landing and the cockpit opens it.
  for (const [start, address] of [
    ["the start of its jobs", `/app/engines/${BROKEN_ENGINE}/jobs`],
    ["the engine's own address", `/app/engines/${BROKEN_ENGINE}`],
  ] as const) {
    test(`${address} (${start}) keeps the cockpit's head over its failure`, async ({ page }) => {
      const calls = recordCalls(page)
      await signIn(page, address)
      await expect(page.getByRole("navigation", { name: "Cockpit sections" })).toBeVisible({
        timeout: 15_000,
      })
      const failure = page.getByRole("heading", {
        name: `Engine ${BROKEN_ENGINE} is unreachable (HTTP 503)`,
      })
      await expect(failure).toHaveCount(1, { timeout: 30_000 })
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
      await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(1)
      expect(calls.filter((call) => call.name === "engine_open_cockpit")).toHaveLength(1)
      await rendered(page)
      await expectNoAxeFinding(page)
    })
  }
})

test.describe("the cockpit's pages on a Camunda 8 engine", () => {
  // A Camunda 8 engine's own address: the page starts the landing, which every server takes (one of
  // Camunda 8 clusters alone takes no `engine`), and the cockpit opens the engine's gate straight
  // away, never a refusal of the input; a reload keeps it, and the old address leads there.
  test("/app/engines/<a Camunda 8 engine> opens its gate, a reload too", async ({ page }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    const address = `/app/engines/${C8_ENGINE}`
    await signIn(page, address, { deployment: "camunda8" })
    const gate = page.getByRole("heading", { level: 1, name: `${C8_ENGINE} is a Camunda 8 engine` })
    await expect(gate).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Input validation error/)).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toHaveCount(0)
    await expect(page).toHaveTitle(`${C8_ENGINE} is a Camunda 8 engine · Pulse`)
    await expect(page.getByRole("navigation", { name: "Cockpit sections" })).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "Open in Operate (opens in a new tab)" }),
    ).toHaveAttribute("href", C8_OPERATE)
    // One call of the view tool, the landing's; nothing names the engine, which the gate reads not.
    expect(calls.filter((call) => call.name === "engine_open_cockpit")).toEqual([
      { name: "engine_open_cockpit", arguments: { view: "landing" } },
    ])
    expect(calls.filter((call) => call.arguments?.engine === C8_ENGINE)).toEqual([])
    const url = new URL(page.url())
    expect(`${url.pathname}${url.search}`).toBe(address)
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)
    await page.reload()
    await expect(gate).toBeVisible({ timeout: 15_000 })
    await page.goto(`${originOf("camunda8")}/app/cockpit?engine=${C8_ENGINE}`)
    await expect(gate).toBeVisible({ timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe(address)
  })

  // A view of one engine names a Camunda 8 engine: the view does not read it, never arguments the
  // tool does not take.
  test("/app/engines/<a Camunda 8 engine>/jobs says the view does not read it, with the way to the start page", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, `/app/engines/${C8_ENGINE}/jobs`, { deployment: "camunda8" })
    const alert = page.getByRole("alert")
    const refused = "This view doesn't read this engine"
    await expect(alert.getByRole("heading", { level: 1, name: refused })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      alert.getByText(new RegExp(`^\\[ENGINE_DIALECT_NOT_SERVED\\] Engine "${C8_ENGINE}"`)),
    ).toBeAttached()
    await expect(page.getByText(/Input validation error/)).toHaveCount(0)
    await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0)
    expect(calls.filter((call) => call.name === "engine_open_cockpit")).toHaveLength(1)
    await expectNoAxeFinding(page)
    await alert.getByRole("link", { name: "Go to the start page" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    expect(new URL(page.url()).pathname).toBe("/app")
  })

  // The call-time net: a page without `engine` goes to the default, here a Camunda 8 engine,
  // which no route of one engine serves.
  test("/app/cockpit?view=jobs on a Camunda 8 default says the view does not read it, with the way to the start page", async ({
    page,
  }) => {
    const calls = recordCalls(page)
    await signIn(page, "/app/cockpit?view=jobs", { deployment: "camunda8" })
    const alert = page.getByRole("alert")
    const refused = "This view doesn't read this engine"
    await expect(alert.getByRole("heading", { level: 1, name: refused })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      alert.getByText("This server shows it on boards only. Pulse's start page lists the boards."),
    ).toBeVisible()
    await expect(
      alert.getByText(
        new RegExp(
          `^\\[ENGINE_DIALECT_NOT_SERVED\\] Engine "${C8_UNBOARDED_ENGINE}" is a Camunda 8 engine`,
        ),
      ),
    ).toBeAttached()
    await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expect(page.getByText(/\bchat\b/i)).toHaveCount(0)
    await expect(page).toHaveTitle(`${refused} · Pulse`)
    expect(calls.filter((call) => call.name === "engine_open_cockpit")).toHaveLength(1)
    await expectNoAxeFinding(page)

    await alert.getByRole("link", { name: "Go to the start page" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    expect(new URL(page.url()).pathname).toBe("/app")
  })
})

/**
 * A refused profile of the other dialect on a page: the server offers it no feed (its feeds' engine
 * enums name the stub alone), so its page reads nothing of it and says the profile's own reason as
 * its one heading and title, without Try again and without the head's sections.
 */
test.describe("the cockpit's page on a refused profile of the other dialect", () => {
  test("its gate says the profile's own reason, reads nothing and titles the page", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    await signIn(page, "/app", { deployment: "refusedC8" })
    const row = page.getByRole("button", { name: new RegExp(`^${REFUSED_C8_ENGINE}\\b`) })
    await expect(row).toHaveAccessibleName(/\bprofile refused$/, { timeout: 15_000 })
    await row.click()
    const title = `Engine ${REFUSED_C8_ENGINE} cannot be used: its profile is refused`
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
    await expect(page).toHaveTitle(`${title} · Pulse`)
    await expect(
      page.getByText(
        new RegExp(`^\\[ENGINE_PROFILE_REFUSED\\] Engine "${REFUSED_C8_ENGINE}" is configured`),
      ),
    ).toBeAttached()
    await expect(page.getByText(/Input validation error/)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expect(page.getByRole("navigation", { name: "Cockpit sections" })).toHaveCount(0)
    expect(calls.filter((call) => call.arguments?.engine === REFUSED_C8_ENGINE)).toEqual([])
    await rendered(page)
    expect(errors).toEqual([])
    await expectNoAxeFinding(page)
  })
})
