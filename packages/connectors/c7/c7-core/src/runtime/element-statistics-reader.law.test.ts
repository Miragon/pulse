/**
 * The law of the element statistics: reading the incidents at a version's call activities alone
 * gives the same counts as reading every incident of the version, on a fake engine that answers as
 * Camunda 7 does. Its statistics count every open incident at its element, copies included, and an
 * element with incidents and no token too (as Operaton 2.1.5 and CIB seven 2.2.0 answer); its
 * incidents filter by version and element, by page, those of one millisecond in no fixed order
 * unless sorted by id; a copy of a called instance's incident lies at the caller's call activity
 * and names its root, however deep that lies; a multi-instance body is an element of its own
 * (`<id>#multiInstanceBody`) whose counts lie on the activity it repeats.
 */

import { DefinitionId, type ElementStatistics } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import type { OperationInput } from "../port.js"
import { elementOfActivity } from "../multi-instance-body.js"
import { isRootIncident } from "../root-incident.js"
import { fakeFailure, fakePort, type FakePort } from "../testing/fake-port.js"
import { ElementStatisticsReader } from "./element-statistics-reader.js"

const VERSION_ID = "order:1:x"

interface WorldIncident {
  readonly id: string
  readonly activityId: string
  readonly rootCauseIncidentId: string
  readonly incidentType: string
}

interface VersionWorld {
  /** The tokens per element. */
  readonly tokens: Readonly<Record<string, number>>
  readonly incidents: readonly WorldIncident[]
  /** The deployed XML; undefined for a version the engine no longer holds. */
  readonly xml: string | undefined
}

/** A root incident raised at `activityId`. */
const root = (id: string, activityId: string, incidentType = "failedJob"): WorldIncident => ({
  id,
  activityId,
  rootCauseIncidentId: id,
  incidentType,
})

/** A copy at the call activity `activityId` of the root incident `rootId`, raised further down. */
const copy = (id: string, activityId: string, rootId: string): WorldIncident => ({
  id,
  activityId,
  rootCauseIncidentId: rootId,
  incidentType: "failedJob",
})

/** `count` incidents made by `make` from their position. */
const many = (count: number, make: (at: number) => WorldIncident) =>
  Array.from({ length: count }, (_, at) => make(at))

/** A diagram with a service task per id of `tasks` and a call activity per id of `calls`. */
function diagramOf(tasks: readonly string[], calls: readonly string[]): string {
  return [
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">',
    '<bpmn:process id="order" isExecutable="true">',
    ...tasks.map((id) => `<bpmn:serviceTask id="${id}" camunda:asyncBefore="true" />`),
    ...calls.map((id) => `<bpmn:callActivity id="${id}" calledElement="\${next}" />`),
    "</bpmn:process>",
    "</bpmn:definitions>",
  ].join("\n")
}

function elementsOf(world: VersionWorld): string[] {
  return [...new Set([...Object.keys(world.tokens), ...world.incidents.map((i) => i.activityId)])]
}

function statisticsOf(world: VersionWorld, input: OperationInput) {
  return elementsOf(world).map((id) => {
    const types = new Map<string, number>()
    for (const incident of world.incidents.filter((i) => i.activityId === id)) {
      types.set(incident.incidentType, (types.get(incident.incidentType) ?? 0) + 1)
    }
    return {
      id,
      instances: world.tokens[id] ?? 0,
      incidents:
        input.query.incidents === "true"
          ? [...types].map(([incidentType, incidentCount]) => ({ incidentType, incidentCount }))
          : [],
    }
  })
}

/**
 * The engine's list of incidents in the order asked for: by id, or by time, where incidents of the
 * same millisecond come in an order of their own on each page, as an engine may answer them.
 */
function incidentsOf(world: VersionWorld, input: OperationInput) {
  const {
    processDefinitionId,
    activityId,
    sortBy,
    firstResult = "0",
    maxResults = "500",
  } = input.query
  const first = Number(firstResult)
  const rows = world.incidents
    .map((incident) => ({ ...incident, processDefinitionId: VERSION_ID }))
    .filter((row) => row.processDefinitionId === processDefinitionId)
    .filter((row) => activityId === undefined || row.activityId === activityId)
  const ordered =
    sortBy === "incidentId"
      ? rows.sort((left, right) => (left.id < right.id ? -1 : 1))
      : first % 1000 === 0
        ? rows
        : rows.reverse()
  return ordered
    .slice(first, first + Number(maxResults))
    .map((row) => ({ ...row, incidentTimestamp: "2026-11-21T12:00:00.000+0000" }))
}

function portOf(world: VersionWorld): FakePort {
  return fakePort({
    getActivityStatistics: (input) => statisticsOf(world, input),
    getProcessDefinitionBpmn20Xml: () => {
      if (world.xml === undefined) throw fakeFailure(404, "InvalidRequestException")
      return { id: VERSION_ID, bpmn20Xml: world.xml }
    },
    getIncidents: (input) => incidentsOf(world, input),
  })
}

/**
 * The counts a read of every incident of the version gives, the law's reference: per element the
 * engine reports, then a multi-instance body's added to the activity it repeats.
 */
function wholeRead(world: VersionWorld): ElementStatistics[] {
  const byElement = new Map<string, ElementStatistics>()
  for (const activityId of elementsOf(world)) {
    const here = world.incidents.filter((incident) => incident.activityId === activityId)
    const incidents = here.filter((incident) => isRootIncident(incident)).length
    const elementId = elementOfActivity(activityId) as ElementStatistics["elementId"]
    const sum = byElement.get(elementId) ?? {
      elementId,
      active: 0,
      incidents: 0,
      incidentsInCalledInstances: 0,
    }
    byElement.set(elementId, {
      elementId,
      active: sum.active + Math.max(0, (world.tokens[activityId] ?? 0) - incidents),
      incidents: sum.incidents + incidents,
      incidentsInCalledInstances: sum.incidentsInCalledInstances + here.length - incidents,
    })
  }
  return [...byElement.values()]
}

const byElement = (statistics: readonly ElementStatistics[]) =>
  [...statistics].sort((left, right) => (left.elementId < right.elementId ? -1 : 1))

/** The counts the reader gives over `world`, and the incident reads it sent, by element. */
async function readOver(world: VersionWorld) {
  const port = portOf(world)
  const statistics = await new ElementStatisticsReader(port).of(DefinitionId(VERSION_ID))
  const incidentReads = port.calls
    .filter((call) => call.operationId === "getIncidents")
    .map((call) => `${call.input.query.activityId ?? "every"}@${call.input.query.firstResult}`)
  return { statistics, incidentReads, sent: port.calls.map((call) => call.operationId) }
}

const WORLDS: Readonly<Record<string, VersionWorld>> = {
  "a root incident at the call activity itself, a failed job before the call": {
    tokens: { Call_Label: 3, Task_Review: 1 },
    incidents: [root("r1", "Call_Label"), copy("c1", "Call_Label", "deep-1")],
    xml: diagramOf(["Task_Review"], ["Call_Label"]),
  },
  "a copy whose root lies two levels deeper": {
    tokens: { Call_Dispatch: 1 },
    incidents: [copy("c2", "Call_Dispatch", "grandchild-root")],
    xml: diagramOf([], ["Call_Dispatch"]),
  },
  "several call activities, one without incidents, beside a mass failure": {
    tokens: { Call_Label: 2, Call_Invoice: 2, Call_Quiet: 4, Task_Charge: 1 },
    incidents: [
      copy("c3", "Call_Label", "label-root"),
      root("r3", "Call_Invoice", "failedExternalTask"),
      copy("c4", "Call_Invoice", "invoice-root"),
      ...many(600, (at) => root(`r-charge-${String(at)}`, "Task_Charge")),
    ],
    xml: diagramOf(["Task_Charge"], ["Call_Label", "Call_Invoice", "Call_Quiet"]),
  },
  "a version without call activities": {
    tokens: { Task_Charge: 2, Task_Review: 5 },
    incidents: [root("r5", "Task_Charge"), root("r6", "Task_Charge", "custom")],
    xml: diagramOf(["Task_Charge", "Task_Review"], []),
  },
  "a version without incidents": {
    tokens: { Task_Review: 5, Call_Label: 1 },
    incidents: [],
    xml: diagramOf(["Task_Review"], ["Call_Label"]),
  },
  "an incident at an element without a token": {
    tokens: { Task_Review: 1 },
    incidents: [root("r7", "Event_Timeout")],
    xml: diagramOf(["Task_Review"], []),
  },
  "a version the engine no longer holds the diagram of": {
    tokens: { Call_Label: 1 },
    incidents: [copy("c5", "Call_Label", "label-root")],
    xml: undefined,
  },
  "a call activity whose id cannot be read": {
    tokens: { Call_Label: 1 },
    incidents: [copy("c6", "Call_Label", "label-root"), root("r8", "Task_Charge")],
    xml: diagramOf(["Task_Charge"], []).replace("</bpmn:process>", "<callActivity />\n$&"),
  },
  "many call activities with an incident each, fewer pages in one read": {
    tokens: {},
    incidents: many(3, (at) => copy(`c-many-${String(at)}`, `Call_${String(at)}`, "deep")),
    xml: diagramOf([], ["Call_0", "Call_1", "Call_2"]),
  },
  "two call activities with 300 incidents each, as many pages as one read of the version": {
    tokens: { Call_A: 300, Call_B: 300 },
    incidents: [
      ...many(300, (at) => copy(`c-a-${String(at)}`, "Call_A", `deep-a-${String(at)}`)),
      ...many(300, (at) => copy(`c-b-${String(at)}`, "Call_B", `deep-b-${String(at)}`)),
    ],
    xml: diagramOf([], ["Call_A", "Call_B"]),
  },
  "a mass failure at a task beside call activities with a copy each": {
    tokens: { Task_Charge: 1600 },
    incidents: [
      ...many(1600, (at) => root(`r-mass-${String(at)}`, "Task_Charge")),
      ...many(5, (at) => copy(`c-each-${String(at)}`, `Call_${String(at)}`, "deep")),
    ],
    xml: diagramOf(["Task_Charge"], ["Call_0", "Call_1", "Call_2", "Call_3", "Call_4"]),
  },
  "a page of rows at a task beyond a copy at each of three call activities": {
    tokens: { Task_Charge: 500 },
    incidents: [
      ...many(500, (at) => root(`r-page-${String(at)}`, "Task_Charge")),
      ...many(3, (at) => copy(`c-page-each-${String(at)}`, `Call_${String(at)}`, "deep")),
    ],
    xml: diagramOf(["Task_Charge"], ["Call_0", "Call_1", "Call_2"]),
  },
  "less than a page of rows at a task beyond a copy at each of three call activities": {
    tokens: { Task_Charge: 499 },
    incidents: [
      ...many(499, (at) => root(`r-less-${String(at)}`, "Task_Charge")),
      ...many(3, (at) => copy(`c-less-each-${String(at)}`, `Call_${String(at)}`, "deep")),
    ],
    xml: diagramOf(["Task_Charge"], ["Call_0", "Call_1", "Call_2"]),
  },
  "a call activity whose start tag holds the other quote in a value": {
    tokens: { Call_Quoted: 1, Task_Review: 2 },
    incidents: [
      copy("c-quoted", "Call_Quoted", "label-root"),
      root("r-review-1", "Task_Review"),
      root("r-review-2", "Task_Review"),
    ],
    xml: diagramOf(["Task_Review"], ["Call_Plain"]).replace(
      '<bpmn:process id="order" isExecutable="true">',
      `$&\n<bpmn:callActivity id="Call_Quoted" name='5" pipe' calledElement="label" />`,
    ),
  },
  "a multi-instance task whose body holds a failed job's root incident beside its items": {
    tokens: { Task_Approve: 3, "Task_Approve#multiInstanceBody": 1 },
    incidents: [root("r-body", "Task_Approve#multiInstanceBody")],
    xml: diagramOf(["Task_Approve"], []),
  },
  "a multi-instance call activity whose body holds a root incident and its items copies": {
    tokens: { Call_Each: 2, "Call_Each#multiInstanceBody": 1 },
    incidents: [
      root("r-each", "Call_Each#multiInstanceBody"),
      copy("c-each-1", "Call_Each", "deep-1"),
      copy("c-each-2", "Call_Each", "deep-2"),
    ],
    xml: diagramOf([], ["Call_Each"]),
  },
  "more incidents of one millisecond at a call activity than a page holds": {
    tokens: { Call_Label: 600 },
    incidents: [
      ...many(520, (at) => copy(`c-page-${String(at)}`, "Call_Label", `deep-${String(at)}`)),
      root("r9", "Call_Label"),
      ...many(30, (at) => root(`r-task-${String(at)}`, "Task_Charge")),
    ],
    xml: diagramOf(["Task_Charge"], ["Call_Label"]),
  },
}

describe("the element statistics' law", () => {
  it.each(Object.entries(WORLDS))(
    "%s: the same counts as a read of every incident",
    async (_name, world) => {
      const { statistics } = await readOver(world)
      expect(byElement(statistics)).toStrictEqual(byElement(wholeRead(world)))
    },
  )

  it.each([
    ["a root incident at the call activity itself, a failed job before the call", ["Call_Label@0"]],
    ["a copy whose root lies two levels deeper", ["Call_Dispatch@0"]],
    [
      "several call activities, one without incidents, beside a mass failure",
      ["Call_Label@0", "Call_Invoice@0"],
    ],
    ["a version without call activities", []],
    ["a version without incidents", []],
    ["an incident at an element without a token", []],
    ["a version the engine no longer holds the diagram of", ["every@0"]],
    ["a call activity whose id cannot be read", ["every@0"]],
    ["many call activities with an incident each, fewer pages in one read", ["every@0"]],
    [
      "two call activities with 300 incidents each, as many pages as one read of the version",
      ["Call_A@0", "Call_B@0"],
    ],
    [
      "a mass failure at a task beside call activities with a copy each",
      ["Call_0@0", "Call_1@0", "Call_2@0", "Call_3@0", "Call_4@0"],
    ],
    [
      "a page of rows at a task beyond a copy at each of three call activities",
      ["Call_0@0", "Call_1@0", "Call_2@0"],
    ],
    [
      "less than a page of rows at a task beyond a copy at each of three call activities",
      ["every@0", "every@500"],
    ],
    ["a call activity whose start tag holds the other quote in a value", ["Call_Quoted@0"]],
    ["a multi-instance task whose body holds a failed job's root incident beside its items", []],
    [
      "a multi-instance call activity whose body holds a root incident and its items copies",
      ["Call_Each@0"],
    ],
    [
      "more incidents of one millisecond at a call activity than a page holds",
      ["Call_Label@0", "Call_Label@500"],
    ],
  ])("%s: reads the incidents %j", async (name, reads) => {
    expect((await readOver(WORLDS[name]!)).incidentReads).toStrictEqual(reads)
  })

  it("reads no diagram and no incident for a version without incidents", async () => {
    expect((await readOver(WORLDS["a version without incidents"]!)).sent).toStrictEqual([
      "getActivityStatistics",
    ])
  })
})
