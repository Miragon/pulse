import { C7_BOARD_ENGINE, C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import { InstanceId } from "@miragon/pulse-engine-core"
import {
  ConformanceKit,
  FakeEngine,
  FakeWorld,
  type ConformanceHarness,
} from "@miragon/pulse-engine-core/testing"
import type { BoardData } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
import type { EngineScreenData, InstanceScreenData } from "@miragon/pulse-screens"
import { EngineScreen, InstanceScreen, ScreenJson } from "@miragon/pulse-screens/builder"
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
