import { readFileSync } from "node:fs"
import path from "node:path"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import { HEALTHY_ENGINE, PAGE_SCRIPT_ENV } from "./engines.js"

/**
 * The cockpit on a plain page outside a chat, the web app's shape (#573): `page/main.ts` mounts
 * this server's views with widget-shell's `mountPage`, under the browser adapter instead of
 * ext-apps' `App`, and hands it a caller that posts each tool call to the host backend, which
 * forwards it to the server (`/host/call`). The views are the chat's, built from the same
 * sources: the view tool's data, every feed, the page's language and theme, and the hand-offs,
 * which a page that posts to no chat hides or offers to copy.
 */

const APP = path.resolve(import.meta.dirname, "..")
const OVERVIEW_ARGS = { engine: HEALTHY_ENGINE }
const JOBS_ARGS = { engine: HEALTHY_ENGINE, view: "jobs" }
const DEFINITIONS_TABLE =
  "Deployed process definitions with running instances, jobs without retries and incidents"
const STUB_DEFINITIONS = ["Customer Onboarding", "Invoice Receipt", "Order Fulfillment"]

interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

interface PageQuery {
  args: Record<string, unknown>
  followUp?: "copy"
  lang?: string
  theme?: "light" | "dark"
}

/** Every tool call the page made through its caller, in order. */
function recordCalls(page: Page): ToolCall[] {
  const calls: ToolCall[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/host/call") {
      calls.push(request.postDataJSON() as ToolCall)
    }
  })
  return calls
}

/** Console errors and uncaught exceptions of the page. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

async function openPage(page: Page, { args, ...rest }: PageQuery): Promise<void> {
  const base = process.env.HOST_SIM_URL
  if (!base) throw new Error("HOST_SIM_URL is unset. Run via `playwright test -c test-host`")
  const query = new URLSearchParams({
    view: "engine_open_cockpit",
    args: JSON.stringify(args),
    ...rest,
  })
  await page.goto(`${base}/page?${query.toString()}`)
}

test.describe("a page outside a chat (mountPage)", () => {
  test("mounts the cockpit over the page's caller: one view call, no fit, no fullscreen switch", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const calls = recordCalls(page)
    await openPage(page, { args: OVERVIEW_ARGS })

    const table = page.getByRole("table", { name: DEFINITIONS_TABLE })
    await expect(table).toBeVisible({ timeout: 15_000 })
    // A page owns its viewport: every row, no inline fit and its footer, no switch to fullscreen.
    for (const name of STUB_DEFINITIONS) await expect(table.getByText(name)).toBeVisible()
    await expect(page.getByText(/of 3 shown/)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Fullscreen" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "All processes", exact: true })).toHaveCount(1)
    // The page called the view tool itself, once, with its arguments.
    expect(calls.filter((call) => call.name === "engine_open_cockpit")).toEqual([
      { name: "engine_open_cockpit", arguments: OVERVIEW_ARGS },
    ])
    // The locale gate resolved the browser's language and wrote it on the document.
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    expect(errors).toEqual([])

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })

  test("a section of the cockpit reads its feed through the page's caller", async ({ page }) => {
    const calls = recordCalls(page)
    await openPage(page, { args: OVERVIEW_ARGS })
    const sections = page.getByRole("navigation", { name: "Cockpit sections" })
    await sections.getByRole("button", { name: "Jobs" }).click({ timeout: 15_000 })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined")).toBeVisible({ timeout: 15_000 })
    expect(
      calls.filter((call) => call.name === "engine_jobs_data").at(-1)?.arguments,
    ).toMatchObject({ engine: HEALTHY_ENGINE })
  })

  test("takes the page's language and theme, and follows a theme the page switches", async ({
    page,
  }) => {
    await openPage(page, { args: OVERVIEW_ARGS, lang: "de-DE", theme: "dark" })
    await expect(page.getByRole("heading", { name: "Alle Prozesse", exact: true })).toHaveCount(1, {
      timeout: 15_000,
    })
    const html = page.locator("html")
    await expect(html).toHaveAttribute("data-theme", "dark")
    await expect(html).toHaveClass(/\bdark\b/)
    await page.evaluate(() => document.documentElement.setAttribute("data-cd-theme", "light"))
    await expect(html).toHaveAttribute("data-theme", "light")
    await expect(html).not.toHaveClass(/\bdark\b/)
  })

  test("hides the chat's hand-offs, or offers each one's prompt to copy where the page says so", async ({
    page,
    context,
  }) => {
    await openPage(page, { args: JOBS_ARGS })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: "Assess in chat" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^Copy prompt/ })).toHaveCount(0)

    const origin = new URL(process.env.HOST_SIM_URL ?? "").origin
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin })
    await openPage(page, { args: JOBS_ARGS, followUp: "copy" })
    const copy = page.getByRole("button", { name: "Copy prompt: Assess in chat" })
    await copy.click({ timeout: 15_000 })
    await expect(page.getByText("Prompt copied. Paste it into your chat.")).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain(`engine="${HEALTHY_ENGINE}"`)
    // A row's menu holds its hand-offs to copy.
    await expect(jobs.getByRole("button", { name: /^More actions/ }).first()).toBeVisible()
  })

  test("shows no menu, column or section that would hold hidden hand-offs only", async ({
    page,
  }) => {
    await openPage(page, { args: JOBS_ARGS })
    const jobs = page.getByRole("region", { name: "Jobs", exact: true })
    await expect(jobs.getByText("Card declined")).toBeVisible({ timeout: 15_000 })
    // A failed job's menu holds two hand-offs and nothing else: no menu button that opens empty,
    // and with no retry on a read-only deployment, no actions column that no row fills.
    await expect(page.getByRole("button", { name: /^More actions/ })).toHaveCount(0)
    await expect(jobs.getByRole("columnheader", { name: "Actions" })).toHaveCount(0)

    // The fleet's analyses are hand-offs only: the section goes with them, its heading too.
    await openPage(page, { args: {} })
    await page.getByRole("button", { name: "Cross-engine overview" }).click({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Cross-engine overview" })).toBeVisible()
    await expect(page.getByText("Analyses across all engines")).toHaveCount(0)
    await expect(page.getByText("the AI runs these analyses in the chat")).toHaveCount(0)
  })

  test("the page's script holds no MCP Apps runtime, which the chat's bundle does", () => {
    const script = process.env[PAGE_SCRIPT_ENV]
    if (!script)
      throw new Error(`${PAGE_SCRIPT_ENV} is unset. Run via \`playwright test -c test-host\``)
    // The handshake every ext-apps `App` sends first.
    const handshake = "ui/initialize"
    expect(readFileSync(script, "utf8")).not.toContain(handshake)
    expect(readFileSync(path.join(APP, "dist", "mcp-app.js"), "utf8")).toContain(handshake)
  })
})
