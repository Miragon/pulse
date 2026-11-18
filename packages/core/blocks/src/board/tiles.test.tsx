// @vitest-environment happy-dom
import { cleanup, render, within } from "@testing-library/react"
import { setFormatLocale } from "@miragon/pulse-ui"
import type { TileData } from "@miragon/pulse-board"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { translate } from "../messages/translate.js"
import { BoardTile } from "./board-grid.js"
import type { BoardSlots } from "./slots.js"
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
    // One engine of two answered: the note speaks of it alone, never of the one not read.
    expect(parts(tileOf({ ...SUMMARY, total: 0, rows: [] }), "empty-hint")).toEqual([
      "No instance has an open incident on the engines that answered.",
    ])
    cleanup()
    expect(parts(tileOf({ ...SUMMARY, known: 2, total: 0, rows: [] }), "empty-hint")).toEqual([
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

  // An untitled list over every process is named "Open incidents": its table never shares it.
  it("names an incident list's table apart from its tile, as an instance list's", () => {
    const names = (tile: TileData) => {
      const region = tileOf(tile)
      const name = (element: HTMLElement) =>
        element.getAttribute("aria-label") ??
        document.getElementById(element.getAttribute("aria-labelledby") ?? "")?.textContent
      const names = [name(region), name(within(region).getByRole("table"))]
      cleanup()
      return names
    }
    const untitled = { widget: "incidentList", engines: ["local", "test"] } as const
    expect(names({ ...INCIDENTS, widget: untitled })).toEqual(["Open incidents", "Incidents"])
    expect(names(INCIDENTS)).toEqual(["Open incidents of order", "Incidents"])
    expect(names(INSTANCES)).toEqual(["Orders", "Instances"])
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

// A surface's `opens` (the cockpit leaves out what no view of its reads, a Camunda 8 engine's): a
// target it does not open is offered nowhere, and the tiles ask it to open none.
describe("a target the surface does not open", () => {
  const notLocal = (target: { readonly engine: string }) => target.engine !== "local"

  function rendered(tile: TileData) {
    const { slots, asked } = testSlots({ opens: notLocal })
    const { container } = render(<BoardTile tile={tile} slots={slots} />)
    const region = within(container).getByRole("region")
    for (const button of within(region).queryAllByRole("button")) button.click()
    return { region, asked }
  }

  it("keeps a counter's and a summary's line of its engine as text, the others still open", () => {
    const counter = rendered(COUNTER)
    expect(
      within(counter.region)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["test2"])
    expect(counter.asked.opened.map(({ target }) => target.engine)).toEqual(["test"])
    cleanup()
    const summary = rendered(SUMMARY)
    expect(within(summary.region).queryAllByRole("button")).toEqual([])
    expect(summary.asked.opened).toEqual([])
  })

  it("makes a list's row of its engine a plain row that opens nothing", () => {
    for (const tile of [INSTANCES, INCIDENTS]) {
      const { region, asked } = rendered(tile)
      const rows = within(region).getAllByRole("row").slice(1)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.hasAttribute("aria-label")).toBe(false)
        row.click()
      }
      expect(asked.opened).toEqual([])
      cleanup()
    }
  })

  // A surface's table that offers every row anyway (it reads no `opens`): the tile opens none of
  // what the surface opens not.
  it("opens no row of its engine through a table that offers every row", () => {
    for (const tile of [INSTANCES, INCIDENTS]) {
      const { slots, asked } = testSlots({ opens: notLocal })
      const OpensAll: BoardSlots["Table"] = ({ rows, onOpen }) => (
        <button
          type="button"
          onClick={() => {
            for (const row of rows) onOpen(row, { toSide: false })
          }}
        >
          every row
        </button>
      )
      const { container } = render(<BoardTile tile={tile} slots={{ ...slots, Table: OpensAll }} />)
      within(container).getByRole("button", { name: "every row" }).click()
      expect(asked.opened).toEqual([])
      cleanup()
    }
  })

  it("draws a diagram of its engine without a way into the process, its badges open nothing", () => {
    const { region, asked } = rendered(DIAGRAM)
    expect(within(region).queryByRole("button", { name: /Open process/ })).toBeNull()
    expect(within(region).getByRole("figure")).toBeTruthy()
    expect(asked.opened).toEqual([])
  })
})
