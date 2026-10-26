import { describe, expect, test } from "vitest"
import { PanelOrigins } from "../../src/host/panels/panel-origins.js"

function originsWith(open: string[]) {
  const panels = new Set(open)
  return { panels, origins: new PanelOrigins((key) => panels.has(key)) }
}

describe("the origins behind the back button", () => {
  test("lead back to the panel a panel was opened from", () => {
    const { origins } = originsWith(["definition", "instance"])

    origins.remember("instance", "definition")

    expect(origins.of("instance")).toBe("definition")
    expect(origins.of("definition")).toBeUndefined()
  })

  test("never turn back and forth when a jump returns to an open panel", () => {
    const { origins } = originsWith(["definition", "instance", "called"])
    origins.remember("instance", "definition")
    origins.remember("called", "instance")

    origins.remember("definition", "instance")
    origins.remember("instance", "called")
    origins.remember("definition", "called")
    origins.remember("called", "called")

    expect([origins.of("definition"), origins.of("instance"), origins.of("called")]).toEqual([
      undefined,
      "definition",
      "instance",
    ])
  })

  test("take a new origin once the old one is closed or forgotten", () => {
    const { panels, origins } = originsWith(["definition", "instance", "engine"])
    origins.remember("instance", "definition")

    panels.delete("definition")
    expect(origins.of("instance")).toBeUndefined()
    origins.remember("instance", "engine")
    expect(origins.of("instance")).toBe("engine")

    origins.forget("instance")
    expect(origins.of("instance")).toBeUndefined()
  })

  test("ignore a jump without an origin", () => {
    const { origins } = originsWith(["instance"])

    origins.remember("instance", undefined)

    expect(origins.of("instance")).toBeUndefined()
  })
})
