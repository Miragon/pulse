/**
 * The same numbers on both surfaces, the MCP server's half: each dialect's recorded board engine
 * (c7-core's `C7_BOARD_ENGINE`, recorded from the conformance world on Operaton, and c8-core's
 * `C8_BOARD_ENGINE`, from the same world on a Camunda 8 cluster: a board over one engine and that
 * engine's answers) served on loopback by the transport's recorded engine, read through the board
 * feed over the server's own wire (the module's configuration and plugin, `engine_board_data`; the
 * generated SDK on the engine connection, or the Camunda 8 connection under C8Runtime). The feed
 * gives exactly the board the recording expects, the one the editors' adapter of the dialect
 * builds from the same answers over its wire (the C7 adapter's test/c7-board-numbers.test.ts, the
 * C8 adapter's test/c8-board-numbers.test.ts); the cockpit renders both in
 * widgets/board/board-view.numbers.test.tsx.
 */

import { afterEach, describe, expect, it } from "vitest"
import {
  bootRecordedBoard,
  closeRecordedBoards,
  RECORDED_C7,
  RECORDED_C8,
} from "./recorded-board.test-support.js"

afterEach(closeRecordedBoards)

describe.each([
  ["c7-core's recorded board engine, over the SDK wire", RECORDED_C7],
  ["c8-core's recorded board engine, over the server's Camunda 8 wire", RECORDED_C8],
])("the board feed over %s", (_name, recorded) => {
  it("asks the engine only what it answered and gives the board the recording expects", async () => {
    const { engine, read } = await bootRecordedBoard(recorded)
    const { asOf, ...board } = await read()
    expect(engine.unanswered).toEqual([])
    expect(Date.parse(asOf)).not.toBeNaN()
    expect(board).toEqual(recorded.board.expected)
  })
})
