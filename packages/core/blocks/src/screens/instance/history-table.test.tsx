// @vitest-environment happy-dom
import { cleanup, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { PathRowData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { HistoryTable } from "./history-table.js"
import { SURFACES } from "./instance-slots.test-support.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const NAMES: Readonly<Record<string, string>> = {
  Event_DispatchRequested: "Dispatch requested",
  Activity_PrintShippingLabel: "Print shipping label",
}
const nameOf = (elementId: string) => NAMES[elementId] ?? elementId

const CANCELLED: PathRowData = {
  elementId: "Activity_Old",
  elementName: "Old step",
  startedAt: "2026-10-21T07:00:00.000Z",
  endedAt: "2026-10-21T07:01:02.000Z",
  state: "canceled",
  durationMs: 62_000,
}

describe.each(SURFACES)("an instance's history with %s", (_surface, slotsOf) => {
  function tableOf(path: readonly PathRowData[], locale = "en") {
    const { container } = render(
      <LocaleProvider locale={locale}>
        <HistoryTable path={path} nameOf={nameOf} slots={slotsOf().slots} />
      </LocaleProvider>,
    )
    return container
  }

  it("lists each element the instance ran through, its state, its times and how long it took", () => {
    const container = tableOf([CANCELLED, ...WORLD_SCREENS.instance.path])
    const table = within(container).getByRole("table", { name: "History" })
    const rows = [...table.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    )

    expect([...table.querySelectorAll("th")].map((head) => head.textContent)).toEqual([
      "Element",
      "State",
      "Started",
      "Ended",
      "Duration",
    ])
    expect(rows.map(([element, state, , , duration]) => [element, state, duration])).toEqual([
      ["Old step", "Cancelled", "1m 2s"],
      ["Dispatch requested", "Completed", "1s"],
      ["Print shipping label", "Running", "—"],
    ])
    expect(rows[1]?.[2]).toMatch(/^(\w{3} \d{1,2}, )?08:00:00\.000 · /)
    expect(rows[2]?.[3]).toBe("—")
  })

  it("says that the engine has no history where the path is empty, in English and German", () => {
    expect(tableOf([]).textContent).toContain("The engine has no history for this instance.")
    cleanup()
    expect(tableOf([], "de").textContent).toContain(
      "Die Engine hat keinen Verlauf für diese Instanz.",
    )
  })
})

describe("an instance's history in German", () => {
  it("names its columns and states in the kit's German words", () => {
    const { container } = render(
      <LocaleProvider locale="de">
        <HistoryTable path={[CANCELLED]} nameOf={nameOf} slots={SURFACES[1][1]().slots} />
      </LocaleProvider>,
    )
    const table = within(container).getByRole("table", { name: "Verlauf" })

    expect([...table.querySelectorAll("th")].map((head) => head.textContent)).toEqual([
      "Element",
      "Zustand",
      "Gestartet",
      "Beendet",
      "Dauer",
    ])
    expect(table.querySelector("tbody td:nth-child(2)")?.textContent).toBe("Abgebrochen")
  })
})
