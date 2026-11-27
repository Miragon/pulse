/**
 * The law of an activity's page of incidents (`engine_activity_incidents_data`, #690) that
 * c7-runtime.engine.test.ts runs last on its seeded engine, on what it deploys and starts itself and
 * removes again, so the world, its other cases and the recorded board stay as they are. One
 * instance's 60 items of a parallel multi-instance external task wait, and a request sets their
 * retries to 0 (`PUT /external-task/retries`), which raises their root incidents in one command,
 * many of them in the same millisecond. Ten callers wait at a call activity for an external task of
 * the process they called, whose retries one request sets to 0 too: a root incident in each called
 * instance and its copy at the call activity, beside two incidents of the call activity's own
 * raised before them and two after. Read page by page by the feed's cursor, pages of one and of
 * seven list every root incident once, newest first and then by id, as the engine's own list holds
 * them: at the external task each incident, at the call activity its own incidents alone, past the
 * copies between them. A first page with more totals them as the element's group counts them, by
 * the key's scan, which holds the key's incidents; one read whole totals its rows; a later page
 * answers none.
 */

import { isRootIncident } from "@miragon/pulse-c7-core"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import { expect } from "vitest"
import { buildActivityIncidentsData } from "../../data/activity-incidents-data.js"
import type { ResolvedEngine } from "../engine/resolve-engine.js"
import type { ContractSuite } from "./contract-cases.test-support.js"

const ITEMS_PROCESS = "pulse-activity-page"
const CALLER = "pulse-activity-page-caller"
const CALLED = "pulse-activity-page-called"
const WORK = "Task_Work"
const CALL = "Call_Work"
/** The items whose incidents the case raises at once. */
const ITEMS = 60
/** The callers whose called instances' incidents the case raises at once. */
const CALLERS = 10
/** The incidents of the call activity's own, half before the copies and half after. */
const OWN = 4

/** An external task that no worker fetches, so it waits until the case sets its retries. */
const externalTask = (id: string, loop = "") =>
  `<bpmn:serviceTask id="${id}" camunda:type="external" camunda:topic="pulse-activity-page">${loop}</bpmn:serviceTask>`

/** A process of a start event, the element `id` and an end event, its other ids by `prefix`. */
const processOf = (process: string, prefix: string, id: string, element: string) => `
  <bpmn:process id="${process}" isExecutable="true" camunda:historyTimeToLive="1">
    <bpmn:startEvent id="${prefix}_Start" />
    <bpmn:sequenceFlow id="${prefix}_In" sourceRef="${prefix}_Start" targetRef="${id}" />
    ${element}
    <bpmn:sequenceFlow id="${prefix}_Out" sourceRef="${id}" targetRef="${prefix}_End" />
    <bpmn:endEvent id="${prefix}_End" />
  </bpmn:process>`

const EACH_ITEM = `<bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality>\${items}</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>`

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_ActivityPage" targetNamespace="http://bpmn.io/schema/bpmn">
  ${processOf(ITEMS_PROCESS, "Items", WORK, externalTask(WORK, EACH_ITEM))}
  ${processOf(CALLED, "Called", "Task_Called", externalTask("Task_Called"))}
  ${processOf(CALLER, "Caller", CALL, `<bpmn:callActivity id="${CALL}" calledElement="${CALLED}" />`)}
</bpmn:definitions>`

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

async function deploy(url: string): Promise<string> {
  const form = new FormData()
  form.append("deployment-name", ITEMS_PROCESS)
  form.append("model", new Blob([XML], { type: "text/xml" }), "activity-page.bpmn")
  const response = await fetch(`${url}/deployment/create`, { method: "POST", body: form })
  if (!response.ok) throw new Error(`deploying ${ITEMS_PROCESS}: HTTP ${response.status}`)
  return ((await response.json()) as { id: string }).id
}

interface IncidentAnswer {
  readonly id: string
  readonly incidentTimestamp: string
  readonly rootCauseIncidentId: string | null
}

/** The engine's own list of the incidents at `activityId` of `key`, every one of them. */
function incidentsAt(url: string, key: string, activityId: string): Promise<IncidentAnswer[]> {
  return call(`${url}/incident?processDefinitionKeyIn=${key}&activityId=${activityId}`)
}

/** An instant as the engine writes it (`+0000`), as an epoch millisecond. */
const millisOf = (timestamp: string) =>
  Date.parse(timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))

/** The root incidents of `rows` in the page's order: the newer first, then by id. */
function pageOrderOf(rows: readonly IncidentAnswer[]): string[] {
  return rows
    .filter((row) => isRootIncident(row))
    .sort(
      (a, b) =>
        millisOf(b.incidentTimestamp) - millisOf(a.incidentTimestamp) || (a.id < b.id ? -1 : 1),
    )
    .map((row) => row.id)
}

/** Sets the retries of the external tasks of `key` to 0 in one request: an incident each. */
async function failTasksOf(url: string, key: string, count: number): Promise<void> {
  const tasks = await call<{ id: string }[]>(
    `${url}/external-task?processDefinitionKey=${key}&maxResults=${count}`,
  )
  expect(tasks).toHaveLength(count)
  await call(`${url}/external-task/retries`, "PUT", {
    externalTaskIds: tasks.map((task) => task.id),
    retries: 0,
  })
}

/** An incident of the call activity's own at each of `executions`, callers waiting there. */
async function ownIncidents(url: string, executions: readonly { id: string }[]): Promise<void> {
  for (const execution of executions) {
    await call(`${url}/execution/${execution.id}/create-incident`, "POST", {
      incidentType: "pulseActivityPage",
      configuration: "the activity page's case",
    })
  }
}

/** Starts the instances and raises the incidents, the call activity's own around the copies. */
async function raiseIncidents(url: string): Promise<void> {
  const start = (key: string, variables = {}) =>
    call(`${url}/process-definition/key/${key}/start`, "POST", { variables })
  await start(ITEMS_PROCESS, { items: { value: ITEMS, type: "Integer" } })
  await Promise.all(Array.from({ length: CALLERS }, () => start(CALLER)))
  await failTasksOf(url, ITEMS_PROCESS, ITEMS)
  const callers = await call<{ id: string }[]>(
    `${url}/execution?processDefinitionKey=${CALLER}&activityId=${CALL}&maxResults=${OWN}`,
  )
  await ownIncidents(url, callers.slice(0, OWN / 2))
  await failTasksOf(url, CALLED, CALLERS)
  await ownIncidents(url, callers.slice(OWN / 2))
}

/** The ids of every page of `activityId` from the first on, each by the `next` of the one before. */
async function walk(
  engine: ResolvedEngine,
  target: { processDefinitionKey: string; activityId: string; maxResults: number },
) {
  const ids: string[] = []
  const totals: (number | null)[] = []
  let after: string | null = null
  do {
    const page = await buildActivityIncidentsData(engine.client, {
      baseUrl: engine.baseUrl,
      cockpitUrl: engine.cockpitUrl,
      provider: engine.provider,
      ...target,
      ...(after === null ? {} : { after }),
    })
    ids.push(...page.incidents.map((incident) => incident.id))
    totals.push(page.totalCount)
    after = page.next
  } while (after !== null && ids.length <= 2 * ITEMS)
  return { ids, first: totals[0], later: [...new Set(totals.slice(1))] }
}

async function eachRootIncidentOnce(suite: ContractSuite): Promise<void> {
  const { url, resolve } = suite
  const deploymentId = await deploy(url)
  try {
    await raiseIncidents(url)
    const engine = resolve(C7_BOARD_ENGINE.engine)
    const [atWork, atCall] = await Promise.all([
      incidentsAt(url, ITEMS_PROCESS, WORK),
      incidentsAt(url, CALLER, CALL),
    ])
    // Raised in one command: the engine stamps many of them with the same millisecond.
    expect(new Set(atWork.map((row) => row.incidentTimestamp)).size).toBeLessThan(ITEMS)
    expect(atCall).toHaveLength(CALLERS + OWN)
    for (const maxResults of [1, 7]) {
      const items = { processDefinitionKey: ITEMS_PROCESS, activityId: WORK, maxResults }
      const own = { processDefinitionKey: CALLER, activityId: CALL, maxResults }
      expect(await walk(engine, items), `pages of ${maxResults}`).toEqual({
        ids: pageOrderOf(atWork),
        first: ITEMS,
        later: [null],
      })
      expect(await walk(engine, own), `pages of ${maxResults}`).toEqual({
        ids: pageOrderOf(atCall),
        first: OWN,
        later: maxResults < OWN ? [null] : [],
      })
    }
  } finally {
    await call(`${url}/deployment/${deploymentId}?cascade=true`, "DELETE")
  }
}

/** The case by its name, over the seeded engine. */
export const ACTIVITY_PAGE_CASES: ReadonlyArray<
  readonly [string, (suite: ContractSuite) => Promise<void>]
> = [
  [
    "contract: an activity's page lists each root incident once by its cursor, where many were raised at one instant",
    eachRootIncidentOnce,
  ],
]
