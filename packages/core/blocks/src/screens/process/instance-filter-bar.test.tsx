// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, formatCount, setFormatLocale } from "@miragon/pulse-ui"
import type { InstanceListFilterData, ScopeCountsData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InstanceFilterBar } from "./instance-filter-bar.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const LIST = WORLD_SCREENS.instanceList

interface Shown {
  readonly filter?: InstanceListFilterData
  readonly counts?: ScopeCountsData
  readonly historyNote?: string
  readonly locale?: string
}

function barOf({ filter = { scope: "running" }, counts, historyNote, locale = "en" }: Shown = {}) {
  const asked: InstanceListFilterData[] = []
  const { container } = render(
    <LocaleProvider locale={locale}>
      <InstanceFilterBar
        filter={filter}
        counts={counts ?? LIST.counts ?? { running: 0, withIncident: 0, ended: 0, all: 0 }}
        busy={false}
        historyNote={historyNote}
        elementName={(elementId) =>
          elementId === "Activity_ReviewOrder" ? "Review order" : elementId
        }
        variables={{ refused: LIST.refusedVariableConditions }}
        legend={<button type="button">Legend</button>}
        onFilter={(next) => asked.push(next)}
      />
    </LocaleProvider>,
  )
  return { container, asked }
}

function radios(container: HTMLElement): [string, string | null][] {
  return within(container)
    .getAllByRole("radio")
    .map((radio) => [
      radio.textContent,
      radio.querySelector("[title]")?.getAttribute("title") ?? null,
    ])
}

describe("the filter bar of a process's instance list", () => {
  it("offers the scopes with their counts over the world's instance list", () => {
    const { container, asked } = barOf()

    expect(within(container).getByRole("radiogroup").getAttribute("aria-label")).toBe(
      "Show instances",
    )
    expect(radios(container)).toEqual([
      ["Running 2", "2"],
      ["With incident 1", "1"],
      ["Ended 1", "1"],
      ["All 3", "3"],
    ])
    expect(
      container.querySelector('[data-part="segment-count"][data-tone="danger"]'),
    ).not.toBeNull()
    fireEvent.click(within(container).getByRole("radio", { name: /^Ended/ }))
    expect(asked).toEqual([{ scope: "ended" }])
    expect(within(container).getByRole("button", { name: "Legend" })).toBeTruthy()
  })

  it("marks a count the engine stopped at and notes what the ended counts leave out", () => {
    const { container } = barOf({
      counts: {
        running: 10_000,
        withIncident: 0,
        ended: 0,
        all: 10_000,
        atLeast: ["running", "all"],
      },
      historyNote: "Ended and All update when you refresh.",
    })

    expect(radios(container)).toEqual([
      ["Running 10k+", formatCount({ atLeast: 10_000 })],
      ["With incident 0", "0"],
      ["Ended 0", "0"],
      ["All 10k+", formatCount({ atLeast: 10_000 })],
    ])
    expect(
      within(container)
        .getByRole("radio", { name: /^Ended/ })
        .getAttribute("title"),
    ).toBe("Ended and All update when you refresh.")
    expect(container.querySelector('[data-part="segment-count"][data-tone="danger"]')).toBeNull()
  })

  it("shows the element filtered to as a chip that clears it", () => {
    const { container, asked } = barOf({
      filter: { scope: "withIncident", elementId: "Activity_ReviewOrder", businessKey: "ORD-1" },
    })
    const chip = container.querySelector<HTMLElement>(
      '[data-part="filter-chip"][data-kind="element"]',
    )

    expect(chip?.textContent).toContain("Review order")
    expect(chip?.textContent).toContain("At")
    fireEvent.click(within(chip!).getByRole("button", { name: "Clear element filter" }))
    expect(asked).toEqual([{ scope: "withIncident", businessKey: "ORD-1" }])
  })

  it("searches the exact business key and adds a variable condition", () => {
    vi.useFakeTimers()
    const { container, asked } = barOf()
    const search = within(container).getByRole("searchbox", { name: "Search by business key" })

    expect((search as HTMLInputElement).placeholder).toBe("Business key")
    fireEvent.change(search, { target: { value: " ORD-1002 " } })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(asked).toEqual([{ scope: "running", businessKey: "ORD-1002" }])
    expect(within(container).getByRole("button", { name: "Filter by variables" })).toBeTruthy()
  })

  it("speaks German under a German locale", () => {
    const { container } = barOf({
      filter: { scope: "running", elementId: "Activity_X" },
      locale: "de",
    })

    expect(within(container).getByRole("radiogroup").getAttribute("aria-label")).toBe(
      "Instanzen zeigen",
    )
    expect(radios(container).map(([text]) => text)).toEqual([
      "Laufend 2",
      "Mit Incident 1",
      "Beendet 1",
      "Alle 3",
    ])
    expect(
      within(container).getByRole("searchbox", { name: "Nach Geschäftsschlüssel suchen" }),
    ).toBeTruthy()
    expect(within(container).getByRole("button", { name: "Elementfilter entfernen" })).toBeTruthy()
    expect(container.querySelector('[data-part="filter-chip"]')?.textContent).toContain("An")
  })
})
