// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { EngineTotalsData, ProcessFilterData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { useState, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ListFilterBar } from "./list-filter-bar.js"
import { useProcessList } from "./process-list.js"
import { ProcessTable } from "./process-table.js"
import { editorSlots, pageSlots } from "./slots.test-support.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const TOTALS: EngineTotalsData = { processes: 4, running: 1_274, withIncident: 17 }

function barOf(
  props: {
    readonly filter?: ProcessFilterData
    readonly counts?: { readonly all: number; readonly withIncident: number }
    readonly totals?: EngineTotalsData
    readonly busy?: boolean
  } = {},
  wrap: (node: ReactNode) => ReactNode = (node) => node,
) {
  const asked: ProcessFilterData[] = []
  const { container } = render(
    wrap(
      <ListFilterBar
        filter={props.filter ?? { scope: "all" }}
        counts={props.counts ?? { all: 4, withIncident: 3 }}
        totals={props.totals ?? TOTALS}
        {...(props.busy === undefined ? {} : { busy: props.busy })}
        onFilter={(filter) => asked.push(filter)}
      />,
    ),
  )
  return { container, asked }
}

function texts(nodes: Iterable<Element>): string[] {
  return [...nodes].map((node) => node.textContent)
}

function search(container: HTMLElement, text: string): void {
  const field = within(container).getByRole("searchbox")
  fireEvent.change(field, { target: { value: text } })
  fireEvent.keyDown(field, { key: "Enter" })
}

describe("the filter bar of a process list", () => {
  it("offers both scopes with their counts and sums the engine up at its end", () => {
    const { container } = barOf()
    const group = within(container).getByRole("radiogroup", { name: "Show processes" })

    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["All 4", "With incident 3"])
    expect(container.querySelector('[data-part="filter-bar"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="toolbar-summary"]')?.textContent).toBe(
      "4 processes · 1,274 running · 17 with incident · all versions",
    )
    const field = within(container).getByRole<HTMLInputElement>("searchbox", {
      name: "Search by name or BPMN process ID",
    })
    expect(field.placeholder).toBe("Name or key")
  })

  it("marks the count with incident by its icon above 0 only, compact with its exact title", () => {
    const alarming = barOf({ counts: { all: 12_345, withIncident: 2 } }).container
    const counts = [...alarming.querySelectorAll('[data-part="segment-count"]')]

    expect(counts.map((count) => [count.textContent, count.getAttribute("title")])).toEqual([
      ["12.3k", "12,345"],
      ["2", "2"],
    ])
    expect(counts.map((count) => count.getAttribute("data-tone"))).toEqual([null, "danger"])
    expect(counts.map((count) => count.querySelector("svg") !== null)).toEqual([false, true])
    cleanup()
    const calm = barOf({ counts: { all: 1, withIncident: 0 } }).container
    expect(calm.querySelector('[data-part="segment-count"][data-tone]')).toBeNull()
  })

  it("names one process in the singular", () => {
    const { container } = barOf({ totals: { processes: 1, running: 0, withIncident: 0 } })

    expect(container.querySelector('[data-slot="toolbar-summary"]')?.textContent).toBe(
      "1 process · 0 running · 0 with incident · all versions",
    )
  })

  it("asks for a scope with the search it keeps, and for a search in the scope it shows", () => {
    const { container, asked } = barOf({ filter: { scope: "all", search: "order" } })

    within(container).getByRole("radio", { name: "With incident 3" }).click()
    search(container, "  label ")

    expect(asked).toEqual([
      { scope: "withIncident", search: "order" },
      { scope: "all", search: "label" },
    ])
  })

  it("drops an emptied search and keeps the scope", () => {
    const { container, asked } = barOf({ filter: { scope: "withIncident", search: "order" } })

    search(container, "")

    expect(asked).toEqual([{ scope: "withIncident" }])
  })

  it("applies a search once the typing pauses", () => {
    vi.useFakeTimers()
    try {
      const { container, asked } = barOf()
      fireEvent.change(within(container).getByRole("searchbox"), { target: { value: "dis" } })

      expect(asked).toEqual([])
      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(asked).toEqual([{ scope: "all", search: "dis" }])
    } finally {
      vi.useRealTimers()
    }
  })

  it("explains its counts behind a legend beside its search: the versions, and a waiting caller apart from its incident", () => {
    const { container } = barOf()
    const button = within(container).getByRole("button", { name: "What the counts say" })
    const legend = container.querySelector<HTMLElement>("[popover]")

    expect(container.querySelector('[data-slot="toolbar-end"]')?.contains(button)).toBe(false)
    expect(within(container).getByRole("searchbox").compareDocumentPosition(button)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(button.getAttribute("popovertarget")).toBe(legend?.id)
    expect(texts(legend?.querySelectorAll("p") ?? [])).toEqual([
      "Each count covers every version of a process.",
      "Running: the instances that run now.",
      "With incident: the instances with an open incident, a caller waiting for an incident in an instance it called included.",
      "Incidents: the open incidents, each counted once, at the process it was raised in, never at a caller that waits for it. An incident outside any instance, such as a failed timer start, counts here though no instance holds it.",
    ])
  })

  it("says while the surface reads again", () => {
    const { container } = barOf({ busy: true })

    expect(within(container).getByRole("radiogroup").getAttribute("aria-busy")).toBe("true")
  })

  it("words itself in German", () => {
    setFormatLocale({ language: "de", locale: "de-DE", timeZone: "UTC" })
    const { container } = barOf({}, (node) => (
      <LocaleProvider locale="de-DE">{node}</LocaleProvider>
    ))

    expect(
      within(container)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Alle 4", "Mit Incident 3"])
    expect(within(container).getByRole("radiogroup").getAttribute("aria-label")).toBe(
      "Prozesse zeigen",
    )
    const field = within(container).getByRole<HTMLInputElement>("searchbox", {
      name: "Nach Name oder BPMN-Prozess-ID suchen",
    })
    expect(field.placeholder).toBe("Name oder BPMN-ID")
    expect(container.querySelector('[data-slot="toolbar-summary"]')?.textContent).toBe(
      "4 Prozesse · 1.274 laufend · 17 mit Incident · alle Versionen",
    )
    expect(within(container).getByRole("button", { name: "Was die Zahlen sagen" })).toBeTruthy()
    expect(texts(container.querySelectorAll("[popover] p"))).toEqual([
      "Jede Zahl zählt über alle Versionen eines Prozesses.",
      "Laufend: die Instanzen, die gerade laufen.",
      "Mit Incident: die Instanzen mit einem offenen Incident, auch ein Aufrufer, der auf einen Incident in einer aufgerufenen Instanz wartet.",
      "Incidents: die offenen Incidents, jeder einmal gezählt, bei dem Prozess, in dem er auftrat, nie bei einem Aufrufer, der auf ihn wartet. Ein Incident außerhalb jeder Instanz, etwa ein gescheiterter Timer-Start, zählt hier, auch wenn ihn keine Instanz hält.",
    ])
  })
})

/** A page's process list: the filter its own state, the rows derived in the browser. */
function PageList({ slots }: { readonly slots: ReturnType<typeof pageSlots>["slots"] }) {
  const screen = WORLD_SCREENS.engine
  const [filter, setFilter] = useState<ProcessFilterData>({ scope: "all" })
  const listed = useProcessList(screen.processes, filter)
  return (
    <>
      <ListFilterBar
        filter={filter}
        counts={listed.counts}
        totals={screen.totals}
        onFilter={setFilter}
      />
      <ProcessTable
        engine={screen.engine}
        listed={listed}
        filter={filter}
        totals={screen.totals}
        slots={slots}
      />
    </>
  )
}

describe("a process list derived in the browser", () => {
  it("lists the rows a scope and a search leave from the loaded screen, and opens nothing on its own", () => {
    const { slots, asked } = pageSlots()
    const { container } = render(<PageList slots={slots} />)
    const rows = () =>
      [...container.querySelectorAll("tbody tr")].map((row) => row.getAttribute("aria-label"))

    expect(rows()).toEqual([
      "Process Order fulfillment",
      "Process Dispatch order",
      "Process Print label",
    ])
    search(container, "LABEL")
    expect(rows()).toEqual(["Process Print label"])
    expect(
      within(container)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["All 1", "With incident 1"])
    search(container, "nothing")
    expect(container.textContent).toContain("No processes match this filter.")
    search(container, "")
    within(container).getByRole("radio", { name: "With incident 3" }).click()
    expect(rows()).toHaveLength(3)
    expect(asked).toEqual({ opened: [], copied: [] })
  })

  it("keeps the same rows for the editors' table", () => {
    const { slots } = editorSlots()
    const { container } = render(<PageList slots={slots} />)

    expect(
      [...container.querySelectorAll("tbody tr")].map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Process Order fulfillment", "Process Dispatch order", "Process Print label"])
  })
})
