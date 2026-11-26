import { C7_BOARD_ENGINE, C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import { BpmnProcessId, DefinitionId, InstanceId } from "@miragon/pulse-engine-core"
import {
  ConformanceKit,
  FakeEngine,
  FakeWorld,
  type ConformanceHarness,
} from "@miragon/pulse-engine-core/testing"
import type { BoardData } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
import type {
  EngineScreenData,
  FindScreenData,
  InstanceListData,
  InstanceScreenData,
  ProcessScreenData,
} from "@miragon/pulse-screens"
import {
  EngineScreen,
  Finder,
  InstanceList,
  InstanceScreen,
  ProcessScreen,
  ScreenJson,
} from "@miragon/pulse-screens/builder"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"
import { RecordedBoard } from "./support/recorded-board.js"
import {
  ENGINE_IMAGE,
  RUNS_ON_CAMUNDA_7,
  startEngine,
  type RunningEngine,
} from "./support/engine-container.js"
import { seedCommandWorld, seedWorld } from "./support/world.js"

const UNREACHABLE_URL = "http://127.0.0.1:9/engine-rest"
const BATCHES_RUN_WITHIN = {
  withinMs: 90_000,
  wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}

function connectionTo(endpoint: string) {
  return { endpoint, credentials: { kind: "none" } } as const
}

describe.skipIf(!RUNS_ON_CAMUNDA_7)(`the C7 adapter against ${ENGINE_IMAGE}`, () => {
  const adapter = new C7Adapter()
  let engine: RunningEngine | undefined
  let harness: ConformanceHarness | undefined

  beforeAll(async () => {
    engine = await startEngine()
    harness = {
      runtime: adapter.runtime(connectionTo(engine.url)),
      unreachableRuntime: adapter.runtime(connectionTo(UNREACHABLE_URL)),
      world: await seedWorld(engine.url),
    }
  })

  afterAll(async () => {
    await engine?.stop()
  })

  const kit = new ConformanceKit(test)

  kit.registerRuntimeLaws(() => {
    if (harness === undefined) {
      return Promise.reject(new Error("the engine did not start"))
    }
    return Promise.resolve(harness)
  })

  test("board: c7-core's recorded board over the seeded world has the numbers of the kit's world", async () => {
    if (harness === undefined) {
      throw new Error("the engine did not start")
    }
    const board = await RecordedBoard.build(harness.runtime)
    const fake = await RecordedBoard.build(new FakeEngine(FakeWorld.seed().state))

    expect(board.engines.map(({ state }) => state)).toEqual(["ready"])
    expect(BoardFigures.of(board)).toEqual(BoardFigures.of(fake))
    expect(BoardFigures.of(board)).toEqual(BoardFigures.of(C7_BOARD_ENGINE.expected as BoardData))
  })

  test("screens: the engine screen over the seeded world has the numbers of the kit's world", async () => {
    if (harness === undefined) {
      throw new Error("the engine did not start")
    }
    const model = await EngineScreen.read(
      C7_SCREEN_ENGINE.engine,
      harness.runtime,
      () => new Date(),
    )
    const figures = ScreenFigures.engine(ScreenJson.engine(model))

    expect(figures).toEqual(ScreenFigures.engine(WORLD_SCREENS.engine))
    expect(figures).toEqual(
      ScreenFigures.engine(C7_SCREEN_ENGINE.expected.engine as EngineScreenData),
    )
  })

  test("screens: the instance screens of DSP-3001 and its called instance have the kit's numbers", async () => {
    if (harness === undefined) {
      throw new Error("the engine did not start")
    }
    const { runtime } = harness
    const read = async (id: string): Promise<InstanceScreenData> => {
      const model = await InstanceScreen.read(
        C7_SCREEN_ENGINE.engine,
        InstanceId(id),
        runtime,
        () => new Date(),
      )
      if (model === undefined) {
        throw new Error(`the engine holds no instance ${id}`)
      }
      return ScreenJson.instance(model)
    }
    const instance = await read(harness.world.instanceIds["DSP-3001"])
    const [called] = instance.calls.flatMap((link) =>
      link.kind === "instances" ? link.instances : [],
    )
    const screens = { instance, calledInstance: await read(called?.id ?? "none") }

    for (const name of ["instance", "calledInstance"] as const) {
      const figures = ScreenFigures.instance(screens[name])
      const recorded = C7_SCREEN_ENGINE.expected[name] as InstanceScreenData
      expect(figures).toEqual(ScreenFigures.instance(WORLD_SCREENS[name]))
      expect(figures).toEqual(ScreenFigures.instance(recorded))
    }
  })

  test("screens: the finder finds ORD-1003 and the instance DSP-3001 called as on the kit's world", async () => {
    if (harness === undefined) {
      throw new Error("the engine did not start")
    }
    const { runtime, world } = harness
    const find = async (text: string): Promise<FindScreenData> =>
      ScreenJson.find(await Finder.read(C7_SCREEN_ENGINE.engine, text, runtime, () => new Date()))
    const dispatch = await InstanceScreen.read(
      C7_SCREEN_ENGINE.engine,
      InstanceId(world.instanceIds["DSP-3001"]),
      runtime,
      () => new Date(),
    )
    const [called] = (dispatch === undefined ? [] : ScreenJson.instance(dispatch).calls).flatMap(
      (link) => (link.kind === "instances" ? link.instances : []),
    )
    const screens = { find: await find("ORD-1003"), findById: await find(called?.id ?? "none") }

    for (const name of ["find", "findById"] as const) {
      const figures = ScreenFigures.find(screens[name])
      expect(figures).toEqual(ScreenFigures.find(WORLD_SCREENS[name]))
      expect(figures).toEqual(ScreenFigures.find(C7_SCREEN_ENGINE.expected[name] as FindScreenData))
    }
  })

  test("screens: the process screens and the instance list over the seeded world have the kit's numbers", async () => {
    if (harness === undefined) {
      throw new Error("the engine did not start")
    }
    const { runtime } = harness
    const read = async (bpmnProcessId: string, version?: number): Promise<ProcessScreenData> => {
      const latest = await ProcessScreen.read(
        C7_SCREEN_ENGINE.engine,
        { bpmnProcessId: BpmnProcessId(bpmnProcessId) },
        runtime,
        () => new Date(),
      )
      const definitionId = latest?.versions.find(({ definition }) => definition.version === version)
        ?.definition.id
      const model =
        definitionId === undefined
          ? latest
          : await ProcessScreen.read(
              C7_SCREEN_ENGINE.engine,
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
        C7_SCREEN_ENGINE.engine,
        { definitionId: DefinitionId(definitionId), filter: { scope: "all" } },
        runtime,
        () => new Date(),
      ),
    )

    for (const name of ["process", "olderVersion", "callingProcess"] as const) {
      const figures = ScreenFigures.process(processes[name])
      expect(figures).toEqual(ScreenFigures.process(WORLD_SCREENS[name]))
      expect(figures).toEqual(
        ScreenFigures.process(C7_SCREEN_ENGINE.expected[name] as ProcessScreenData),
      )
    }
    const figures = ScreenFigures.instanceList(list)
    expect(figures).toEqual(ScreenFigures.instanceList(WORLD_SCREENS.instanceList))
    expect(figures).toEqual(
      ScreenFigures.instanceList(C7_SCREEN_ENGINE.expected.instanceList as InstanceListData),
    )
  })

  kit.registerCommandLaws(async () => {
    if (engine === undefined || harness === undefined) {
      throw new Error("the engine did not start")
    }
    return {
      runtime: harness.runtime,
      commands: adapter.commands(connectionTo(engine.url)),
      world: await seedCommandWorld(engine.url, harness.world),
      asyncWork: BATCHES_RUN_WITHIN,
    }
  })
})
