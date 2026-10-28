// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { FitMeasure } from "./inline-fit.js"
import { Host, ROWS, Table, layout, shownRows } from "./inline-fit.test-support.js"

afterEach(() => cleanup())

describe("the fit over time", () => {
  /** A layout whose chrome can grow later, and whose hidden lists show no rows. */
  function mutableLayout(start: { chrome: number; row: number; footer?: number }) {
    const state = { ...start, footer: start.footer ?? 40 }
    const measure: FitMeasure = {
      rows: (element) =>
        element.closest("[data-test-hidden]")
          ? []
          : Array.from(element.children).map((_, i) => state.chrome + (i + 1) * state.row),
      content: (box) =>
        state.chrome +
        box.querySelectorAll("[data-inline-fit-rows] > *").length * state.row +
        box.querySelectorAll("tfoot").length * state.footer,
    }
    return { state, measure }
  }

  const observers: Array<() => void> = []
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    observers.length = 0
  })
  const resized = () => act(() => observers.forEach((callback) => callback()))

  const rowsOf = (prefix: string) => shownRows().filter((text) => text.startsWith(prefix))

  it("absorbs the 'k of N' line its own cap adds (a second pass)", () => {
    // 8 rows are 780 px; 5 fit before the line appears, 4 with it.
    render(
      <Host measure={layout({ chrome: 300, row: 60 })}>
        <Table rows={ROWS.slice(0, 8)} />
      </Host>,
    )
    expect(shownRows()).toHaveLength(4)
    expect(screen.getByText("4 of 8 shown")).toBeTruthy()
  })

  it("refits what grows late until the user touches the view, then leaves the rows alone", () => {
    const { state, measure } = mutableLayout({ chrome: 300, row: 60 })
    render(
      <Host measure={measure}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toHaveLength(4)
    state.chrome = 360
    resized()
    expect(shownRows()).toHaveLength(3)

    fireEvent.pointerDown(window)
    state.chrome = 420
    resized()
    // Rows never vanish under the pointer: the view scrolls inside its budget instead.
    expect(shownRows()).toHaveLength(3)
  })

  it("fits a list the first time it shows, also after the user touched the view", () => {
    const { measure } = mutableLayout({ chrome: 300, row: 60 })
    function Tabbed() {
      const [shown, setShown] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setShown(true)}>
            show
          </button>
          <div data-test-hidden={shown ? undefined : ""}>
            <Table />
          </div>
        </>
      )
    }
    render(
      <Host measure={measure}>
        <Tabbed />
      </Host>,
    )
    // Hidden: nothing to measure, nothing cut.
    expect(shownRows()).toHaveLength(10)
    fireEvent.pointerDown(window)
    fireEvent.click(screen.getByRole("button", { name: "show" }))
    resized()
    expect(shownRows()).toHaveLength(4)
  })

  it("a new budget refits a list whose rows the user revealed in place", () => {
    // 340 px chrome, 60 px rows: 3 of 6 fit 600 px.
    const measure = layout({ chrome: 340, row: 60 })
    const { rerender } = render(
      <Host measure={measure}>
        <Table rows={ROWS.slice(0, 6)} />
      </Host>,
    )
    expect(shownRows()).toHaveLength(3)
    fireEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(shownRows()).toHaveLength(6)
    rerender(
      <Host budget={500} measure={measure}>
        <Table rows={ROWS.slice(0, 6)} />
      </Host>,
    )
    expect(shownRows()).toHaveLength(2)
  })

  it("keeps the rows the user revealed while another list of the view changes", () => {
    const measure = layout({ chrome: 100, row: 50 })
    const a = Array.from({ length: 12 }, (_, i) => `row a${i + 1}`)
    function TwoTables({ b }: { b: number }) {
      return (
        <>
          <Table rows={a} />
          <Table rows={Array.from({ length: b }, (_, i) => `row b${i + 1}`)} />
        </>
      )
    }
    const { rerender } = render(
      <Host measure={measure}>
        <TwoTables b={2} />
      </Host>,
    )
    expect(rowsOf("row a")).toHaveLength(7)
    fireEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(rowsOf("row a")).toHaveLength(12)
    rerender(
      <Host measure={measure}>
        <TwoTables b={6} />
      </Host>,
    )
    expect(rowsOf("row a")).toHaveLength(12)
    expect(rowsOf("row b")).toHaveLength(3)
  })

  it("reveals at least 3 rows per click where only 1 fits", () => {
    // 470 px chrome, 87 px rows: 1 row fits.
    render(
      <Host measure={layout({ chrome: 470, row: 87 })}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(shownRows()).toHaveLength(4)
  })
})
