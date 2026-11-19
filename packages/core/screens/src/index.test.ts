import { describe, expect, it } from "vitest"
import * as screens from "./index.js"
import * as testing from "./testing/index.js"

describe("the @miragon/pulse-screens entries", () => {
  it("export exactly the pure rules a surface applies to a screen's JSON form", () => {
    expect(Object.keys(screens).sort()).toStrictEqual(["FleetSums", "ProcessFilter"])
  })

  it("export exactly the screens of the kit's fixed world and a screen's figures from ./testing", () => {
    expect(Object.keys(testing).sort()).toStrictEqual(["ScreenFigures", "WORLD_SCREENS"])
  })
})
