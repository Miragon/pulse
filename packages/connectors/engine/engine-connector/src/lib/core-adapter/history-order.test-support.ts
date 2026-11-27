/**
 * The history's one order of an instance (#690), a case c7-runtime.engine.test.ts runs on its
 * seeded engine, on what it deploys and starts itself and removes again, so the world, the other
 * cases and the recorded board stay as they are: an instance whose parallel multi-instance user
 * task starts more items than a page of 500 holds, all within a few milliseconds, each item
 * assigned to a user of its own. The engine takes `POST /history/activity-instance` with c7-core's
 * `INSTANCE_HISTORY_ORDER` (start, occurrence, activity instance id), pages of it cut by offset
 * hold every step once and in the order of one read of them all, and so do the path c7-core's
 * `loadInstance` reads for the CLI's `inspect --history` and the contract's instance detail, and
 * the cockpit's history as its widget pages it: the feed's first page, then the registrar's
 * history query sorted by start from where it ended, whose date filters the engine takes in its
 * POST body. On the seeded world itself, the paths of DSP-3001 and of the instance it called come in the order
 * c7-core's recorded screen engine (`C7_SCREEN_ENGINE`) answers them, whose requests ask for it.
 */

import { INSTANCE_HISTORY_ORDER, loadInstance } from "@miragon/pulse-c7-core"
import { C7_BOARD_ENGINE, C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import { InstanceId } from "@miragon/pulse-engine-core"
import { expect } from "vitest"
import { buildHistoryTimelineData } from "../../data/history-timeline-data.js"
import { providerForEntry } from "../../providers/index.js"
import { registerTools } from "../../tools/index.js"
import { callTool, captureTools } from "../../tools/test-support/fake-engine.js"
import { createEngineRegistry } from "../engine/resolve-engine.js"
import type { ContractSuite } from "./contract-cases.test-support.js"
import { enginePortFor } from "./engine-port.js"

const PROCESS = "pulse-history-order"
const REVIEW = "Activity_Review"
/** More items than a page of 500, so a path read whole takes two pages. */
const ITEMS = 520
/** The steps of the instance: its start event, the multi-instance body and every item. */
const STEPS = ITEMS + 2
/** A page of the offset read, as a list of the cockpit asks for. */
const PAGE = 100

/** Each item waits at its own user task, assigned to a user of its own. */
const HISTORY_ORDER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_HistoryOrder" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PROCESS}" name="History order" isExecutable="true" camunda:historyTimeToLive="1">
    <bpmn:startEvent id="Event_Start" />
    <bpmn:sequenceFlow id="Flow_StartToReview" sourceRef="Event_Start" targetRef="${REVIEW}" />
    <bpmn:userTask id="${REVIEW}" name="Review" camunda:assignee="reviewer-\${loopCounter}">
      <bpmn:multiInstanceLoopCharacteristics>
        <bpmn:loopCardinality>${String(ITEMS)}</bpmn:loopCardinality>
      </bpmn:multiInstanceLoopCharacteristics>
    </bpmn:userTask>
    <bpmn:sequenceFlow id="Flow_ReviewToEnd" sourceRef="${REVIEW}" targetRef="Event_End" />
    <bpmn:endEvent id="Event_End" />
  </bpmn:process>
</bpmn:definitions>`

/** A step of the history as the engine answers it. */
interface HistoricStep {
  readonly id: string
  readonly activityId: string
  readonly startTime: string
  readonly assignee: string | null
}

/** The JSON answer of a request the case sends itself, over the REST API without the SDK. */
async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(`${method} ${url}: HTTP ${response.status}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

interface Started {
  readonly deploymentId: string
  readonly instanceId: string
}

/** Deploys the process and starts one instance; its items start in the same transaction. */
async function startInstance(url: string): Promise<Started> {
  const form = new FormData()
  form.append("deployment-name", PROCESS)
  form.append("model", new Blob([HISTORY_ORDER_XML], { type: "text/xml" }), "history.bpmn")
  const response = await fetch(`${url}/deployment/create`, { method: "POST", body: form })
  if (!response.ok) throw new Error(`deploying ${PROCESS}: HTTP ${response.status}`)
  const deployed = (await response.json()) as {
    id: string
    deployedProcessDefinitions: Record<string, { id: string }>
  }
  const [definition] = Object.values(deployed.deployedProcessDefinitions)
  if (definition === undefined) throw new Error(`deploying ${PROCESS} created no version`)
  const started = await call<{ id: string }>(
    `${url}/process-definition/${definition.id}/start`,
    "POST",
    {},
  )
  return { deploymentId: deployed.id, instanceId: started.id }
}

/** The instance's steps in the history's order, `maxResults` of them from `firstResult`. */
function historyWindow(url: string, instanceId: string, firstResult: number, maxResults: number) {
  return call<HistoricStep[]>(
    `${url}/history/activity-instance?firstResult=${String(firstResult)}&maxResults=${String(maxResults)}`,
    "POST",
    { processInstanceId: instanceId, sorting: INSTANCE_HISTORY_ORDER },
  )
}

/** The instance's steps page by page, `PAGE` at a time, until a page holds fewer. */
async function pagedHistory(url: string, instanceId: string): Promise<HistoricStep[]> {
  const steps: HistoricStep[] = []
  for (;;) {
    const page = await historyWindow(url, instanceId, steps.length, PAGE)
    steps.push(...page)
    if (page.length < PAGE) return steps
  }
}

/** Each item's user once, and the start of every step at or after the one before. */
function expectEveryStepOnce(steps: readonly HistoricStep[]): void {
  const users = steps.flatMap(({ assignee }) => (assignee === null ? [] : [assignee]))
  expect(new Set(users).size).toBe(ITEMS)
  expect(users).toHaveLength(ITEMS)
  const starts = steps.map(({ startTime }) => Date.parse(startTime))
  expect(starts).toEqual([...starts].sort((left, right) => left - right))
}

/** The registrar's history query, which the cockpit's history pages through after its first page. */
const HISTORY_QUERY = captureTools((register) => registerTools(register)).get(
  "engine_query_historic_activity_instances",
)

/** A page of the registrar's history query: its rows and the count of all. */
interface QueryPage {
  readonly items: readonly { readonly id: string }[]
  readonly totalCount: number
}

/** The registrar's history query on the engine at `url`, called as a model or a view calls it. */
function historyQueryAt(url: string): (args: Record<string, unknown>) => Promise<QueryPage> {
  const query = HISTORY_QUERY
  if (query === undefined) throw new Error("the history query is not registered")
  const registry = createEngineRegistry([{ id: "history", baseUrl: url }], (entry) =>
    providerForEntry(entry).createClient(entry, { type: "none" }),
  )
  return async (args) => (await callTool(query, registry, args)) as QueryPage
}

/** The ids of the cockpit's history of `instanceId`, as its widget pages it, and their count. */
async function cockpitHistory(suite: ContractSuite, instanceId: string) {
  const client = suite.resolve(C7_BOARD_ENGINE.engine).client
  const first = await buildHistoryTimelineData(client, "history", {
    processInstanceId: instanceId,
    maxResults: PAGE,
  })
  const query = historyQueryAt(suite.url)
  const ids = first.activities.map(({ id }) => id)
  for (let page = ids; page.length === PAGE && ids.length < first.totalActivities;) {
    const next = await query({
      processInstanceId: instanceId,
      sortBy: "startTime",
      sortOrder: "asc",
      firstResult: ids.length,
      maxResults: PAGE,
    })
    page = next.items.map(({ id }) => id)
    ids.push(...page)
  }
  return { ids, total: first.totalActivities }
}

/**
 * The query's filters reach its POST body in the engine's date format, which the engine takes: a
 * window around every step holds them all, one before them none.
 */
async function expectDateWindows(url: string, instanceId: string): Promise<void> {
  const query = historyQueryAt(url)
  const window = { processInstanceId: instanceId, maxResults: PAGE }
  const around = await query({ ...window, startedAfter: "2000-01-01", startedBefore: "2999-01-01" })
  expect([around.items.length, around.totalCount]).toEqual([PAGE, STEPS])
  const before = await query({ ...window, startedBefore: "2000-01-01T00:00:00Z" })
  expect([before.items.length, before.totalCount]).toEqual([0, 0])
}

async function historyInOneOrder(suite: ContractSuite): Promise<void> {
  const { url, runtime, resolve } = suite
  const { deploymentId, instanceId } = await startInstance(url)
  try {
    const whole = await historyWindow(url, instanceId, 0, 2 * STEPS)
    expect(whole).toHaveLength(STEPS)
    expectEveryStepOnce(whole)
    // Pages cut by offset hold every step once, in the order of one read of them all.
    expect((await pagedHistory(url, instanceId)).map(({ id }) => id)).toEqual(
      whole.map(({ id }) => id),
    )
    const byStep = whole.map(({ activityId, assignee }) => [activityId, assignee ?? undefined])
    const client = resolve(C7_BOARD_ENGINE.engine).client
    const inspected = await loadInstance(enginePortFor(client), instanceId, {
      variables: false,
      history: true,
      stacktrace: false,
    })
    expect(inspected.timeline?.map(({ activityId, assignee }) => [activityId, assignee])).toEqual(
      byStep,
    )
    const detail = await runtime.getInstanceDetail(InstanceId(instanceId))
    expect(detail?.path.map(({ elementId }) => elementId)).toEqual(
      whole.map(({ activityId }) => activityId),
    )
    expect(await cockpitHistory(suite, instanceId)).toEqual({
      ids: whole.map(({ id }) => id),
      total: STEPS,
    })
    await expectDateWindows(url, instanceId)
  } finally {
    await call(`${url}/deployment/${deploymentId}?cascade=true`, "DELETE")
  }
}

/** A step of the history with the version it ran in, as the engine answers it. */
interface VersionedStep {
  readonly activityId: string
  readonly processDefinitionKey: string
}

/** The elements of each path the recorded screen engine answers, by the process it ran in. */
function recordedPaths(): Map<string, string[]> {
  const paths = C7_SCREEN_ENGINE.answers
    .filter(({ method, path }) => method === "POST" && path.endsWith("/history/activity-instance"))
    .map((recorded) => ("answer" in recorded ? (recorded.answer as VersionedStep[]) : []))
  return new Map(
    paths.map((steps) => [
      steps[0]?.processDefinitionKey ?? "none",
      steps.map(({ activityId }) => activityId),
    ]),
  )
}

/** The elements of `instanceId`'s path, in the history's order, from the engine itself. */
async function enginePath(url: string, instanceId: string): Promise<string[]> {
  const steps = await historyWindow(url, instanceId, 0, PAGE)
  return steps.map(({ activityId }) => activityId)
}

async function recordedPathsInOrder(suite: ContractSuite): Promise<void> {
  const { url } = suite
  const [dispatch] = await call<{ id: string }[]>(`${url}/process-instance?businessKey=DSP-3001`)
  if (dispatch === undefined) throw new Error("the world holds no DSP-3001")
  const [label] = await call<{ id: string }[]>(
    `${url}/process-instance?superProcessInstance=${dispatch.id}`,
  )
  if (label === undefined) throw new Error("DSP-3001 called no instance")
  const recorded = recordedPaths()
  expect([...recorded.keys()].sort()).toEqual(["pulse-dispatch", "pulse-label"])
  expect(await enginePath(url, dispatch.id)).toEqual(recorded.get("pulse-dispatch"))
  expect(await enginePath(url, label.id)).toEqual(recorded.get("pulse-label"))
}

/** Each case by its name, over the seeded engine. */
export const HISTORY_ORDER_CASES: ReadonlyArray<
  readonly [string, (suite: ContractSuite) => Promise<void>]
> = [
  [
    "history: an instance's steps come in one total order, each once across pages of any size",
    historyInOneOrder,
  ],
  [
    "history: the paths of DSP-3001 and the instance it called come as the recorded screen engine holds them",
    recordedPathsInOrder,
  ],
]
