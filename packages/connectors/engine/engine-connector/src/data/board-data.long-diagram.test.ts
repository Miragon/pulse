/**
 * A board whose process diagram is longer than the board builder reads (4 Mi characters, Zeebe's
 * default message limit), over the server's wire of each dialect: the recorded board engine of
 * c7-core and of c8-core (recorded-board.test-support.ts), its diagram's XML answered with spaces
 * behind it. The builder rolls nothing up into a collapsed subprocess then, and the board's notes
 * say so, naming the diagram's tile, never a badge that is silently missing.
 */

import { afterEach, describe, expect, it } from "vitest"
import type { RecordedAnswer } from "@miragon/pulse-http/testing/loopback"
import type { BoardData } from "@miragon/pulse-board"
import {
  bootRecordedBoard,
  closeRecordedBoards,
  RECORDED_C7,
  RECORDED_C8,
} from "./recorded-board.test-support.js"

afterEach(closeRecordedBoards)

const LONGEST = 4 * 1024 * 1024

/** Each diagram's XML padded to `length` characters: Camunda 7's in its JSON, Camunda 8's as text. */
function drawnAs(answers: readonly RecordedAnswer[], length: number): RecordedAnswer[] {
  const padded = (xml: string) => `${xml}${" ".repeat(length - xml.length)}`
  return answers.map((recorded) => {
    if ("text" in recorded) return { ...recorded, text: padded(recorded.text) }
    const answer = recorded.answer as { bpmn20Xml?: unknown }
    return typeof answer.bpmn20Xml === "string"
      ? { ...recorded, answer: { ...answer, bpmn20Xml: padded(answer.bpmn20Xml) } }
      : recorded
  })
}

/**
 * The note on each of the board's diagram tiles: where it stands, as the board file's paths name
 * it, with the title its card shows (the widget's, else the process's name or id) and its engine.
 */
function diagramNotes(board: Pick<BoardData, "rows">) {
  return board.rows.flatMap((row, rowIndex) =>
    row.flatMap((tile, index) =>
      tile.kind === "processDiagram"
        ? [
            {
              path: `rows[${String(rowIndex)}].row[${String(index)}]`,
              code: "diagramTooLong",
              values: {
                title: tile.widget.title ?? tile.latest?.name ?? tile.widget.process,
                engine: tile.engine,
              },
            },
          ]
        : [],
    ),
  )
}

describe.each([
  ["c7-core's recorded board engine, over the SDK wire", RECORDED_C7],
  ["c8-core's recorded board engine, over the server's Camunda 8 wire", RECORDED_C8],
])("the board feed over %s", (_name, recorded) => {
  it("notes a diagram longer than it reads where its tile stands, and keeps the tile's badges", async () => {
    const expected = recorded.board.expected as BoardData
    const notes = diagramNotes(expected)
    expect(notes).toHaveLength(1)
    const { read } = await bootRecordedBoard(recorded, drawnAs(recorded.board.answers, LONGEST + 1))
    const board = await read()
    expect(board.notes).toEqual([...expected.notes, ...notes])
    const diagrams = board.rows.flat().filter((tile) => tile.kind === "processDiagram")
    expect(diagrams.map((tile) => (tile.badges ?? []).length > 0)).toEqual([true])
  })

  it("notes nothing for a diagram it reads whole", async () => {
    const { read } = await bootRecordedBoard(recorded, drawnAs(recorded.board.answers, LONGEST))
    const board = await read()
    expect(board.notes).toEqual((recorded.board.expected as BoardData).notes)
  })
})
