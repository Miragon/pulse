// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { FindScreenData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ScreenSlots } from "../slots.js"
import { editorSlots, pageSlots } from "../slots.test-support.js"
import { FindHistoryNotice } from "./find-history-notice.js"
import { FindResults } from "./find-results.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const OTHER: FindScreenData = {
  ...WORLD_SCREENS.findById,
  engine: "prod-b",
  hits: [
    ...WORLD_SCREENS.findById.hits,
    {
      id: "3e9d1c2b-7a6f-4e5d-9c8b-1a2b3c4d5e6f",
      definition: { id: "audit:2", bpmnProcessId: "audit", version: 2 },
      state: "suspended",
      hasIncident: false,
      businessKey: "ORD-1003",
    },
  ],
  cut: true,
}

const FOUND = [WORLD_SCREENS.find, OTHER]

function shown(
  slots: ScreenSlots,
  found: readonly FindScreenData[] = FOUND,
  locale = "en",
  partial?: boolean,
) {
  return render(
    <LocaleProvider locale={locale}>
      <FindResults
        found={found}
        text="ORD-1003"
        most={20}
        slots={slots}
        {...(partial === undefined ? {} : { partial })}
      />
    </LocaleProvider>,
  ).container
}

function cells(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  )
}

describe("what the search finds, in the editors' table", () => {
  it("lists every engine's hits in the engines' order: id, business key, process and version, engine, state, start", () => {
    const { slots } = editorSlots()
    const container = shown(slots)

    expect([...container.querySelectorAll("thead th")].map((head) => head.textContent)).toEqual([
      "Instance",
      "Business key",
      "Process",
      "Engine",
      "State",
      "Started",
    ])
    expect(cells(container).map((row) => row.slice(1, 5))).toEqual([
      ["ORD-1003", "Order fulfillment v1", "conformance", "Completed"],
      ["—", "Print label v1", "prod-b", "RunningIncident"],
      ["ORD-1003", "audit v2", "prod-b", "Suspended"],
    ])
  })

  it("opens a row's instance on its engine and copies its id, named by its business key or short id", () => {
    const { slots, asked } = editorSlots()
    const container = shown(slots)
    const rows = within(container).getAllByRole("row").slice(1)

    fireEvent.click(rows[1] as HTMLElement)
    fireEvent.keyDown(rows[0] as HTMLElement, { key: "c", ctrlKey: true })

    expect(asked.opened).toEqual([
      {
        target: { kind: "instance", engine: "prod-b", instanceId: "fake-label-of-DSP-3001" },
        how: { toSide: false },
      },
    ])
    expect(asked.copied).toEqual([{ text: "fake-ORD-1003", label: "instance ID" }])
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Instance ORD-1003 on conformance",
      "Instance fake-label-of-DSP-3001 on prod-b",
      "Instance ORD-1003 on prod-b",
    ])
  })

  it("says under the rows which engines hold more instances with the business key than they list", () => {
    const { slots } = editorSlots()
    const container = shown(slots)

    expect(container.querySelector('[data-part="find-cut"]')?.textContent).toBe(
      "prod-b has more instances with this business key. The list shows the newest 20.",
    )
    expect(
      shown(slots, [WORLD_SCREENS.find]).querySelectorAll('[data-part="find-cut"]'),
    ).toHaveLength(0)
  })
})

describe("what the search finds, in a page's table", () => {
  it("links each row to its instance's address and drops the business key, the process and the start in a narrow region", () => {
    const { slots } = pageSlots()
    const container = shown(slots)

    expect(
      [...container.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-href")),
    ).toEqual([
      "/app/engines/conformance/instances/fake-ORD-1003",
      "/app/engines/prod-b/instances/fake-label-of-DSP-3001",
      "/app/engines/prod-b/instances/3e9d1c2b-7a6f-4e5d-9c8b-1a2b3c4d5e6f",
    ])
    expect(
      [...container.querySelectorAll("thead th")].map((head) =>
        head.getAttribute("data-hide-below"),
      ),
    ).toEqual([null, "40rem", "40rem", null, null, "40rem"])
  })

  it("says what was searched and that the search is exact where nothing was found", () => {
    const { slots } = pageSlots()
    const none = { ...WORLD_SCREENS.find, hits: [] }

    expect(shown(slots, [none]).textContent).toBe(
      'No instance has the ID or the business key "ORD-1003". Pulse finds the whole ID or the exact business key, never a part of one.',
    )
    expect(shown(slots, [none], "de").textContent).toContain(
      "Keine Instanz hat die ID oder den Geschäftsschlüssel „ORD-1003“.",
    )
  })

  it("speaks only of the engines that could be searched where some could not", () => {
    const { slots } = pageSlots()
    const none = { ...WORLD_SCREENS.find, hits: [] }

    expect(shown(slots, [none], "en", true).textContent).toBe(
      'No engine that could be searched has an instance with the ID or the business key "ORD-1003". Pulse finds the whole ID or the exact business key, never a part of one.',
    )
    expect(shown(slots, [none], "de", true).textContent).toBe(
      "Keine Engine, die sich durchsuchen ließ, hat eine Instanz mit der ID oder dem Geschäftsschlüssel „ORD-1003“. Pulse findet die ganze ID oder den genauen Geschäftsschlüssel, nie einen Teil davon.",
    )
    expect(cells(shown(slots, FOUND, "en", true))).toHaveLength(3)
  })

  it("speaks German on a German page", () => {
    const { slots } = pageSlots()
    const container = shown(slots, FOUND, "de")

    expect([...container.querySelectorAll("thead th")].map((head) => head.textContent)).toEqual([
      "Instanz",
      "Geschäftsschlüssel",
      "Prozess",
      "Engine",
      "Zustand",
      "Gestartet",
    ])
    expect(container.querySelector("table")?.getAttribute("aria-label")).toBe("Gefundene Instanzen")
    expect(container.querySelector("tfoot")?.textContent).toBe(
      "prod-b hat mehr Instanzen mit diesem Geschäftsschlüssel. Die Liste zeigt die neuesten 20.",
    )
  })
})

describe("the notice of an engine whose history misses running instances", () => {
  const notice = (found: Pick<FindScreenData, "engine" | "historyGap">, locale = "en") =>
    render(
      <LocaleProvider locale={locale}>
        <FindHistoryNotice found={found} />
      </LocaleProvider>,
    ).container.textContent

  it("says how many of the engine's running instances its history holds, and that the search finds only those", () => {
    expect(notice({ engine: "prod-a", historyGap: { running: 1204, counted: 0 } })).toBe(
      "Running instances are missing from the history of prod-aThe engine's history holds 0 of 1,204 running instances. The search finds only the instances in the history.",
    )
    expect(notice({ engine: "prod-a", historyGap: { running: 1, counted: 0 } }, "de")).toContain(
      "Die Historie der Engine kennt 0 von 1 laufenden Instanz.",
    )
  })

  it("renders nothing without a gap", () => {
    expect(notice({ engine: "prod-a", historyGap: null })).toBe("")
  })
})
