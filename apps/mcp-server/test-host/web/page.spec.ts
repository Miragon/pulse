import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { HEALTHY_ENGINE } from "../engines.js"
import {
  collectErrors,
  expectNoAxeFinding,
  idpRecord,
  originOf,
  recordCalls,
  rendered,
  signIn,
} from "./web-sim.js"

/**
 * The cockpit as a page of the server (#573): apps/web mounts the engine module's views with
 * widget-shell's `mountPage`, under the browser adapter instead of ext-apps' `App`, and its caller
 * posts each tool call to the server's `/app/api/call`, which forwards it to `/mcp` with the
 * session's token. The views are the chat's, built from the same sources: the view tool's data,
 * every feed, the browser's language and theme, and no hand-off, since the page posts to no chat.
 * A page writes nothing: the deployment's toolset registers the widget writes, and the page offers
 * none, nor asks the gate feed.
 */

const SERVER = path.resolve(import.meta.dirname, "..", "..")
const WEB_BUILD = path.resolve(SERVER, "..", "web", "dist")
const OVERVIEW_PAGE = `/app/cockpit?engine=${HEALTHY_ENGINE}`
const JOBS_PAGE = `/app/cockpit?view=jobs&engine=${HEALTHY_ENGINE}`
/** The stub's invoice instance: two open incidents whose jobs have no retries, one variable. */
const INSTANCE_PAGE = `/app/cockpit?view=instance-detail&engine=${HEALTHY_ENGINE}&processInstanceId=pi-invoice-42`
const DEFINITIONS_TABLE =
  "Deployed process definitions with running instances, jobs without retries and incidents"
const STUB_DEFINITIONS = ["Customer Onboarding", "Invoice Receipt", "Order Fulfillment"]

/** The page's script, as the build's index.html loads it. */
function pageScript(): string {
  const index = readFileSync(path.join(WEB_BUILD, "index.html"), "utf8")
  const [, src] = /<script type="module" crossorigin src="\/app\/([^"]+)"/.exec(index) ?? []
  if (src === undefined) throw new Error("apps/web/dist/index.html loads no script")
  return readFileSync(path.join(WEB_BUILD, src), "utf8")
}

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
    // A page owns its viewport: every row, no inline fit and its footer, no switch to fullscreen.
    for (const name of STUB_DEFINITIONS) await expect(table.getByText(name)).toBeVisible()
    await expect(page.getByText(/of 3 shown/)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Fullscreen" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "All processes", exact: true })).toHaveCount(1)
    // The page called the view tool itself, once, with the arguments its query names.
    expect(calls.filter((call) => call.name === "engine_open_cockpit")).toEqual([
      { name: "engine_open_cockpit", arguments: { engine: HEALTHY_ENGINE } },
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

  test("pinned: a start the tool refuses says why, and to ask in a chat the page has none of", async ({
    page,
  }) => {
    await signIn(page, `/app/cockpit?view=no-such-view&engine=${HEALTHY_ENGINE}`)
    const alert = page.getByRole("alert")
    await expect(alert.getByRole("heading", { name: "This view couldn't be loaded" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible()
    await expect(
      alert.getByText("Try again. If it fails again, ask in the chat."),
      "pinned: describeError's hints ask in the chat on a page too; flip to a page's words once they say what to do there",
    ).toBeVisible()
  })

  test("the page's script holds no MCP Apps runtime, which the chat's bundle does", () => {
    // The handshake every ext-apps `App` sends first.
    const handshake = "ui/initialize"
    expect(pageScript()).not.toContain(handshake)
    expect(readFileSync(path.join(SERVER, "dist", "mcp-app.js"), "utf8")).toContain(handshake)
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

  test("pinned: the landing scrolls sideways at 320 px, its cross-engine button too wide", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await signIn(page)
    const fleet = page.getByRole("button", { name: "Engine-übergreifende Übersicht" })
    await expect(fleet).toBeVisible({ timeout: 15_000 })
    await rendered(page)
    expect(
      await scrollsSideways(page),
      "pinned: the hero's button is wider than the column beside the Komet; flip once it fits",
    ).toBe(true)
    expect((await fleet.boundingBox())?.width).toBeGreaterThan(240)
  })
})

test("the landing fits 320 px in English, its engines and its boards", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await signIn(page)
  await expect(page.getByRole("button", { name: "Cross-engine overview" })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole("region", { name: "Boards" }).getByRole("button")).toHaveCount(1)
  await rendered(page)
  expect(await scrollsSideways(page)).toBe(false)
  await expectNoAxeFinding(page)
})
