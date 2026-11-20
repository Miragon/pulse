import { describe, expect, it } from "vitest"
import * as builder from "./index.js"

describe("the @miragon/pulse-screens/builder entry", () => {
  it("exports exactly the engine screen's builder and the JSON form of what it built", () => {
    expect(Object.keys(builder).sort()).toStrictEqual(["EngineScreen", "ScreenJson"])
  })
})
