import { expect, test, type Page } from "@playwright/test"
import { HEALTHY_ENGINE } from "./engines.js"

/**
 * #341 in the BUILT bundle, behind the minimal SEP-1865 host (see
 * test-host/README.md): an in-widget write on the cockpit's START view
 * refreshes the view. The tool result the host delivered is the seed of the
 * route's feed query — not a frozen snapshot — so the write's targeted
 * invalidation re-reads the feed through the host's `tools/call` and the view
 * re-renders, without the host re-executing the rendering tool. Guards the
 * whole chain the unit suites only fake: the seed lands in the ONE query
 * client the bundle shares (vite `dedupe`), the write goes through the host,
 * the refetch reaches the server's app-only feed.
 *
 * Runs on the `engine:operations` deployment (`HOST_SIM_OPERATIONS_URL`) —
 * the read-only default offers no write — against the stub engine's failed
 * `job-1`, which this scenario owns (its other failed jobs are never written).
 */

const RENDER_TOOL = "engine_open_cockpit"

interface HostLog {
  delivered: "result" | "cancelled" | null
  toolCalls: { name: string; arguments: Record<string, unknown> }[]
  errors: string[]
}

async function hostLog(page: Page): Promise<HostLog> {
  return await page.evaluate(() => (window as unknown as { __hostLog: HostLog }).__hostLog)
}

test("a write on the cockpit's start view refetches its feed and re-renders — no re-execution", async ({
  page,
}) => {
  const base = process.env.HOST_SIM_OPERATIONS_URL
  if (!base)
    throw new Error("HOST_SIM_OPERATIONS_URL is unset — run via `playwright test -c test-host`")
  const args = { engine: HEALTHY_ENGINE, view: "jobs", failedOnly: true }
  await page.goto(
    `${base}/?${new URLSearchParams({ tool: RENDER_TOOL, args: JSON.stringify(args) }).toString()}`,
  )
  const app = page.frameLocator("#app")

  // The delivered result renders; the deployment offers the retry.
  const owned = app.getByRole("row").filter({ hasText: "Card declined" })
  await expect(owned).toBeVisible({ timeout: 15_000 })
  await owned.getByRole("button", { name: "Retry job" }).click()

  // The retried job left the failed-only list: the view re-read its feed.
  await expect(owned).toHaveCount(0)
  await expect(app.getByRole("row").filter({ hasText: "Card expired" })).toBeVisible()
  const log = await hostLog(page)
  const calls = log.toolCalls.filter((c) => c.name !== "engine_widget_actions_data")
  const write = calls.findIndex((c) => c.name === "engine_set_job_retries")
  expect(calls[write]?.arguments).toEqual({ jobId: "job-1", retries: 1, engine: HEALTHY_ENGINE })
  const refetch = calls.findIndex((c, i) => i > write && c.name === "engine_jobs_data")
  expect(refetch, "the write must refetch the seeded feed").toBeGreaterThan(write)
  expect(calls[refetch].arguments).toMatchObject({
    engine: HEALTHY_ENGINE,
    failedOnly: true,
    firstResult: 0,
  })
  // A fresh seed is not refetched on mount, and the host never re-runs the rendering tool.
  expect(calls.slice(0, write).map((c) => c.name)).not.toContain("engine_jobs_data")
  expect(calls.map((c) => c.name)).not.toContain(RENDER_TOOL)
  expect(log.errors).toEqual([])
})
