import { describe, expect, it } from "vitest"
import * as blocks from "./index.js"

describe("the @miragon/pulse-blocks entry", () => {
  it("exports exactly the board's grid and tile, the problem list, the words of a problem and a note, an engine's process list, the engines side by side, an instance's blocks, a process's and what the search finds", () => {
    expect(Object.keys(blocks).sort()).toStrictEqual([
      "BadgeCluster",
      "BadgeLegend",
      "BoardGrid",
      "BoardTile",
      "CallButton",
      "CalledInstanceMenu",
      "EngineTable",
      "FindHistoryNotice",
      "FindResults",
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
      "MissingHistoryNotice",
      "OlderVersionsNotice",
      "ProblemList",
      "ProcessTable",
      "ProcessesByEngine",
      "ScopeSegments",
      "VariableDraft",
      "VariablesTable",
      "VersionPicker",
      "WaitingTable",
      "useCallLabel",
      "useDiagramDecorations",
      "useFleetSums",
      "useInstanceRows",
      "useNoteLines",
      "useProblemWords",
      "useProcessList",
    ])
  })
})
