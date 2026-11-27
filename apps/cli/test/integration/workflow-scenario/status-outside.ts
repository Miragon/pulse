/**
 * The status triage of a root incident outside any process on the real engine (owner decision of
 * 2026-11-26): a batch that sets the retries of a job no engine holds fails by itself, until its
 * retries are used up, into an incident without version, element or instance. No definition
 * counts it; `pulse status` judges it with the definitions' root incidents and names it apart,
 * `outsideAnyProcess` in its JSON and a row of its own in its table, read whole.
 */

import { expect, it } from "vitest"
import { expectSuccess } from "../support/expect.js"
import type { WorkflowScenario } from "./suite.js"

/** A job id no engine assigns, which the failing batch sets the retries of. */
const UNKNOWN_JOB = "00000000-0000-4000-8000-000000000135"

/** How long the engine may take to use up the batch job's retries. */
const SETTLES_WITHIN_MS = 120_000

interface Triage {
  readonly definitions: readonly { readonly incidents: number }[]
  readonly rootIncidentsTotal: number
  readonly outsideAnyProcess?: { readonly count: number; readonly atLeast: boolean }
}

/** The JSON answer of a request to the engine's REST API; fails on an error answer. */
async function rest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

/** Polls the batch's incidents until it raised one; fails past SETTLES_WITHIN_MS. */
async function raised(url: string, jobDefinitionId: string): Promise<void> {
  const deadline = Date.now() + SETTLES_WITHIN_MS
  for (;;) {
    const incidents = await rest<unknown[]>(`${url}/incident?jobDefinitionIdIn=${jobDefinitionId}`)
    if (incidents.length > 0) return
    if (Date.now() > deadline) throw new Error("the batch raised no incident")
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

export function registerStatusOutside(scenario: WorkflowScenario): void {
  const { cli } = scenario

  it("judges a batch's incident outside any process and names it apart, in JSON and the table", async () => {
    const url = scenario.url()
    const batch = await rest<{ id: string; batchJobDefinitionId: string }>(
      `${url}/job/retries`,
      "POST",
      { jobIds: [UNKNOWN_JOB], retries: 1 },
    )
    try {
      await raised(url, batch.batchJobDefinitionId)
      const triage = expectSuccess(await cli(["status"])).json<Triage>()
      const ofDefinitions = triage.definitions.reduce((sum, row) => sum + row.incidents, 0)
      expect(triage.outsideAnyProcess).toEqual({ count: 1, atLeast: false })
      expect(triage.rootIncidentsTotal).toBe(ofDefinitions + 1)
      const table = expectSuccess(await cli(["status", "-o", "table"]))
      expect(table.stdout).toMatch(/\nOutside any process {2}1 root incident\n/)
      expect(table.stdout).toMatch(
        new RegExp(`\\nIncidents +\\d+ open, ${String(ofDefinitions)} root in processes, `),
      )
    } finally {
      await rest(`${url}/batch/${batch.id}?cascade=true`, "DELETE")
    }
  }, 180_000)
}
