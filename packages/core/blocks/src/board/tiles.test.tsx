// @vitest-environment happy-dom
import { cleanup, render, within } from "@testing-library/react"
import { setFormatLocale } from "@miragon/pulse-ui"
import type { TileData } from "@miragon/pulse-board"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { translate } from "../messages/translate.js"
import { BoardTile } from "./board-grid.js"
import { testSlots } from "./slots.test-support.js"
import { COUNTER, DIAGRAM, INCIDENTS, INSTANCES, ORDER, SUMMARY } from "./tiles.test-support.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

function tileOf(tile: TileData): HTMLElement {
  const { container } = render(<BoardTile tile={tile} slots={testSlots().slots} />)
  return within(container).getByRole("region")
}

function parts(root: HTMLElement, part: string): string[] {
  return [...root.querySelectorAll(`[data-part="${part}"]`)].map((node) => node.textContent)
}

describe("a counter", () => {
  const widget = { widget: "counter", engines: ["local"], filter: { state: "running" } } as const
  const reading = { engine: "local", count: { count: 4 } } as const

  it("names its threshold quietly while every engine stays below it, and none without one", () => {
    const below = tileOf({ ...COUNTER, widget: { ...widget, warnAbove: 5 }, readings: [reading] })
    expect(parts(below, "counter-threshold")).toEqual(["warns above 5"])
    cleanup()
    const without = tileOf({ ...COUNTER, widget, readings: [reading] })
    expect(parts(without, "counter-threshold")).toEqual([])
  })

  it("warns in the warning style when an engine stopped counting at or below the threshold", () => {
    const capped = { engine: "local", count: { count: 3, atLeast: true }, undecided: true } as const
    const counter = tileOf({ ...COUNTER, widget: { ...widget, warnAbove: 5 }, readings: [capped] })

    expect(
      counter.querySelector('[data-part="counter-threshold"]')?.getAttribute("data-state"),
    ).toBe("undecided")
  })

  it("opens nothing for a count of instances without an incident", () => {
    const filter = { state: "running", withIncident: false } as const
    const counter = tileOf({ ...COUNTER, widget: { ...widget, filter }, readings: [reading] })

    expect(within(counter).queryByRole("button")).toBeNull()
    expect(parts(counter, "counter-entry")).toEqual(["local4"])
  })

  it("marks a count of instances with incident by its icon and words, and a missing total by a dash", () => {
    const filter = { state: "running", withIncident: true } as const
    const counter = tileOf({ ...COUNTER, widget: { ...widget, filter }, readings: [reading] })
    expect(counter.querySelector('[data-part="counter-count"][data-tone="danger"]')).not.toBeNull()
    expect(parts(counter, "counter-value")).toEqual(["12"])
    cleanup()
    const unknown = { kind: "counter", widget, readings: [reading], known: 1 } as const
    expect(parts(tileOf(unknown), "counter-value")).toEqual(["—"])
  })
})

describe("an incident summary", () => {
  const byEngine = { widget: "incidentSummary", engines: ["local"], groupBy: "engine" } as const

  it("lists per engine and says why it is empty", () => {
    const rows = [{ engine: "local", withIncident: 2 }]
    const { slots, asked } = testSlots()
    const { container } = render(
      <BoardTile tile={{ ...SUMMARY, widget: byEngine, rows }} slots={slots} />,
    )
    const list = within(container).getByRole("list", { name: "Per engine" })
    within(list).getByRole("button").click()
    expect(asked.opened[0]?.target).toEqual({
      kind: "instances",
      engine: "local",
      filter: { scope: "withIncident" },
    })
    cleanup()
    const none = tileOf({
      kind: "incidentSummary",
      widget: byEngine,
      engines: 1,
      known: 0,
      rows: [],
    })
    expect(parts(none, "empty-hint")).toEqual(["No engine was read."])
    expect(parts(none, "counter-value")).toEqual(["—"])
    cleanup()
    expect(parts(tileOf({ ...SUMMARY, rows: [] }), "empty-hint")).toEqual([
      "No instance has an open incident.",
    ])
  })
})

describe("the lists and the diagram", () => {
  it("say why a list is empty", () => {
    expect(
      parts(tileOf({ ...INSTANCES, groups: [{ engine: "local", instances: [] }] }), "empty-hint"),
    ).toEqual(["No instance matches on the engines that answered."])
    cleanup()
    expect(parts(tileOf({ ...INCIDENTS, groups: [{ engine: "local" }] }), "empty-hint")).toEqual([
      "No engine was read.",
    ])
    cleanup()
    expect(
      parts(tileOf({ ...INCIDENTS, groups: [{ engine: "local", incidents: [] }] }), "empty-hint"),
    ).toEqual(["No open incident on the engines that answered."])
  })

  it("keeps the engine column where the file places it, and leaves it out over one engine", () => {
    const placed = { ...INSTANCES.widget, columns: ["process", "engine"] } as const
    expect(
      within(tileOf({ ...INSTANCES, widget: placed }))
        .getAllByRole("columnheader")
        .map((head) => head.textContent),
    ).toEqual(["Process", "Engine"])
    cleanup()
    const alone = { ...INSTANCES.widget, engines: ["local"], columns: ["process"] } as const
    expect(
      within(tileOf({ ...INSTANCES, widget: alone }))
        .getAllByRole("columnheader")
        .map((head) => head.textContent),
    ).toEqual(["Process"])
  })

  it("leaves out the engine column of an incident list over one engine", () => {
    const one = tileOf({ ...INCIDENTS, groups: [INCIDENTS.groups[0]!] })
    expect(
      within(one)
        .getAllByRole("columnheader")
        .map((head) => head.textContent),
    ).toEqual(["Process", "Element", "Message", "Since"])
  })

  it("says why a diagram is missing instead of drawing it", () => {
    const diagram = tileOf({
      kind: "processDiagram",
      widget: DIAGRAM.widget,
      engine: "local",
      latest: ORDER,
    })
    expect(parts(diagram, "empty-hint")).toEqual(["The diagram was not read from local."])
    expect(within(diagram).queryByRole("figure")).toBeNull()
  })
})

describe("the translator", () => {
  it("leaves a placeholder without a value as it is and words a German locale in German", () => {
    expect(translate("en", "group.notRead")).toBe("{engine}: not read")
    expect(translate("de-AT", "notRead")).toBe("nicht gelesen")
  })
})
