import { describe, expect, it } from "vitest"
import { cockpitAfterFailedStart } from "./failed-start.js"

const UNREACHABLE = new Error("[503 ProcessEngineException] Engine is shutting down (engine down)")

describe("the cockpit after a page's failed start", () => {
  it("opens the engine's view without data, its ids as the page named them", () => {
    expect(cockpitAfterFailedStart({ engine: "down" }, UNREACHABLE)).toEqual({
      engineId: "down",
      engines: [],
      start: null,
      startView: { section: "overview" },
    })
    expect(
      cockpitAfterFailedStart(
        { engine: "down", view: "process-detail", processDefinitionKey: "invoice" },
        UNREACHABLE,
      ),
    ).toMatchObject({ startView: { section: "process-detail", processDefinitionKey: "invoice" } })
  })

  it.each([
    ["a refusal no retry changes", { engine: "c8", view: "jobs" }, "[ENGINE_DIALECT_NOT_SERVED] x"],
    ["arguments the tool does not take", { engine: "down" }, "Input validation error: engine"],
    ["a refused profile", { engine: "old" }, '[ENGINE_PROFILE_REFUSED] Engine "old"'],
    ["no engine, whose default the page does not know", { view: "jobs" }, UNREACHABLE.message],
    ["an empty engine", { engine: "" }, UNREACHABLE.message],
    ["an app route", { engine: "down", view: "board", board: "orders" }, UNREACHABLE.message],
    ["the landing", { engine: "down", view: "landing" }, UNREACHABLE.message],
    ["a view no route has", { engine: "down", view: "toString" }, UNREACHABLE.message],
  ])("leaves %s to the page's frame", (_case, args, message) => {
    expect(cockpitAfterFailedStart(args, new Error(message))).toBeNull()
  })
})
