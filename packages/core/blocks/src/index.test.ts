import { describe, expect, it } from "vitest"
import * as blocks from "./index.js"

describe("the @miragon/pulse-blocks entry", () => {
  it("exports exactly the board's grid and tile, the problem list, the words of a problem and a note, an engine's process list and an instance's blocks", () => {
    expect(Object.keys(blocks).sort()).toStrictEqual([
      "BoardGrid",
      "BoardTile",
      "CalledInstanceMenu",
      "HeadlineStrip",
      "HistoryTable",
      "IncidentCard",
      "IncidentText",
      "InstanceFacts",
      "JsonText",
      "ListFilterBar",
      "MarkerLegend",
      "ProblemList",
      "ProcessTable",
      "VariablesTable",
      "WaitingTable",
      "useNoteLines",
      "useProblemWords",
      "useProcessList",
    ])
  })
})
