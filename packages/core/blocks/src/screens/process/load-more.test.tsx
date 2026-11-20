// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { InstanceRowData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ScreenSlots } from "../slots.js"
import { editorSlots, pageSlots } from "../slots.test-support.js"
import { InstanceTable } from "./instance-table.js"
import { LoadMore, useFocusAfterMore } from "./load-more.js"

/**
 * Load more under the instance table in both tables (the editors' and a page's): it waits and keeps
 * the focus while the page loads, and once the page shows the focus goes on to its first new row,
 * never where the reader went meanwhile.
 */

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const ROWS: readonly InstanceRowData[] = [
  ...WORLD_SCREENS.instanceList.rows,
  { id: "3e9d1c2b-7a6f-4e5d-9c8b-1a2b3c4d5e6f", state: "terminated", hasIncident: false },
]

describe("Load more under the instance table", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** The table with `rows`, Load more under it while `more` (busy or not), its asks counted. */
  function paged(slots: ScreenSlots) {
    const asks: string[] = []
    const table = (rows: readonly InstanceRowData[], more?: { busy: boolean }) => (
      <LocaleProvider locale="en">
        <input aria-label="Elsewhere" />
        <InstanceTable
          engine="conformance"
          rows={rows}
          filter={{ scope: "all" }}
          onFilter={() => undefined}
          more={more && { busy: more.busy, onMore: () => asks.push("more") }}
          slots={slots}
        />
      </LocaleProvider>
    )
    return { asks, table }
  }

  const rowsOf = (container: HTMLElement) => [
    ...container.querySelectorAll<HTMLElement>("tbody > tr"),
  ]

  it.each([
    ["the editors' table", editorSlots],
    ["a page's table", pageSlots],
  ])(
    "in %s keeps the focus while the page loads, then moves it to the first new row",
    (_name, slotsOf) => {
      vi.useFakeTimers()
      const { asks, table } = paged(slotsOf().slots)
      const view = render(table(ROWS.slice(0, 2), { busy: false }))
      const more = within(view.container).getByRole("button", { name: "Load more" })
      more.focus()
      fireEvent.click(more)
      view.rerender(table(ROWS.slice(0, 2), { busy: true }))
      // Waiting, it keeps the focus and asks nothing more.
      fireEvent.click(more)
      expect(asks).toEqual(["more"])
      expect(document.activeElement).toBe(more)
      // The last page: the button goes, the focus goes on to the first new row.
      view.rerender(table(ROWS))
      act(() => {
        vi.runAllTimers()
      })
      expect(document.activeElement).toBe(rowsOf(view.container)[2])
    },
  )

  it("leaves the focus where the reader went meanwhile, and where it is when the rows start over", () => {
    vi.useFakeTimers()
    const { slots } = editorSlots()
    const { table } = paged(slots)
    const view = render(table(ROWS.slice(0, 2), { busy: false }))
    const more = within(view.container).getByRole("button", { name: "Load more" })
    fireEvent.click(more)
    const elsewhere = within(view.container).getByRole("textbox", { name: "Elsewhere" })
    elsewhere.focus()
    view.rerender(table(ROWS, { busy: false }))
    act(() => {
      vi.runAllTimers()
    })
    expect(document.activeElement).toBe(elsewhere)

    more.focus()
    fireEvent.click(more)
    view.rerender(table(ROWS.slice(0, 1), { busy: false }))
    act(() => {
      vi.runAllTimers()
    })
    expect(document.activeElement).toBe(more)

    // A page asked for and left before it shows: the focus moves nowhere.
    fireEvent.click(more)
    view.rerender(table(ROWS.slice(0, 3), { busy: false }))
    elsewhere.focus()
    act(() => {
      vi.runAllTimers()
    })
    expect(document.activeElement).toBe(elsewhere)
  })

  it("records nothing and focuses nothing without its button, and finds no rows without a table", () => {
    vi.useFakeTimers()
    const lone = renderHook(({ shown }) => useFocusAfterMore(shown), {
      initialProps: { shown: 0 },
    })
    lone.result.current.ask()
    lone.result.current.again()
    lone.rerender({ shown: 1 })
    act(() => {
      vi.runAllTimers()
    })
    expect(document.activeElement).toBe(document.body)

    const asks: string[] = []
    function Alone({ shown }: { readonly shown: number }) {
      const focus = useFocusAfterMore(shown)
      return (
        <LoadMore
          ref={focus.button}
          busy={false}
          onMore={() => {
            focus.ask()
            asks.push("more")
          }}
        />
      )
    }
    const view = render(
      <LocaleProvider locale="en">
        <Alone shown={0} />
      </LocaleProvider>,
    )
    const more = within(view.container).getByRole("button", { name: "Load more" })
    more.focus()
    fireEvent.click(more)
    view.rerender(
      <LocaleProvider locale="en">
        <Alone shown={1} />
      </LocaleProvider>,
    )
    act(() => {
      vi.runAllTimers()
    })
    expect(asks).toEqual(["more"])
    expect(document.activeElement).toBe(more)
  })
})
