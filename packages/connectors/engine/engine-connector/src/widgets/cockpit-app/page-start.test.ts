import { describe, expect, it } from "vitest"
import { cockpitNamesEngine } from "./page-start.js"

/** The landing's start data as `engine_open_cockpit` answers it: every configured engine. */
const LANDING = {
  engineId: null,
  engines: [
    { id: "prod-a", environment: "default", dialect: "c7" },
    { id: "locked", environment: "default", refused: { reason: "auth.tokenEnv is not set." } },
  ],
  start: { view: { section: "landing" }, data: { boards: [], refusedBoards: [] } },
}

describe("whether the cockpit's start names an engine a page's address names", () => {
  it("names an engine the server configures, a refused profile too", () => {
    expect(cockpitNamesEngine(LANDING, "prod-a")).toBe(true)
    expect(cockpitNamesEngine(LANDING, "locked")).toBe(true)
  })

  it("names none the server does not configure, and none where the data is no cockpit's", () => {
    expect(cockpitNamesEngine(LANDING, "typo")).toBe(false)
    expect(cockpitNamesEngine({ ...LANDING, engines: [] }, "prod-a")).toBe(false)
    expect(cockpitNamesEngine({ ...LANDING, engines: ["prod-a", null] }, "prod-a")).toBe(false)
    expect(cockpitNamesEngine({ engineId: null }, "prod-a")).toBe(false)
    expect(cockpitNamesEngine(null, "prod-a")).toBe(false)
  })
})
