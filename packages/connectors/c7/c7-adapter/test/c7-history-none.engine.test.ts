import { BoardParser } from "@miragon/pulse-board"
import { BoardBuilder, BoardJson } from "@miragon/pulse-board/builder"
import { BoardFigures } from "@miragon/pulse-board/testing"
import {
  BpmnProcessId,
  ElementId,
  type ElementStatistics,
  type InstanceFilter,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import {
  CASE,
  ConformanceKit,
  WORLD_ELEMENT,
  WORLD_PROCESS,
  type ConformanceHarness,
  type SeededWorld,
} from "@miragon/pulse-engine-core/testing"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"
import {
  ENGINE_IMAGE,
  RUNS_ON_CAMUNDA_7,
  startEngine,
  type RunningEngine,
} from "./support/engine-container.js"
import { seedWorld } from "./support/world.js"

const ORDER = BpmnProcessId(WORLD_PROCESS.order)
const PAGE = { limit: 50 } as const
const UNREACHABLE_URL = "http://127.0.0.1:9/engine-rest"
const BOARD_ENGINE = "none"

interface Scope {
  readonly name: string
  readonly filter: (world: SeededWorld) => InstanceFilter
  readonly count: number
}

const SCOPES: readonly Scope[] = [
  {
    name: "every instance of the engine",
    filter: () => ({}),
    count: 0,
  },
  {
    name: "the engine's running instances",
    filter: () => ({ lifecycle: "running" }),
    count: 0,
  },
  {
    name: "every instance of order",
    filter: () => ({ bpmnProcessId: ORDER }),
    count: 0,
  },
  {
    name: "the running instances of order v1",
    filter: (world) => ({ definitionId: world.definitionIds["order@1"], lifecycle: "running" }),
    count: 0,
  },
  {
    name: "the running instances of order v1 with an incident",
    filter: (world) => ({
      definitionId: world.definitionIds["order@1"],
      lifecycle: "running",
      withIncident: true,
    }),
    count: 1,
  },
  {
    name: "the running instances of order v1 without an incident, none of which the history holds",
    filter: (world) => ({
      definitionId: world.definitionIds["order@1"],
      lifecycle: "running",
      withIncident: false,
    }),
    count: 0,
  },
  {
    name: "the ended instances of order v1 without an incident",
    filter: (world) => ({
      definitionId: world.definitionIds["order@1"],
      lifecycle: "ended",
      withIncident: false,
    }),
    count: 0,
  },
  {
    name: "the ended instances of order v1",
    filter: (world) => ({ definitionId: world.definitionIds["order@1"], lifecycle: "ended" }),
    count: 0,
  },
  {
    name: "every instance of order v1",
    filter: (world) => ({ definitionId: world.definitionIds["order@1"] }),
    count: 0,
  },
  {
    name: "an ended instance by its business key",
    filter: () => ({ businessKey: "ORD-1003" }),
    count: 0,
  },
  {
    name: "an instance with an incident by its business key",
    filter: () => ({ businessKey: "ORD-1002", withIncident: true }),
    count: 1,
  },
  {
    name: "running instances by their ids",
    filter: (world) => ({
      instanceIds: [world.instanceIds["ORD-1001"], world.instanceIds["ORD-1002"]],
      lifecycle: "running",
    }),
    count: 0,
  },
  {
    name: "an instance with an incident by its id",
    filter: (world) => ({ instanceIds: [world.instanceIds["ORD-1002"]], withIncident: true }),
    count: 0,
  },
  {
    name: "the running instances of order with an incident at an element, the history's",
    filter: () => ({
      bpmnProcessId: ORDER,
      lifecycle: "running",
      activeElementId: ElementId(WORLD_ELEMENT.chargePayment),
      withIncident: true,
    }),
    count: 0,
  },
  {
    name: "the engine's instances with an incident",
    filter: () => ({ withIncident: true }),
    count: 3,
  },
  {
    name: "the engine's instances without an incident, none of which the history holds",
    filter: () => ({ withIncident: false }),
    count: 0,
  },
]

const LAWS_WITHOUT_THE_HISTORY = ConformanceKit.runtimeLaws().filter(
  ({ name }) => name === CASE.instancesNeverBelowZero,
)

const BOARD = {
  schemaVersion: 1,
  title: "Orders at history level none",
  engines: [BOARD_ENGINE],
  rows: [
    {
      row: [
        { widget: "counter", props: { title: "Running", filter: { process: ORDER } } },
        {
          widget: "counter",
          props: { title: "With incident", filter: { process: ORDER, withIncident: true } },
        },
        {
          widget: "counter",
          props: {
            title: "With incident at charge payment",
            filter: {
              process: ORDER,
              withIncident: true,
              activeElement: WORLD_ELEMENT.chargePayment,
            },
          },
        },
        {
          widget: "counter",
          props: { title: "Without incident", filter: { process: ORDER, withIncident: false } },
        },
        {
          widget: "counter",
          props: { title: "Every process without incident", filter: { withIncident: false } },
        },
        {
          widget: "counter",
          props: { title: "Ended", filter: { process: ORDER, state: "ended" } },
        },
      ],
    },
    {
      row: [
        {
          widget: "instanceList",
          props: {
            title: "Running orders without incident",
            filter: { process: ORDER, withIncident: false },
          },
        },
        { widget: "incidentSummary", props: { title: "With incident per process" } },
      ],
    },
  ],
} as const

async function boardOver(runtime: ProcessRuntime) {
  const parsed = BoardParser.parse(JSON.stringify(BOARD))
  if (!("board" in parsed)) {
    throw new Error(JSON.stringify(parsed.problems))
  }
  const model = await BoardBuilder.build(parsed.board, [{ name: BOARD_ENGINE, reads: runtime }])
  return BoardJson.of(model, { failureOf: () => ({ code: "unknown" }), notes: parsed.notes })
}

function connectionTo(endpoint: string) {
  return { endpoint, credentials: { kind: "none" } } as const
}

async function countAt(url: string): Promise<number> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`GET ${url}: HTTP ${response.status}`)
  }
  return ((await response.json()) as { readonly count: number }).count
}

async function ensureNoInstanceHistory(engineUrl: string): Promise<void> {
  const [running, recorded] = await Promise.all([
    countAt(`${engineUrl}/process-instance/count`),
    countAt(`${engineUrl}/history/process-instance/count`),
  ])
  if (running === 0 || recorded > 0) {
    throw new Error(
      `the engine runs ${running} instances and its history holds ${recorded}: it does not run at history level NONE`,
    )
  }
}

function byElement(statistics: readonly ElementStatistics[]): ElementStatistics[] {
  return [...statistics].sort((left, right) => left.elementId.localeCompare(right.elementId))
}

describe.skipIf(!RUNS_ON_CAMUNDA_7)(
  `the C7 adapter's reads against ${ENGINE_IMAGE} at history level NONE`,
  () => {
    const adapter = new C7Adapter()
    let engine: RunningEngine | undefined
    let seeded: ConformanceHarness | undefined

    function seededWorld(): ConformanceHarness {
      if (seeded === undefined) {
        throw new Error("the engine did not start")
      }
      return seeded
    }

    beforeAll(async () => {
      engine = await startEngine(ENGINE_IMAGE, "none")
      const world = await seedWorld(engine.url)
      await ensureNoInstanceHistory(engine.url)
      seeded = {
        runtime: adapter.runtime(connectionTo(engine.url)),
        unreachableRuntime: adapter.runtime(connectionTo(UNREACHABLE_URL)),
        world,
      }
    })

    afterAll(async () => {
      await engine?.stop()
    })

    describe("the missing history, told from the contract's reads", () => {
      test("the runtime counts the engine's running instances, which no count over every lifecycle finds", async () => {
        const { runtime } = seededWorld()
        const definitions = await runtime.listDefinitions()
        const counted = await runtime.countInstances({})

        expect(
          definitions
            .map(({ latest, running, withIncident }) => ({
              process: latest.bpmnProcessId,
              running,
              withIncident,
            }))
            .sort((left, right) => left.process.localeCompare(right.process)),
        ).toEqual([
          { process: WORLD_PROCESS.dispatch, running: 1, withIncident: 1 },
          { process: WORLD_PROCESS.label, running: 1, withIncident: 1 },
          { process: WORLD_PROCESS.order, running: 3, withIncident: 1 },
        ])
        expect(counted).toEqual({ count: 0 })
      })

      test("the runtime counts the instances of each version, which no count over every lifecycle finds", async () => {
        const { runtime, world } = seededWorld()
        const versions = await runtime.listVersions(ORDER)
        const counted = await runtime.countInstances({
          definitionId: world.definitionIds["order@1"],
        })

        expect(
          versions.map(({ definition, running, withIncident }) => ({
            version: definition.version,
            running,
            withIncident,
          })),
        ).toEqual([
          { version: 2, running: 1, withIncident: 0 },
          { version: 1, running: 2, withIncident: 1 },
        ])
        expect(counted).toEqual({ count: 0 })
      })
    })

    describe("the instance search and its count", () => {
      test.each(SCOPES)("searchInstances finds none of $name", async ({ filter }) => {
        const { runtime, world } = seededWorld()

        expect(await runtime.searchInstances(filter(world), PAGE)).toEqual({ items: [] })
      })

      test.each(SCOPES)("countInstances counts $count of $name", async ({ filter, count }) => {
        const { runtime, world } = seededWorld()

        expect(await runtime.countInstances(filter(world))).toEqual({ count })
      })

      test.each(LAWS_WITHOUT_THE_HISTORY)("conformance: $name", async (law) => {
        await law.run(seededWorld())
      })
    })

    describe("a board", () => {
      test("counts the runtime's instances with an incident where it knows the filter whole, 0 at an element or without one, and lists none", async () => {
        const board = await boardOver(seededWorld().runtime)

        expect(BoardFigures.of(board)).toEqual({
          engines: [{ running: 5, withIncident: 3 }],
          tiles: [
            { readings: [[BOARD_ENGINE, { count: 0 }, undefined]], total: { count: 0 } },
            { readings: [[BOARD_ENGINE, { count: 1 }, undefined]], total: { count: 1 } },
            { readings: [[BOARD_ENGINE, { count: 0 }, undefined]], total: { count: 0 } },
            { readings: [[BOARD_ENGINE, { count: 0 }, undefined]], total: { count: 0 } },
            { readings: [[BOARD_ENGINE, { count: 0 }, undefined]], total: { count: 0 } },
            { readings: [[BOARD_ENGINE, { count: 0 }, undefined]], total: { count: 0 } },
            [{ engine: BOARD_ENGINE, total: { count: 0 }, rows: [] }],
            {
              total: 3,
              rows: [
                JSON.stringify([BOARD_ENGINE, WORLD_PROCESS.dispatch, 1]),
                JSON.stringify([BOARD_ENGINE, WORLD_PROCESS.label, 1]),
                JSON.stringify([BOARD_ENGINE, WORLD_PROCESS.order, 1]),
              ],
            },
          ],
        })
      })
    })

    describe("the reads that answer from the runtime", () => {
      test("the statistics of a version count its running instances and their incidents", async () => {
        const { runtime, world } = seededWorld()
        const order = await runtime.getElementStatistics(world.definitionIds["order@1"])
        const dispatch = await runtime.getElementStatistics(world.definitionIds["dispatch@1"])

        expect(byElement(order)).toEqual([
          {
            elementId: WORLD_ELEMENT.chargePayment,
            active: 0,
            incidents: 1,
            incidentsInCalledInstances: 0,
          },
          {
            elementId: WORLD_ELEMENT.reviewOrder,
            active: 1,
            incidents: 0,
            incidentsInCalledInstances: 0,
          },
        ])
        expect(byElement(dispatch)).toEqual([
          {
            elementId: WORLD_ELEMENT.printShippingLabel,
            active: 1,
            incidents: 0,
            incidentsInCalledInstances: 1,
          },
        ])
      })

      test("the open incidents of a version are found", async () => {
        const { runtime, world } = seededWorld()
        const page = await runtime.searchIncidents(
          { definitionId: world.definitionIds["order@1"] },
          PAGE,
        )

        expect(page.items.map(({ instanceId, elementId }) => ({ instanceId, elementId }))).toEqual([
          { instanceId: world.instanceIds["ORD-1002"], elementId: WORLD_ELEMENT.chargePayment },
        ])
      })
    })

    describe("the reads that join the history", () => {
      test("a running instance's detail has its wait states and no path", async () => {
        const { runtime, world } = seededWorld()
        const detail = await runtime.getInstanceDetail(world.instanceIds["ORD-1001"])

        expect(detail?.instance.id).toBe(world.instanceIds["ORD-1001"])
        expect(detail?.waitStates.map(({ elementId }) => elementId)).toEqual([
          WORLD_ELEMENT.reviewOrder,
        ])
        expect(detail?.path).toEqual([])
      })

      test("a caller's detail names its called instance and the root incident raised there, by the runtime's version", async () => {
        const { runtime, world } = seededWorld()
        const detail = await runtime.getInstanceDetail(world.instanceIds["DSP-3001"])

        expect(detail?.calledInstances.map(({ bpmnProcessId }) => bpmnProcessId)).toEqual([
          WORLD_PROCESS.label,
        ])
        expect(detail?.incidents).toEqual([
          expect.objectContaining({
            instanceId: detail?.calledInstances[0]?.id,
            elementId: WORLD_ELEMENT.renderLabel,
            definition: expect.objectContaining({
              id: world.definitionIds["label@1"],
              bpmnProcessId: WORLD_PROCESS.label,
              version: 1,
            }) as unknown,
          }),
        ])
      })

      test("an ended instance has no detail", async () => {
        const { runtime, world } = seededWorld()

        expect(await runtime.getInstanceDetail(world.instanceIds["ORD-1003"])).toBeUndefined()
      })

      test("a version names no variables", async () => {
        const { runtime, world } = seededWorld()

        expect(await runtime.listVariableNames(world.definitionIds["order@1"])).toEqual([])
      })
    })
  },
)
