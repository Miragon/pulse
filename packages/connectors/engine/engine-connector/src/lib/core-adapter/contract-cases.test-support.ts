/**
 * Two cases of the engine contract that c7-runtime.engine.test.ts runs on its seeded engine
 * (#689), each on what it deploys or starts itself and removes again, so the world, its other
 * cases and the recorded board stay as they are:
 *
 * - A multi-instance body on its element: a parallel multi-instance user task whose body waits
 *   asynchronously, one instance's three items waiting, another's body failing (its cardinality
 *   names no variable). Camunda 7 counts the body apart (`<id>#multiInstanceBody`), and only the
 *   token that waits at the body itself, never beside the items; the contract's counts, the chat's
 *   activity counts, the web app's process screen, a board's diagram and the incident search put
 *   the items' tokens and the body's root incident on the element of the diagram.
 * - An incident outside any process: a batch the case starts that sets the retries of a job no
 *   engine holds, so its own job fails until its retries are used up: an incident without
 *   element, instance or version, and nothing a board counts changes. The engine-wide incident
 *   search answers as before, and the recorded board builds its engine-wide incident list with
 *   the same figures.
 */

import { BoardParser } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import { BpmnProcessId, DefinitionId, type ProcessRuntime } from "@miragon/pulse-engine-core"
import { expect } from "vitest"
import { buildActivityCountsData } from "../../data/activity-counts-data.js"
import { buildBoardData } from "../../data/board-data.js"
import { buildProcessScreenData } from "../../data/screens/process-screen-data.js"
import type { ResolvedEngine } from "../engine/resolve-engine.js"
import { recordedBoard } from "./compared-boards.test-support.js"

/** The seeded engine a case runs on: its REST root, the contract's runtime, the board resolver. */
export interface ContractSuite {
  readonly url: string
  readonly runtime: ProcessRuntime
  readonly resolve: (name: string) => ResolvedEngine
}

const MULTI_PROCESS = "pulse-multi-instance"
const APPROVE_EACH = "Activity_ApproveEach"
const ITEMS = 3

/** The process of the multi-instance case: its body waits before it starts its items. */
const MULTI_INSTANCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_MultiInstance" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${MULTI_PROCESS}" name="Multi-instance" isExecutable="true" camunda:historyTimeToLive="1">
    <bpmn:startEvent id="Event_Start" />
    <bpmn:sequenceFlow id="Flow_StartToApprove" sourceRef="Event_Start" targetRef="${APPROVE_EACH}" />
    <bpmn:userTask id="${APPROVE_EACH}" name="Approve each" camunda:asyncBefore="true">
      <bpmn:multiInstanceLoopCharacteristics>
        <bpmn:loopCardinality>\${copies}</bpmn:loopCardinality>
      </bpmn:multiInstanceLoopCharacteristics>
    </bpmn:userTask>
    <bpmn:sequenceFlow id="Flow_ApproveToEnd" sourceRef="${APPROVE_EACH}" targetRef="Event_End" />
    <bpmn:endEvent id="Event_End" />
  </bpmn:process>
</bpmn:definitions>`

/** How long the engine may take to run the body's job and to use up its retries. */
const SETTLES_WITHIN_MS = 120_000
const POLL_MS = 500

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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

/** Polls `read` until `done` holds of its answer; fails past SETTLES_WITHIN_MS. */
async function settled<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + SETTLES_WITHIN_MS
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`not settled: ${JSON.stringify(value)}`)
    await wait(POLL_MS)
  }
}

interface Deployed {
  readonly deploymentId: string
  readonly definitionId: string
}

async function deployMultiInstance(url: string): Promise<Deployed> {
  const form = new FormData()
  form.append("deployment-name", MULTI_PROCESS)
  form.append("model", new Blob([MULTI_INSTANCE_XML], { type: "text/xml" }), "multi.bpmn")
  const response = await fetch(`${url}/deployment/create`, { method: "POST", body: form })
  if (!response.ok) throw new Error(`deploying ${MULTI_PROCESS}: HTTP ${response.status}`)
  const deployed = (await response.json()) as {
    id: string
    deployedProcessDefinitions: Record<string, { id: string }>
  }
  const [definition] = Object.values(deployed.deployedProcessDefinitions)
  if (definition === undefined) throw new Error(`deploying ${MULTI_PROCESS} created no version`)
  return { deploymentId: deployed.id, definitionId: definition.id }
}

interface IncidentAnswer {
  readonly id: string
  readonly activityId: string | null
  readonly processInstanceId: string | null
  readonly processDefinitionId: string | null
  readonly incidentMessage: string | null
  readonly configuration: string | null
}

interface StatisticsAnswer {
  readonly id: string
  readonly instances: number
  readonly failedJobs: number
  readonly incidents: readonly { readonly incidentCount: number }[]
}

/** The engine's own statistics of `definitionId`, per activity it reports, sorted by id. */
async function engineStatistics(url: string, definitionId: string) {
  const rows = await call<StatisticsAnswer[]>(
    `${url}/process-definition/${definitionId}/statistics?incidents=true&failedJobs=true`,
  )
  return rows
    .map(({ id, instances, failedJobs, incidents }) => ({
      id,
      instances,
      failedJobs,
      incidents: incidents.reduce((sum, { incidentCount }) => sum + incidentCount, 0),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

/** One instance's items waiting at the element, another's body failed: its incident. */
async function seedMultiInstance(url: string, definitionId: string): Promise<IncidentAnswer> {
  const start = `${url}/process-definition/${definitionId}/start`
  await call(start, "POST", { variables: { copies: { value: ITEMS, type: "Integer" } } })
  await call(start, "POST", {})
  const [tasks, incidents] = await settled(
    () =>
      Promise.all([
        call<{ count: number }>(`${url}/task/count?processDefinitionId=${definitionId}`),
        call<IncidentAnswer[]>(`${url}/incident?processDefinitionId=${definitionId}`),
      ]),
    ([open, raised]) => open.count === ITEMS && raised.length === 1,
  )
  expect(tasks.count).toBe(ITEMS)
  const [incident] = incidents
  if (incident === undefined) throw new Error("the body raised no incident")
  return incident
}

/** A board of one diagram of the multi-instance process, over the recorded board's engine. */
function diagramBoard() {
  const file = {
    schemaVersion: 1,
    title: "Multi-instance",
    engines: [C7_BOARD_ENGINE.engine],
    rows: [{ row: [{ widget: "processDiagram", props: { process: MULTI_PROCESS } }] }],
  }
  const parsed = BoardParser.parse(JSON.stringify(file))
  if (!("board" in parsed)) throw new Error(JSON.stringify(parsed.problems))
  return { id: "multi", file: "multi.board.json", board: parsed.board, notes: parsed.notes }
}

async function multiInstanceBodyOnItsElement(suite: ContractSuite): Promise<void> {
  const { url, runtime, resolve } = suite
  const { deploymentId, definitionId } = await deployMultiInstance(url)
  try {
    const incident = await seedMultiInstance(url, definitionId)
    // The engine counts the body apart, and only the token waiting there, never beside its items.
    expect(incident.activityId).toBe(`${APPROVE_EACH}#multiInstanceBody`)
    expect(await engineStatistics(url, definitionId)).toEqual([
      { id: APPROVE_EACH, instances: ITEMS, failedJobs: 0, incidents: 0 },
      { id: `${APPROVE_EACH}#multiInstanceBody`, instances: 1, failedJobs: 1, incidents: 1 },
    ])
    const onElement = { elementId: APPROVE_EACH, incidents: 1, incidentsInCalledInstances: 0 }
    expect(await runtime.getElementStatistics(DefinitionId(definitionId))).toEqual([
      { ...onElement, active: ITEMS },
    ])
    const engine = resolve(C7_BOARD_ENGINE.engine)
    const [counts, screen, board, found] = await Promise.all([
      buildActivityCountsData(engine.client, engine.engineId, {
        processDefinitionKey: MULTI_PROCESS,
      }),
      buildProcessScreenData(engine, { process: MULTI_PROCESS }),
      buildBoardData(diagramBoard(), resolve),
      runtime.searchIncidents({ bpmnProcessId: BpmnProcessId(MULTI_PROCESS) }, { limit: 10 }),
    ])
    expect(counts.activities.map((row) => row.activityId)).toEqual([APPROVE_EACH])
    expect(counts.activities[0]).toMatchObject({
      running: ITEMS,
      openTasks: ITEMS,
      incidents: 1,
      failedJobs: 1,
      latestIncident: { message: incident.incidentMessage },
    })
    expect(screen.badges).toEqual([{ ...onElement, running: ITEMS }])
    expect(board.rows.flat()).toEqual([
      expect.objectContaining({
        kind: "processDiagram",
        badges: [{ ...onElement, active: ITEMS }],
      }),
    ])
    expect(found.items).toEqual([
      expect.objectContaining({ id: incident.id, elementId: APPROVE_EACH }),
    ])
  } finally {
    await call(`${url}/deployment/${deploymentId}?cascade=true`, "DELETE")
  }
}

/** A job id no engine assigns, which the failing batch sets the retries of. */
const UNKNOWN_JOB = "00000000-0000-4000-8000-000000000689"

interface BatchAnswer {
  readonly id: string
  readonly batchJobDefinitionId: string
}

/**
 * A batch that fails by itself: it sets the retries of a job no engine holds, so its job fails
 * until its retries are used up and raises an incident without version, element or instance,
 * while nothing a board counts changes. Its incident, once raised.
 */
async function failedBatchIncident(url: string, batch: BatchAnswer): Promise<IncidentAnswer> {
  const [incident] = await settled(
    () => call<IncidentAnswer[]>(`${url}/incident?jobDefinitionIdIn=${batch.batchJobDefinitionId}`),
    (rows) => rows.length > 0,
  )
  if (incident === undefined) throw new Error(`the batch ${batch.id} raised no incident`)
  return incident
}

async function incidentOutsideAnyProcess(suite: ContractSuite): Promise<void> {
  const { url, runtime, resolve } = suite
  const board = recordedBoard(C7_BOARD_ENGINE)
  const [before, boardBefore] = await Promise.all([
    runtime.searchIncidents({}, { limit: 50 }),
    buildBoardData(board, resolve),
  ])
  const batch = await call<BatchAnswer>(`${url}/job/retries`, "POST", {
    jobIds: [UNKNOWN_JOB],
    retries: 1,
  })
  try {
    const incident = await failedBatchIncident(url, batch)
    expect(incident).toMatchObject({
      activityId: null,
      processInstanceId: null,
      processDefinitionId: null,
    })
    const [after, boardAfter] = await Promise.all([
      runtime.searchIncidents({}, { limit: 50 }),
      buildBoardData(board, resolve),
    ])
    expect(after).toEqual(before)
    // The engine-wide incident list read its incidents: a failed read holds none.
    const groups = boardAfter.rows
      .flat()
      .flatMap((tile) => (tile.kind === "incidentList" ? tile.groups : []))
    expect(groups.map((group) => group.incidents !== undefined)).toEqual([true])
    expect(BoardFigures.of(boardAfter)).toEqual(BoardFigures.of(boardBefore))
  } finally {
    await call(`${url}/batch/${batch.id}?cascade=true`, "DELETE")
  }
}

/** Each case by its name, over the seeded engine. */
export const CONTRACT_CASES: ReadonlyArray<
  readonly [string, (suite: ContractSuite) => Promise<void>]
> = [
  [
    "contract: a multi-instance body's token and root incident count on its element on every surface",
    multiInstanceBodyOnItsElement,
  ],
  [
    "contract: an incident outside any process fails no engine-wide incident search, nor the board's list",
    incidentOutsideAnyProcess,
  ],
]
