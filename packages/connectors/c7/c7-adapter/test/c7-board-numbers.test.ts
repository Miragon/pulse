import type { BoardData } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import { startRecordedEngine, type RecordedEngine } from "@miragon/pulse-http/testing/loopback"
import { afterEach, describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"
import { RecordedBoard } from "./support/recorded-board.js"

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function recordedEngine(): Promise<RecordedEngine> {
  const engine = await startRecordedEngine(C7_BOARD_ENGINE.answers)
  engines.push(engine)
  return engine
}

describe("the C7 adapter over c7-core's recorded board engine", () => {
  test("asks the engine only what it answered and builds the board the recording expects", async () => {
    const engine = await recordedEngine()
    const runtime = new C7Adapter().runtime({
      endpoint: `${engine.origin}/engine-rest`,
      credentials: { kind: "none" },
    })

    const board = await RecordedBoard.build(runtime)

    expect(engine.unanswered).toEqual([])
    expect(board).toEqual(C7_BOARD_ENGINE.expected)
  })

  test("holds the numbers the conformance kit's fake world gives", async () => {
    const fake = await RecordedBoard.build(new FakeEngine(FakeWorld.seed().state))

    expect(BoardFigures.of(C7_BOARD_ENGINE.expected as BoardData)).toEqual(BoardFigures.of(fake))
  })
})
