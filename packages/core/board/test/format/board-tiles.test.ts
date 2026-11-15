import { describe, expect, test } from "vitest"
import { BoardParser, BoardTiles, type BoardDefinition } from "../../src/index.js"

function boardOf(board: unknown): BoardDefinition {
  const parsed = BoardParser.parse(JSON.stringify(board))
  if (!("board" in parsed)) {
    throw new Error("expected a board")
  }
  return parsed.board
}

const RUNNING = { widget: "counter", props: { title: "Running" } }
const TENANTS = [{ path: "tenants", code: "tenantsNotRead" }]

describe("the tiles a reader reads", () => {
  test("are the parsed rows of a board without tenants", () => {
    const board = boardOf({ title: "Shop", engines: ["shop"], rows: [{ row: [RUNNING, 3] }] })

    expect(BoardTiles.of(board)).toBe(board.rows)
  })

  test("refuse each widget of a board that names tenants in its place, since no read filters by tenant", () => {
    const board = boardOf({
      title: "Shop",
      engines: ["shop"],
      tenants: ["acme"],
      rows: [{ row: [RUNNING, { widget: "incidentList" }] }, { row: [{ widget: "chart" }] }],
    })

    expect(BoardTiles.of(board)).toEqual([
      [
        { widget: "counter", title: "Running", refused: TENANTS },
        { widget: "incidentList", refused: TENANTS },
      ],
      [
        {
          widget: "chart",
          refused: [
            {
              path: "rows[1].row[0].widget",
              code: "notOneOf",
              values: {
                choices: [
                  "counter",
                  "instanceList",
                  "incidentSummary",
                  "processDiagram",
                  "incidentList",
                ],
              },
            },
          ],
        },
      ],
    ])
  })
})
