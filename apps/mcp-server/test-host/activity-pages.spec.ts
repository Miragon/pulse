import { expect, test, type FrameLocator, type Page } from "@playwright/test"
import { HEALTHY_ENGINE } from "./engines.js"

/**
 * An activity group of the process route pages its incidents by the feed's cursor (#690), through
 * the built bundle: the first page without one, Load more with the `next` of the page before, the
 * rows of each page after those shown, until a page names none.
 */

const PROCESS_ARGS = {
  engine: HEALTHY_ENGINE,
  view: "process-detail",
  processDefinitionKey: "invoice",
}

/** The incidents at `approveInvoice`, 12 of them, newest first. */
const ROWS = Array.from({ length: 12 }, (_, index) => ({
  id: `inc-approve-${index}`,
  processInstanceId: `7f3c2a9${String(index).padStart(2, "0")}-5b0e-4c1d-9a77-2e6b8d4f1c00`,
  businessKey: `INV-2026-${String(41 + index).padStart(4, "0")}`,
  incidentType: "failedJob",
  incidentMessage: "Approver lookup failed",
  incidentTimestamp: "2026-10-10T08:00:00.000+0000",
  activityId: "approveInvoice",
  activityName: "Approve Invoice",
  recovery: { action: "retry-job", jobId: `job-${index}` },
  cockpitInstanceUrl: null,
}))

/** Each page by the cursor it is asked with: the first ten rows, then the last two. */
const PAGES: Readonly<Record<string, { from: number; to: number; next: string | null }>> = {
  "": { from: 0, to: 10, next: "10,-" },
  "10,-": { from: 10, to: 12, next: null },
}

/** The process route's one activity group over the pages above; the feed's calls, as sent. */
async function pagedIncidents(page: Page): Promise<Record<string, unknown>[]> {
  const asked: Record<string, unknown>[] = []
  const result = (structuredContent: unknown) => ({
    json: { result: { structuredContent, content: [{ type: "text", text: "{}" }] } },
  })
  let definition: Record<string, unknown> | null = null
  await page.route("**/host/call", async (route) => {
    const call = route.request().postDataJSON() as {
      name: string
      arguments: Record<string, unknown>
    }
    if (call.name === "engine_open_cockpit") {
      const json = (await (await route.fetch()).json()) as {
        result: { structuredContent: { start: { data: Record<string, unknown> } } }
      }
      const start = json.result.structuredContent.start
      const activity = {
        activityId: "approveInvoice",
        activityName: "Approve Invoice",
        representativeMessage: "Approver lookup failed",
        firstSeen: null,
        latestIncident: "2026-10-10T08:00:00.000+0000",
        incidentCount: ROWS.length,
      }
      definition = { ...start.data, incidentCount: ROWS.length, activities: [activity] }
      start.data = definition
      return route.fulfill({ json })
    }
    if (call.name === "engine_process_incidents_data" && definition) {
      return route.fulfill(result(definition))
    }
    if (call.name === "engine_activity_incidents_data") {
      asked.push(call.arguments)
      const after = typeof call.arguments.after === "string" ? call.arguments.after : ""
      const { from, to, next } = PAGES[after] ?? { from: 0, to: 0, next: null }
      return route.fulfill(
        result({
          processDefinitionKey: "invoice",
          activityId: "approveInvoice",
          incidents: ROWS.slice(from, to),
          // The first page counts; a later one answers none.
          totalCount: after === "" ? ROWS.length : null,
          next,
          engineId: HEALTHY_ENGINE,
        }),
      )
    }
    return route.continue()
  })
  return asked
}

async function openProcess(page: Page): Promise<FrameLocator> {
  const base = process.env.HOST_SIM_URL
  if (!base) throw new Error("HOST_SIM_URL is unset. Run via `playwright test -c test-host`")
  const query = new URLSearchParams({
    tool: "engine_open_cockpit",
    args: JSON.stringify(PROCESS_ARGS),
    structuredContent: "keep",
    resultDelayMs: "0",
    // Room for every row inline, so Load more reads the next page instead of showing more rows.
    maxHeight: "3000",
  })
  await page.goto(`${base}/?${query.toString()}`)
  return page.frameLocator("#app")
}

test("an activity group reads its next page by the cursor of the page before, until a page names none", async ({
  page,
}) => {
  const asked = await pagedIncidents(page)
  const app = await openProcess(page)
  await expect(app.getByText("Incidents by activity")).toBeVisible({ timeout: 15_000 })
  await app.locator('[data-slot="group-card-toggle"]').first().click()
  const region = app.getByRole("region", { name: "Incidents in this activity" })
  await expect(region.locator("tbody tr")).toHaveCount(10, { timeout: 15_000 })
  await expect(app.getByText("Showing 10 of 12 incidents")).toBeVisible()

  await app.getByRole("button", { name: "Load more" }).click()

  await expect(region.locator("tbody tr")).toHaveCount(12)
  await expect(region.getByText("INV-2026-0052")).toBeVisible()
  await expect(app.getByRole("button", { name: "Load more" })).toHaveCount(0)
  const paging = asked.map(({ after, maxResults, firstResult }) => ({
    after,
    maxResults,
    firstResult,
  }))
  expect(paging).toEqual([
    { after: undefined, maxResults: 10, firstResult: undefined },
    { after: "10,-", maxResults: 10, firstResult: undefined },
  ])
})
