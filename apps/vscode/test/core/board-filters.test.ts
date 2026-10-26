import { describe, expect, test } from "vitest"
import { BoardFilters } from "../../src/core/boards/board-filters.js"
import { MessageGuards } from "../../src/core/protocol/index.js"

describe("a board filter", () => {
  test("asks the engine exactly what the file says", () => {
    expect(
      BoardFilters.query({
        state: "running",
        process: "order",
        activeElement: "Task_Pay",
        withIncident: false,
        businessKey: "B-1",
      }),
    ).toEqual({
      lifecycle: "running",
      bpmnProcessId: "order",
      activeElementId: "Task_Pay",
      withIncident: false,
      businessKey: "B-1",
    })
    expect(BoardFilters.query({ state: "ended" })).toEqual({ lifecycle: "ended" })
  })

  test("opens the definition panel in the scope that shows the same instances", () => {
    expect(BoardFilters.listFilter({ state: "ended" })).toEqual({ scope: "ended" })
    expect(
      BoardFilters.listFilter({
        state: "running",
        withIncident: true,
        activeElement: "Task_Pay",
        businessKey: "B-1",
      }),
    ).toEqual({ scope: "withIncident", elementId: "Task_Pay", businessKey: "B-1" })
  })

  test("opens nothing when the definition panel has no scope for the same instances", () => {
    expect(BoardFilters.listFilter({ state: "running", withIncident: false })).toBeUndefined()
    expect(BoardFilters.listFilter({ state: "ended", withIncident: true })).toBeUndefined()
  })

  test("names itself when the widget has no title", () => {
    expect(BoardFilters.title({ state: "running" })).toBe("Running instances")
    expect(
      BoardFilters.title({
        state: "running",
        process: "order",
        activeElement: "Task_Pay",
        withIncident: true,
        businessKey: "B-1",
      }),
    ).toBe("Running instances with incident of order at Task_Pay with key B-1")
    expect(BoardFilters.title({ state: "ended", withIncident: false })).toBe(
      "Ended instances without incident",
    )
  })
})

describe("the board intents from the webview", () => {
  test("accept engine names, ids, filters and the side flag", () => {
    const valid = [
      { type: "openBoardFile" },
      { type: "openBoardInstance", engine: "shop", instanceId: "i-1", toSide: false },
      {
        type: "openBoardProcess",
        engine: "shop",
        bpmnProcessId: "order",
        filter: { scope: "running", elementId: "Task_Pay" },
        toSide: true,
      },
      { type: "openBoardEngine", engine: "shop", toSide: false },
      { type: "setBoardCredentials", engine: "shop" },
    ]

    expect(valid.filter((intent) => !MessageGuards.isWebviewIntent(intent))).toEqual([])
  })

  test("refuse what a webview could only send by mistake or on purpose", () => {
    const invalid = [
      { type: "openBoardInstance", engine: "", instanceId: "i-1", toSide: false },
      { type: "openBoardInstance", engine: "shop", instanceId: "i-1" },
      {
        type: "openBoardProcess",
        engine: "shop",
        bpmnProcessId: "order",
        filter: { scope: "any" },
        toSide: false,
      },
      { type: "openBoardEngine", engine: "x".repeat(256), toSide: false },
      { type: "setBoardCredentials", engine: 7 },
    ]

    expect(invalid.filter((intent) => MessageGuards.isWebviewIntent(intent))).toEqual([])
  })
})
