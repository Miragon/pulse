// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { formatDuration } from "@miragon/pulse-ui"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import { HistoryTable, type HistoryEntry } from "./history-steps.js"

afterEach(cleanup)

/** Camunda 7's start and end event types (`ActivityTypes`), a throw and two boundary events. */
const INSTANTS = [
  "startEvent",
  "startTimerEvent",
  "messageStartEvent",
  "signalStartEvent",
  "conditionalStartEvent",
  "errorStartEvent",
  "escalationStartEvent",
  "compensationStartEvent",
  "noneEndEvent",
  "errorEndEvent",
  "cancelEndEvent",
  "terminateEndEvent",
  "messageEndEvent",
  "signalEndEvent",
  "compensationEndEvent",
  "escalationEndEvent",
  "intermediateSignalThrow",
  "boundaryTimer",
  "cancelBoundaryCatch",
]

const step = (activityType: string, durationInMillis: number): HistoryEntry => ({
  id: activityType,
  activityId: activityType,
  // Named by its type, so each row says which it is.
  activityName: activityType,
  activityType,
  startTime: "2026-01-01T10:00:00.000Z",
  endTime: "2026-01-01T10:00:00.000Z",
  durationInMillis,
})

// D8: no "0 ms" on an event, whichever start or end Camunda 7 records (a timer start is
// `startTimerEvent`, which no suffix rule catches); a catching event keeps how long it waited.
describe("HistoryTable's durations", () => {
  it("leaves every start and end event's duration empty, a catching event's stays", () => {
    render(
      <TestViewHost>
        <HistoryTable
          entries={[...INSTANTS.map((type) => step(type, 0)), step("intermediateTimer", 7_200_000)]}
          incidentIds={new Set()}
        />
      </TestViewHost>,
    )
    const table = screen.getByRole("region", { name: "Activity history of this process instance" })
    const rows = [...table.querySelectorAll("tbody tr")].map((row) => {
      const cells = [...row.querySelectorAll("td")].map((cell) => cell.textContent ?? "")
      return [cells[0], cells[3]]
    })
    expect(rows).toEqual([
      ...INSTANTS.map((type) => [type, ""]),
      ["intermediateTimer", formatDuration(7_200_000)],
    ])
  })
})
