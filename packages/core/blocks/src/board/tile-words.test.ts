import { setFormatLocale } from "@miragon/pulse-ui"
import type { CounterData, CounterReadingData, TileData } from "@miragon/pulse-board"
import { beforeEach, describe, expect, it } from "vitest"
import { translate, type Words } from "../messages/translate.js"
import { COUNTER, DIAGRAM, INCIDENTS, INSTANCES, SUMMARY } from "./tiles.test-support.js"
import {
  diagramMissing,
  filterTitle,
  partial,
  summaryLabel,
  tileTitle,
  totalCount,
  warning,
} from "./tile-words.js"

const t: Words = (key, params) => translate("en", key, params)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

function counter(readings: readonly CounterReadingData[], warnAbove?: number): CounterData {
  const widget = { widget: "counter", engines: ["a"], filter: { state: "running" } } as const
  return {
    ...COUNTER,
    widget: warnAbove === undefined ? widget : { ...widget, warnAbove },
    readings,
  }
}

describe("a tile's title", () => {
  it("comes from the filter of a counter or a list the file leaves untitled", () => {
    expect(
      filterTitle(t, {
        state: "running",
        process: "order",
        activeElement: "Task_Pay",
        withIncident: true,
        businessKey: "B-1",
      }),
    ).toBe("Running instances with incident of order at Task_Pay with key B-1")
    expect(filterTitle(t, { state: "ended", withIncident: false })).toBe(
      "Ended instances without incident",
    )
  })

  it("comes from the kind, the process or the widget where the filter gives none", () => {
    const untitled = (tile: TileData): string => tileTitle(t, tile)
    const engines = ["local"]
    const filter = { state: "running", process: "order" } as const

    expect(untitled({ ...COUNTER, widget: { widget: "counter", engines, filter } })).toBe(
      "Running instances of order",
    )
    const columns = ["process"] as const
    const list = { widget: "instanceList", engines, filter: { state: "running" }, columns } as const
    expect(untitled({ ...INSTANCES, widget: list })).toBe("Running instances")
    expect(untitled(SUMMARY)).toBe("Instances with incident")
    expect(untitled(DIAGRAM)).toBe("Order fulfillment")
    expect(untitled({ kind: "processDiagram", widget: DIAGRAM.widget, engine: "local" })).toBe(
      "order",
    )
    expect(untitled({ ...INCIDENTS, widget: { widget: "incidentList", engines } })).toBe(
      "Open incidents",
    )
    expect(untitled({ kind: "refused", problems: [] })).toBe("Widget")
    expect(untitled({ kind: "refused", widget: "chart", title: "Mine", problems: [] })).toBe("Mine")
  })
})

describe("a counter's warning", () => {
  const above = (engine: string): CounterReadingData => ({
    engine,
    count: { count: 25000 },
    above: true,
  })
  const capped = (engine: string): CounterReadingData => ({
    engine,
    count: { count: 10000, atLeast: true },
    undecided: true,
  })

  it("names the engines above the threshold and those that stopped counting", () => {
    expect(warning(t, counter([above("a"), above("b"), capped("c")], 20000))).toBe(
      "2 engines above 20,000 · c stopped counting at 10,000 · warns above 20,000",
    )
    expect(warning(t, counter([capped("c"), capped("d")], 20000))).toBe(
      "2 engines stopped counting · warns above 20,000",
    )
    expect(warning(t, counter([{ engine: "c", undecided: true }], 20000))).toBe(
      "c stopped counting at 0 · warns above 20,000",
    )
  })

  it("says nothing without a threshold or with every engine below it", () => {
    expect(warning(t, counter([above("a"), capped("c")]))).toBeUndefined()
    expect(warning(t, counter([{ engine: "a", count: { count: 1 } }], 5))).toBeUndefined()
  })
})

describe("the other words of a tile", () => {
  it("say how many engines a total comes from only when some were not read", () => {
    expect(partial(t, COUNTER)).toBe("from 2 of 3 engines")
    expect(partial(t, { ...SUMMARY, known: 2 })).toBeUndefined()
    expect(partial(t, { ...SUMMARY, engines: 1, known: 0 })).toBe("from 0 of 1 engine")
  })

  it("name a summary row by its engine without a process, a total that is missing by a dash", () => {
    expect(summaryLabel({ engine: "local", withIncident: 2 })).toBe("local")
    expect(totalCount(undefined)).toBe("—")
    expect(totalCount({ count: 10000, atLeast: true })).toBe("≥ 10,000")
  })

  it("say why a diagram is missing", () => {
    const unread = { kind: "processDiagram", widget: DIAGRAM.widget, engine: "local" } as const
    expect(diagramMissing(t, unread)).toBe("The diagram was not read from local.")
    expect(diagramMissing(t, { ...unread, notDeployed: true })).toBe(
      "order is not deployed on local, or you may not have permission to see it.",
    )
  })
})
