import { describe, expect, it } from "vitest"
import * as blocks from "./index.js"

describe("the @miragon/pulse-blocks entry", () => {
  it("exports exactly the board's grid and tile, the problem list, the words of a problem and a note, an engine's process list, an instance's blocks and a process's", () => {
    expect(Object.keys(blocks).sort()).toStrictEqual([
      "BadgeCluster",
      "BadgeLegend",
      "BoardGrid",
      "BoardTile",
      "CallButton",
      "CalledInstanceMenu",
      "HeadlineStrip",
      "HistoryTable",
      "IncidentCard",
      "IncidentText",
      "InstanceFacts",
      "InstanceFilterBar",
      "InstanceFilters",
      "InstanceTable",
      "JsonText",
      "ListFilterBar",
      "LoadMore",
      "MarkerLegend",
      "OlderVersionsNotice",
      "ProblemList",
      "ProcessTable",
      "ScopeSegments",
      "VariableDraft",
      "VariablesTable",
      "VersionPicker",
      "WaitingTable",
      "useCallLabel",
      "useNoteLines",
      "useProblemWords",
      "useProcessList",
    ])
  })
})
