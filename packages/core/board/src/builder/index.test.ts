import { describe, expect, it } from "vitest"
import * as builder from "./index.js"

describe("the @miragon/pulse-board/builder entry", () => {
  it("exports exactly the builder, the JSON form of what it built, the diagram roll-up of a board's numbers and the call activities of a diagram", () => {
    expect(Object.keys(builder).sort()).toStrictEqual([
      "BoardBuilder",
      "BoardJson",
      "CallActivities",
      "CollapsedShapes",
      "DiagramBadges",
    ])
  })
})
