// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import {
  ProcessFilter,
  type EngineTotalsData,
  type ProcessFilterData,
  type ProcessRowData,
} from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ProcessTable } from "./process-table.js"
import type { ScreenSlots } from "./slots.js"
import { editorSlots, pageSlots } from "./slots.test-support.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const SCREEN = WORLD_SCREENS.engine

const BUSY: ProcessRowData = {
  bpmnProcessId: "shipment",
  latestVersion: 4,
  running: 1_204,
  withIncident: 0,
}

const PROCESSES = [...SCREEN.processes, BUSY]

/** The totals an engine screen gives over these processes, as the builder sums them. */
function totalsOf(processes: readonly ProcessRowData[]): EngineTotalsData {
  const sum = (count: (row: ProcessRowData) => number) =>
    processes.reduce((total, row) => total + count(row), 0)
  return {
    processes: processes.length,
    running: sum((row) => row.running),
    withIncident: sum((row) => row.withIncident),
  }
}

function tableOf(
  slots: ScreenSlots,
  filter: ProcessFilterData = { scope: "all" },
  processes: readonly ProcessRowData[] = PROCESSES,
  wrap: (node: ReactNode) => ReactNode = (node) => node,
) {
  const listed = ProcessFilter.apply(processes, filter)
  const { container } = render(
    wrap(
      <ProcessTable
        engine="prod-a"
        listed={listed}
        filter={filter}
        totals={totalsOf(processes)}
        slots={slots}
      />,
    ),
  )
  return container
}

function texts(nodes: Iterable<Element>): string[] {
  return [...nodes].map((node) => node.textContent)
}

function rowsOf(container: HTMLElement): HTMLTableRowElement[] {
  return [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")]
}

describe("the process table in the editors' table", () => {
  it("lists every process with its name and BPMN process ID, latest version and counts", () => {
    const container = tableOf(editorSlots().slots)

    expect(within(container).getByRole("table", { name: "Processes" })).toBeTruthy()
    expect(texts(container.querySelectorAll("th"))).toEqual([
      "Process",
      "Latest version",
      "Running",
      "With incident",
    ])
    expect(rowsOf(container).map((row) => texts(row.querySelectorAll("td")))).toEqual([
      ["Order fulfillment pulse-order", "v2", "3", "1Has open incidents"],
      ["Dispatch order pulse-dispatch", "v1", "1", "1Has open incidents"],
      ["Print label pulse-label", "v1", "1", "1Has open incidents"],
      ["shipment", "v4", "1,204", "0"],
    ])
    expect(within(container).getByTestId("editor-table").dataset.name).toBe("processes")
  })

  it("draws the alarm icon of an instance with incident above 0 only, the figure neutral", () => {
    const [order, , , shipment] = rowsOf(tableOf(editorSlots().slots))
    const alarm = order?.querySelector('[data-part="incident-count"]')
    const calm = shipment?.querySelector('[data-part="incident-count"]')

    expect(alarm?.getAttribute("data-tone")).toBe("danger")
    expect(alarm?.querySelector('[data-slot="count-figure"]')?.getAttribute("data-tone")).toBe(
      "danger",
    )
    expect(alarm?.querySelector("svg")).not.toBeNull()
    expect(calm?.hasAttribute("data-tone")).toBe(false)
    expect(calm?.querySelector("svg")).toBeNull()
  })

  it("opens a process on a click, beside the view with Ctrl, and copies its BPMN process ID", () => {
    const { slots, asked } = editorSlots()
    const container = tableOf(slots)
    const order = within(container).getByRole("row", { name: "Process Order fulfillment" })
    const shipment = within(container).getByRole("row", { name: "Process shipment" })

    fireEvent.click(order)
    fireEvent.click(shipment, { ctrlKey: true })
    order.focus()
    fireEvent.keyDown(order, { key: "c", ctrlKey: true })

    expect(asked.opened).toEqual([
      {
        target: { kind: "process", engine: "prod-a", bpmnProcessId: "pulse-order" },
        how: { toSide: false },
      },
      {
        target: { kind: "process", engine: "prod-a", bpmnProcessId: "shipment" },
        how: { toSide: true },
      },
    ])
    expect(asked.copied).toEqual([{ text: "pulse-order", label: "BPMN process ID" }])
  })
})

describe("the process table in a page's table", () => {
  it("links each row to the process it opens and drops the version and the running count when narrow", () => {
    const container = tableOf(pageSlots().slots)

    expect(rowsOf(container).map((row) => row.dataset.href)).toEqual([
      "/app/engines/prod-a/processes/pulse-order",
      "/app/engines/prod-a/processes/pulse-dispatch",
      "/app/engines/prod-a/processes/pulse-label",
      "/app/engines/prod-a/processes/shipment",
    ])
    expect(
      [...container.querySelectorAll("th")].map((head) => [
        head.textContent,
        head.dataset.hideBelow,
      ]),
    ).toEqual([
      ["Process", undefined],
      ["Latest version", "40rem"],
      ["Running", "40rem"],
      ["With incident", undefined],
    ])
  })

  it("opens a row on a click or Enter and copies it, its id named for what it is", () => {
    const { slots, asked } = pageSlots()
    const container = tableOf(slots)
    const label = within(container).getByRole("row", { name: "Process Print label" })

    fireEvent.click(label)
    fireEvent.keyDown(label, { key: "Enter" })
    fireEvent.keyDown(label, { key: "c", metaKey: true })

    expect(asked.opened.map(({ target }) => target)).toEqual([
      { kind: "process", engine: "prod-a", bpmnProcessId: "pulse-label" },
      { kind: "process", engine: "prod-a", bpmnProcessId: "pulse-label" },
    ])
    expect(asked.copied).toEqual([{ text: "pulse-label", label: "BPMN process ID" }])
    expect(within(label).getByTitle("BPMN process ID").textContent).toBe(
      "Print labelid:pulse-label",
    )
  })
})

describe("an empty process table", () => {
  it("says that the engine lists no process when nothing is found without a search", () => {
    const container = tableOf(editorSlots().slots, { scope: "withIncident" }, [])

    expect(container.querySelector('[data-part="table-empty"]')?.textContent).toBe(
      "No processes deployed on prod-a, or you may not have permission to see them.",
    )
  })

  it("says that the engine lists no process under a search too, never that the search found none", () => {
    const editor = tableOf(editorSlots().slots, { scope: "all", search: "order" }, [])
    expect(editor.querySelector('[data-part="table-empty"]')?.textContent).toBe(
      "No processes deployed on prod-a, or you may not have permission to see them.",
    )
    cleanup()
    const page = tableOf(pageSlots().slots, { scope: "withIncident", search: "order" }, [])
    expect(page.textContent).toBe(
      "No processes deployed on prod-a, or you may not have permission to see them.",
    )
  })

  it("says that nothing matches where a search or a scope leaves no row", () => {
    const searched = tableOf(pageSlots().slots, { scope: "all", search: "nothing" })
    expect(searched.textContent).toBe("No processes match this filter.")
    cleanup()
    const scoped = tableOf(pageSlots().slots, { scope: "withIncident" }, [BUSY])
    expect(scoped.textContent).toBe("No processes match this filter.")
  })
})

describe("the process table in German", () => {
  const german = (node: ReactNode) => <LocaleProvider locale="de-DE">{node}</LocaleProvider>

  beforeEach(() => {
    setFormatLocale({ language: "de", locale: "de-DE", timeZone: "UTC" })
  })

  it("names its columns, rows, alarm and copy in German, its counts in German digits", () => {
    const { slots, asked } = editorSlots()
    const container = tableOf(slots, { scope: "all" }, PROCESSES, german)
    const order = within(container).getByRole("row", { name: "Prozess Order fulfillment" })
    order.focus()
    fireEvent.keyDown(order, { key: "c", ctrlKey: true })

    expect(within(container).getByRole("table", { name: "Prozesse" })).toBeTruthy()
    expect(texts(container.querySelectorAll("th"))).toEqual([
      "Prozess",
      "Neueste Version",
      "Laufend",
      "Mit Incident",
    ])
    expect(texts(order.querySelectorAll("td")).slice(1)).toEqual([
      "v2",
      "3",
      "1Hat offene Incidents",
    ])
    expect(within(container).getByRole("row", { name: "Prozess shipment" }).textContent).toContain(
      "1.204",
    )
    expect(asked.copied).toEqual([{ text: "pulse-order", label: "BPMN-Prozess-ID" }])
  })

  it("says in German that the engine lists no process, or that nothing matches", () => {
    const none = tableOf(pageSlots().slots, { scope: "all" }, [], german)
    expect(none.textContent).toBe(
      "Auf prod-a ist kein Prozess bereitgestellt, oder du darfst die Prozesse nicht sehen.",
    )
    cleanup()
    const noneSearched = tableOf(pageSlots().slots, { scope: "all", search: "x" }, [], german)
    expect(noneSearched.textContent).toBe(
      "Auf prod-a ist kein Prozess bereitgestellt, oder du darfst die Prozesse nicht sehen.",
    )
    cleanup()
    const searched = tableOf(pageSlots().slots, { scope: "all", search: "x" }, PROCESSES, german)
    expect(searched.textContent).toBe("Kein Prozess passt zu diesem Filter.")
  })
})
