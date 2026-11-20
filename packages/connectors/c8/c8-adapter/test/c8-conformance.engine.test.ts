import type { BoardData } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
import { C8_BOARD_ENGINE, C8_SCREEN_ENGINE } from "@miragon/pulse-c8-core/testing"
import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  InstanceId,
  type WaitState,
} from "@miragon/pulse-engine-core"
import {
  ConformanceKit,
  FakeEngine,
  FakeWorld,
  type ConformanceHarness,
} from "@miragon/pulse-engine-core/testing"
import type {
  EngineScreenData,
  InstanceListData,
  InstanceScreenData,
  ProcessScreenData,
} from "@miragon/pulse-screens"
import {
  EngineScreen,
  InstanceList,
  InstanceScreen,
  ProcessScreen,
  ScreenJson,
} from "@miragon/pulse-screens/builder"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { C8Adapter } from "../src/index.js"
import { RecordedBoard } from "./support/recorded-board.js"
import {
  CAMUNDA_IMAGE,
  RUNS_ON_CAMUNDA_8,
  SECURITY,
  STORAGE,
  startCluster,
  type RunningCluster,
} from "./support/engine-container.js"
import { registerSecurityChecks } from "./support/security-checks.js"
import { ClusterCalls, deployModel, seedWorld, until } from "./support/seed-world.js"

const UNREACHABLE_URL = "http://127.0.0.1:9/v2"
const WAITING_ORDER = "ORD-77"

function namedWaits(seen: readonly WaitState[]): readonly WaitState[] | undefined {
  const named =
    seen.every((wait) => wait.kind !== "other") &&
    seen.some((wait) => wait.kind === "message" && wait.messageName !== undefined)
  return seen.length === 3 && named ? seen : undefined
}

describe.skipIf(!RUNS_ON_CAMUNDA_8)(
  `the C8 adapter against ${CAMUNDA_IMAGE}, ${STORAGE}, security ${SECURITY}`,
  () => {
    const adapter = new C8Adapter()
    let starting: Promise<RunningCluster> | undefined
    let cluster: RunningCluster | undefined
    let harness: ConformanceHarness | undefined

    beforeAll(async () => {
      starting = startCluster()
      cluster = await starting
      harness = {
        runtime: adapter.runtime({ endpoint: cluster.url, credentials: cluster.reader }),
        unreachableRuntime: adapter.runtime({
          endpoint: UNREACHABLE_URL,
          credentials: { kind: "none" },
        }),
        world: await seedWorld(cluster.url, cluster.seed),
      }
    })

    afterAll(async () => {
      const started = await starting?.catch(() => undefined)
      await started?.stop()
    })

    new ConformanceKit(test).registerRuntimeLaws(() => {
      if (harness === undefined) {
        return Promise.reject(new Error("the cluster did not start"))
      }
      return Promise.resolve(harness)
    })

    test("board: c8-core's recorded board over the seeded world has the numbers of the kit's world", async () => {
      const { runtime } = harness ?? expect.fail("the cluster did not start")
      const board = await RecordedBoard.build(runtime)
      const fake = await RecordedBoard.build(new FakeEngine(FakeWorld.seed().state))

      expect(board.engines.map(({ state }) => state)).toEqual(["ready"])
      expect(BoardFigures.of(board)).toEqual(BoardFigures.of(fake))
      expect(BoardFigures.of(board)).toEqual(BoardFigures.of(C8_BOARD_ENGINE.expected as BoardData))
    })

    test("screens: the engine screen over the seeded world has the numbers of the kit's world", async () => {
      const { runtime } = harness ?? expect.fail("the cluster did not start")
      const model = await EngineScreen.read(C8_SCREEN_ENGINE.engine, runtime, () => new Date())
      const figures = ScreenFigures.engine(ScreenJson.engine(model))

      expect(figures).toEqual(ScreenFigures.engine(WORLD_SCREENS.engine))
      expect(figures).toEqual(
        ScreenFigures.engine(C8_SCREEN_ENGINE.expected.engine as EngineScreenData),
      )
    })

    test("screens: the instance screens of DSP-3001 and its called instance have the kit's numbers", async () => {
      const { runtime, world } = harness ?? expect.fail("the cluster did not start")
      const read = async (id: string): Promise<InstanceScreenData> => {
        const model = await InstanceScreen.read(
          C8_SCREEN_ENGINE.engine,
          InstanceId(id),
          runtime,
          () => new Date(),
        )
        return model === undefined ? expect.fail(`no instance ${id}`) : ScreenJson.instance(model)
      }
      const instance = await read(world.instanceIds["DSP-3001"])
      const [called] = instance.calls.flatMap((link) =>
        link.kind === "instances" ? link.instances : [],
      )
      const screens = { instance, calledInstance: await read(called?.id ?? "none") }

      for (const name of ["instance", "calledInstance"] as const) {
        const figures = ScreenFigures.instance(screens[name])
        const recorded = C8_SCREEN_ENGINE.expected[name] as InstanceScreenData
        expect(figures).toEqual(ScreenFigures.instance(WORLD_SCREENS[name]))
        expect(figures).toEqual(ScreenFigures.instance(recorded))
      }
    })

    test("screens: the process screens and the instance list over the seeded world have the kit's numbers", async () => {
      const { runtime } = harness ?? expect.fail("the cluster did not start")
      const read = async (bpmnProcessId: string, version?: number): Promise<ProcessScreenData> => {
        const latest = await ProcessScreen.read(
          C8_SCREEN_ENGINE.engine,
          { bpmnProcessId: BpmnProcessId(bpmnProcessId) },
          runtime,
          () => new Date(),
        )
        const definitionId = latest?.versions.find(
          ({ definition }) => definition.version === version,
        )?.definition.id
        const model =
          definitionId === undefined
            ? latest
            : await ProcessScreen.read(
                C8_SCREEN_ENGINE.engine,
                { bpmnProcessId: BpmnProcessId(bpmnProcessId), definitionId },
                runtime,
                () => new Date(),
              )
        if (model === undefined) {
          throw new Error(`the engine holds no version of ${bpmnProcessId}`)
        }
        return ScreenJson.process(model)
      }
      const processes = {
        process: await read("pulse-order"),
        olderVersion: await read("pulse-order", 1),
        callingProcess: await read("pulse-dispatch"),
      }
      const definitionId = processes.olderVersion.selected?.id
      if (definitionId === undefined) {
        throw new Error("the engine holds no version 1 of pulse-order")
      }
      const list = ScreenJson.instanceList(
        await InstanceList.read(
          C8_SCREEN_ENGINE.engine,
          { definitionId: DefinitionId(definitionId), filter: { scope: "all" } },
          runtime,
          () => new Date(),
        ),
      )

      for (const name of ["process", "olderVersion", "callingProcess"] as const) {
        const figures = ScreenFigures.process(processes[name])
        expect(figures).toEqual(ScreenFigures.process(WORLD_SCREENS[name]))
        expect(figures).toEqual(
          ScreenFigures.process(C8_SCREEN_ENGINE.expected[name] as ProcessScreenData),
        )
      }
      const figures = ScreenFigures.instanceList(list)
      expect(figures).toEqual(ScreenFigures.instanceList(WORLD_SCREENS.instanceList))
      expect(figures).toEqual(
        ScreenFigures.instanceList(C8_SCREEN_ENGINE.expected.instanceList as InstanceListData),
      )
    })

    test("names the event and the message an instance waits for", async () => {
      const { url, seed, reader } = cluster ?? expect.fail("the cluster did not start")
      const calls = new ClusterCalls(url, seed)
      const definition = await deployModel(calls, "waits")
      const { processInstanceKey } = await calls.post<{ readonly processInstanceKey: string }>(
        "/process-instances",
        { processDefinitionKey: definition, variables: { orderId: WAITING_ORDER } },
      )
      const runtime = adapter.runtime({ endpoint: url, credentials: reader })

      const waits = await until("three named wait states", async () => {
        const detail = await runtime.getInstanceDetail(InstanceId(processInstanceKey))
        return namedWaits(detail?.waitStates ?? [])
      })

      const byElement = new Map(waits.map((wait) => [wait.elementId, wait]))
      expect(byElement.get(ElementId("Event_Message"))).toMatchObject({
        kind: "message",
        messageName: "Payment received",
        correlationKey: WAITING_ORDER,
      })
      expect(byElement.get(ElementId("Event_Timer"))?.kind).toBe("timer")
      expect(byElement.get(ElementId("Event_Signal"))?.kind).toBe("signal")
    })

    registerSecurityChecks(() => cluster ?? expect.fail("the cluster did not start"))
  },
)
