import type { BoardData } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
import { C8_BOARD_ENGINE } from "@miragon/pulse-c8-core/testing"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import { startRecordedEngine, type RecordedEngine } from "@miragon/pulse-http/testing/loopback"
import { afterEach, describe, expect, test } from "vitest"
import { C8Adapter } from "../src/index.js"
import { RecordedBoard } from "./support/recorded-board.js"

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function recordedEngine(): Promise<RecordedEngine> {
  const engine = await startRecordedEngine(C8_BOARD_ENGINE.answers)
  engines.push(engine)
  return engine
}

describe("the C8 adapter over c8-core's recorded board engine", () => {
  test("asks the cluster only what it answered and builds the board the recording expects", async () => {
    const engine = await recordedEngine()
    const runtime = new C8Adapter().runtime({
      endpoint: `${engine.origin}/v2`,
      credentials: { kind: "none" },
    })

    const board = await RecordedBoard.build(runtime)

    expect(engine.unanswered).toEqual([])
    expect(board).toEqual(C8_BOARD_ENGINE.expected)
  })

  test("holds the numbers the conformance kit's fake world gives", async () => {
    const fake = await RecordedBoard.build(new FakeEngine(FakeWorld.seed().state))

    expect(BoardFigures.of(C8_BOARD_ENGINE.expected as BoardData)).toEqual(BoardFigures.of(fake))
  })
})
