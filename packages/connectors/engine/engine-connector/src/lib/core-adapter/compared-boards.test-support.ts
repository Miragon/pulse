/**
 * The boards both engine suites compare (c7-runtime.engine.test.ts, c8-runtime.engine.test.ts)
 * by their figures (`BoardFigures` of `@miragon/pulse-board/testing`, which the C7 and C8
 * adapters' suites compare by too): a dialect's recorded board (its file's text and the engine it
 * names), as the server's board files hand it on, and the board the kit's fake world gives for it.
 */

import { type BoardData, BoardParser } from "@miragon/pulse-board"
import { BoardBuilder, BoardJson } from "@miragon/pulse-board/builder"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import type { EngineBoard } from "../../board-files.js"

/** A recorded board engine as each dialect's core ships it: its board file and engine name. */
interface RecordedBoardFile {
  readonly text: string
  readonly engine: string
}

/** The recorded board as the server's board files hand it on: every widget and a refused one. */
export function recordedBoard({ text }: RecordedBoardFile): EngineBoard {
  const parsed = BoardParser.parse(text)
  if (!("board" in parsed)) throw new Error(JSON.stringify(parsed.problems))
  return { id: "orders", file: "orders.board.json", board: parsed.board, notes: parsed.notes }
}

/** The board the conformance kit's fake world gives for the recorded board. */
export async function fakeWorldBoard(recorded: RecordedBoardFile): Promise<BoardData> {
  const { board } = recordedBoard(recorded)
  const model = await BoardBuilder.build(board, [
    { name: recorded.engine, reads: new FakeEngine(FakeWorld.seed().state) },
  ])
  return BoardJson.of(model, { failureOf: () => ({ code: "unexpected" }), notes: [] })
}
