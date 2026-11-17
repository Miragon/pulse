import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import {
  ConformanceKit,
  FakeEngine,
  FakeWorld,
  type ConformanceHarness,
} from "@miragon/pulse-engine-core/testing"
import type { BoardData } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
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
