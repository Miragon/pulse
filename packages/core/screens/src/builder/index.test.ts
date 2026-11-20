import { describe, expect, it } from "vitest"
import * as builder from "./index.js"

describe("the @miragon/pulse-screens/builder entry", () => {
  it("exports exactly the screens' builders, the call links and the JSON form of what they built", () => {
    expect(Object.keys(builder).sort()).toStrictEqual([
      "CallLinks",
      "EngineScreen",
      "InstanceScreen",
      "ScreenJson",
    ])
  })
})
