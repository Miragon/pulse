/**
 * The status triage over more open incidents than one request holds, on the real engine: 2,001
 * incidents of one instance, created in parallel at the 16 executions of a parallel multi-instance
 * user task (one execution takes one write at a time), so that some are raised in the same
 * millisecond, each of a type of its own, so that each is a group of its own. The law proves what
 * the walk takes from the engine, not that it lists each incident once where ties turn (an engine's
 * database may keep their order between requests, so c7-core's tests turn them): ties occur;
 * `incidentTimestampBefore` reads the engine's format and means strictly before, so the bound the
 * walk sets, a millisecond after the newest, keeps every incident; and `pulse status` loads the
 * newest 2,000 in requests of at most 500 rows, every one after the first bounded so, with no group
 * counting an incident twice, the cut named and the counts read over the whole scope.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { argv, globalFlag } from "../support/catalog.js"
import { expectSuccess } from "../support/expect.js"
import type { WorkflowScenario } from "./suite.js"

const KEY = "tied-incidents"

const BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="tied" targetNamespace="https://example.com/tied">
  <bpmn:process id="${KEY}" isExecutable="true" camunda:historyTimeToLive="1">
    <bpmn:startEvent id="tied-start" /><bpmn:sequenceFlow id="t1" sourceRef="tied-start" targetRef="hold" />
    <bpmn:userTask id="hold" name="Hold">
      <bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality>16</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>
    </bpmn:userTask>
    <bpmn:sequenceFlow id="t2" sourceRef="hold" targetRef="tied-done" />
    <bpmn:endEvent id="tied-done" />
  </bpmn:process>
</bpmn:definitions>
`

/** One more than the triage loads. */
const OPEN = 2001

interface Triage {
  readonly incidents: readonly { readonly count: number }[]
  readonly rootIncidentsTotal: number
  readonly incidentsTotal: number
  readonly propagated: number
  readonly truncated?: readonly string[]
}

/** The JSON answer of a request to the engine's REST API; fails on an error answer. */
async function rest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

/**
 * OPEN incidents at `executions`, each execution's one after the other, all executions at once; the
 * n-th of the type `pulseTie<n>`.
 */
async function createIncidents(engineUrl: string, executions: readonly string[]): Promise<void> {
  const ofExecution = async (executionId: string, at: number) => {
    for (let index = at; index < OPEN; index += executions.length) {
      await rest(`${engineUrl}/execution/${executionId}/create-incident`, {
        incidentType: `pulseTie${String(index)}`,
        configuration: `the status law's incident ${String(index)}`,
        message: "raised by the status law",
      })
    }
  }
  await Promise.all(executions.map(ofExecution))
}

/** The query of each incident list request in a `--verbose` trace. */
const incidentRequests = (stderr: string) =>
  [...stderr.matchAll(/^> GET (\S+\/incident\?\S*)$/gm)].map(
    (match) => new URL(match[1] ?? "").searchParams,
  )

/** The engine's timestamp a millisecond later, in UTC, as the walk writes it. */
const justAfter = (timestamp: string) =>
  new Date(Date.parse(timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) + 1)
    .toISOString()
    .replace("Z", "+0000")

const SCOPE = `processDefinitionKeyIn=${KEY}`

/** The timestamps of the law's open incidents, newest first. */
const instantsOf = async (url: string) =>
  (
    await rest<{ incidentTimestamp: string }[]>(
      `${url}/incident?${SCOPE}&sortBy=incidentTimestamp&sortOrder=desc`,
    )
  ).map((incident) => incident.incidentTimestamp)

/** How many of the law's open incidents `incidentTimestampBefore=<timestamp>` lists. */
const countBefore = async (url: string, timestamp: string) =>
  (
    await rest<{ count: number }>(
      `${url}/incident/count?${SCOPE}&incidentTimestampBefore=${encodeURIComponent(timestamp)}`,
    )
  ).count

export function registerStatusIncidents(scenario: WorkflowScenario): void {
  const { cli } = scenario

  it("loads the newest 2,000 of 2,001 incidents in requests of at most 500 rows, bounded after the first", async () => {
    const dir = join(scenario.workdir(), "tied")
    await mkdir(dir)
    await writeFile(join(dir, "tied.bpmn"), BPMN)
    expectSuccess(await cli(["deploy", dir, "--name", "tied"]))
    const started = expectSuccess(await cli(argv("process-definition start", [KEY], {}))).json<{
      id: string
    }>()
    const url = scenario.url()
    const executions = await rest<{ id: string }[]>(
      `${url}/execution?processInstanceId=${started.id}&activityId=hold`,
    )
    expect(executions).toHaveLength(16)
    await createIncidents(
      url,
      executions.map((execution) => execution.id),
    )
    const instants = await instantsOf(url)
    expect(instants).toHaveLength(OPEN)
    // incidents raised in one millisecond tie
    expect(new Set(instants).size).toBeLessThan(OPEN)
    // strictly before, in the engine's format: the bound a millisecond after the newest keeps all
    const newest = instants[0] ?? ""
    const atNewest = instants.filter((instant) => instant === newest).length
    expect(await countBefore(url, newest)).toBe(OPEN - atNewest)
    const bound = justAfter(newest)
    expect(await countBefore(url, bound)).toBe(OPEN)

    const status = expectSuccess(
      await cli(["status", "--process-definition-key", KEY, globalFlag("verbose")]),
    )
    const triage = status.json<Triage>()
    expect(triage).toMatchObject({ incidentsTotal: OPEN, rootIncidentsTotal: OPEN, propagated: 0 })
    expect(triage.incidents[0]?.count).toBe(1)
    expect(triage.truncated).toEqual([
      "incidents: 2000 of 2001 loaded",
      "incident groups: 10 of 2000 shown",
    ])
    const [first, ...later] = incidentRequests(status.stderr)
    expect(first?.has("incidentTimestampBefore")).toBe(false)
    expect(later.length).toBeGreaterThanOrEqual(4)
    expect(later.map((query) => query.get("incidentTimestampBefore"))).toStrictEqual(
      later.map(() => bound),
    )
    const windows = [first, ...later].map((query) => Number(query?.get("maxResults")))
    expect(Math.max(...windows)).toBe(500)
    expectSuccess(await cli(argv("process-instance delete", [started.id], { yes: true })))
  }, 180_000)
}
