import { BoardParser, type BoardData } from "@miragon/pulse-board"
import { BoardBuilder, BoardJson, type BoardReads } from "@miragon/pulse-board/builder"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"

export class RecordedBoard {
  static parse() {
    const parsed = BoardParser.parse(C7_BOARD_ENGINE.text)
    if (!("board" in parsed)) {
      throw new Error(JSON.stringify(parsed.problems))
    }
    return parsed
  }

  static async build(reads: BoardReads): Promise<BoardData> {
    const { board, notes } = RecordedBoard.parse()
    const model = await BoardBuilder.build(board, [{ name: C7_BOARD_ENGINE.engine, reads }])
    return BoardJson.of(model, { failureOf: () => ({ code: "unknown" }), notes })
  }
}
