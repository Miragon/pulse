// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { InstanceListFilterData, InstanceRowData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ScreenSlots } from "../slots.js"
import { editorSlots, pageSlots } from "../slots.test-support.js"
import { InstanceTable, type InstanceMoreSlot, type InstanceSelectSlot } from "./instance-table.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const ROWS: readonly InstanceRowData[] = [
  ...WORLD_SCREENS.instanceList.rows,
  { id: "3e9d1c2b-7a6f-4e5d-9c8b-1a2b3c4d5e6f", state: "terminated", hasIncident: false },
  { id: "fake-ORD-1004", state: "suspended", hasIncident: true, businessKey: "ORD-1004" },
]

interface Shown {
  readonly slots: ScreenSlots
  readonly rows?: readonly InstanceRowData[]
  readonly filter?: InstanceListFilterData
  readonly more?: InstanceMoreSlot
  readonly select?: InstanceSelectSlot<InstanceRowData>
  readonly locale?: string
}

function tableOf({
  slots,
  rows = ROWS,
  filter = { scope: "all" },
  more,
  select,
  locale = "en",
}: Shown) {
  const asked: InstanceListFilterData[] = []
  const { container } = render(
    <LocaleProvider locale={locale}>
      <InstanceTable
        engine="conformance"
        rows={rows}
        filter={filter}
        onFilter={(next) => asked.push(next)}
        more={more}
        select={select}
        slots={slots}
      />
    </LocaleProvider>,
  )
  return { container, asked }
}

function cells(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  )
}

describe("the instance table in the editors' table", () => {
  it("lists every instance with its id, business key, state and start, an incident beside it", () => {
    const { slots } = editorSlots()
    const { container } = tableOf({ slots })

    expect(within(container).getByRole("table", { name: "Instances" })).toBeTruthy()
    expect([...container.querySelectorAll("th")].map((head) => head.textContent)).toEqual([
      "ID",
      "Business key",
      "State",
      "Started",
    ])
    expect(cells(container).map(([, key, state]) => [key, state])).toEqual([
      ["ORD-1001", "Running"],
      ["ORD-1002", "RunningIncident"],
      ["ORD-1003", "Completed"],
      ["—", "Cancelled"],
      ["ORD-1004", "SuspendedIncident"],
    ])
    expect(cells(container)[0]?.[3]).toMatch(/08:00 · /)
    expect(cells(container)[3]?.[3]).toBe("—")
    expect(container.querySelector('[data-part="incident-flag"]')?.getAttribute("title")).toBe(
      "Has an open incident",
    )
  })

  it("opens a row's instance, named by its business key or short id, and copies its id", () => {
    const { slots, asked } = editorSlots()
    const { container } = tableOf({ slots })
    const rows = within(container).getAllByRole("row").slice(1)

    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Instance ORD-1001",
      "Instance ORD-1002",
      "Instance ORD-1003",
      "Instance 3e9d1c2b…",
      "Instance ORD-1004",
    ])
    fireEvent.click(rows[1]!)
    fireEvent.keyDown(rows[1]!, { key: "c", ctrlKey: true })
    expect(asked.opened).toEqual([
      {
        target: { kind: "instance", engine: "conformance", instanceId: "fake-ORD-1002" },
        how: { toSide: false },
      },
    ])
    expect(asked.copied).toEqual([{ text: "fake-ORD-1002", label: "instance ID" }])
  })

  it("puts the surface's selection first, and Space on a row toggles it", () => {
    const { slots } = editorSlots()
    const toggled: string[] = []
    const { container } = tableOf({
      slots,
      select: {
        column: {
          key: "select",
          label: "Select",
          header: <input type="checkbox" aria-label="Select all shown instances" />,
          width: 32,
          cell: (row) => <input type="checkbox" aria-label={`Select ${row.id}`} />,
        },
        onToggle: (row) => toggled.push(row.id),
      },
    })

    expect(
      within(container).getByRole("checkbox", { name: "Select all shown instances" }),
    ).toBeTruthy()
    fireEvent.keyDown(within(container).getAllByRole("row")[2]!, { key: " " })
    expect(toggled).toEqual(["fake-ORD-1002"])
  })

  it("shows Load more under its rows, what the surface says beside it, and its way to ask again", () => {
    const { slots } = editorSlots()
    const asks: string[] = []
    const { container } = tableOf({
      slots,
      more: {
        busy: false,
        onMore: () => asks.push("more"),
        beside: (retry) => (
          <button type="button" onClick={retry}>
            Again
          </button>
        ),
      },
    })

    fireEvent.click(within(container).getByRole("button", { name: "Load more" }))
    fireEvent.click(within(container).getByRole("button", { name: "Again" }))
    expect(asks).toEqual(["more", "more"])
    expect(document.activeElement).toBe(
      within(container).getByRole("button", { name: "Load more" }),
    )
  })

  it("says that no instance matches the filter", () => {
    const { slots } = editorSlots()
    const { container } = tableOf({ slots, rows: [] })

    expect(container.querySelector('[data-part="table-empty"]')?.textContent).toBe(
      "No instances match this filter.",
    )
  })
})

describe("the instance table in a page's table", () => {
  it("links each row to its instance and offers to clear the variable conditions that left none", () => {
    const { slots } = pageSlots()
    const { container } = tableOf({ slots })
    expect(container.querySelector("tbody tr")?.getAttribute("data-href")).toBe(
      "/app/engines/conformance/instances/fake-ORD-1001",
    )
    cleanup()

    const filter: InstanceListFilterData = {
      scope: "ended",
      businessKey: "ORD-1",
      variables: [{ name: "route", operator: "equals", value: "review" }],
    }
    const empty = tableOf({ slots, rows: [], filter })
    expect(empty.container.textContent).toBe(
      "No ended instances match these variable conditions. An engine that keeps no variable history finds none.Clear variable conditions",
    )
    fireEvent.click(
      within(empty.container).getByRole("button", { name: "Clear variable conditions" }),
    )
    expect(empty.asked).toEqual([{ scope: "ended", businessKey: "ORD-1" }])
  })

  it("speaks German under a German locale", () => {
    const { slots } = pageSlots()
    const { container } = tableOf({
      slots,
      locale: "de",
      more: { busy: true, onMore: () => undefined },
    })

    expect([...container.querySelectorAll("th")].map((head) => head.textContent)).toEqual([
      "ID",
      "Geschäftsschlüssel",
      "Status",
      "Gestartet",
    ])
    expect(cells(container)[1]?.[2]).toBe("LäuftIncident")
    expect(container.querySelector("tbody tr")?.getAttribute("aria-label")).toBe("Instanz ORD-1001")
    const more = within(container).getByRole("button", { name: "Mehr laden" })
    expect([more.getAttribute("aria-disabled"), more.title]).toEqual([
      "true",
      "Warte, bis die Aktualisierung fertig ist",
    ])
    cleanup()
    const empty = tableOf({
      slots,
      rows: [],
      locale: "de",
      filter: { scope: "withIncident", variables: [{ name: "a", operator: "equals", value: "1" }] },
    })
    expect(empty.container.textContent).toContain(
      "Keine Instanz mit Incident passt zu diesen Variablenbedingungen.",
    )
  })
})
