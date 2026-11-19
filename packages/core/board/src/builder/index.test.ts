import { describe, expect, it } from "vitest"
import * as builder from "./index.js"

describe("the @miragon/pulse-board/builder entry", () => {
  it("exports exactly the builder, the JSON form of what it built and the diagram roll-up of a board's numbers", () => {
    expect(Object.keys(builder).sort()).toStrictEqual([
      "BoardBuilder",
      "BoardJson",
      "CollapsedShapes",
      "DiagramBadges",
    ])
  })
})
