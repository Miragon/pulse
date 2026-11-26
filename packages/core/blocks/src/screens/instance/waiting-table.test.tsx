// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { WaitRowData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SURFACES, editorInstanceSlots } from "./instance-slots.test-support.js"
import { WaitingTable, type ElementLinkProps } from "./waiting-table.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const SINCE = "2026-10-21T08:00:00.000Z"
const at = (elementId: string) => ({ elementId, liesIn: null, since: SINCE })

const EVERY_WAIT: readonly WaitRowData[] = [
  { ...at("Task_Assigned"), kind: "userTask", assignee: "mia", dueAt: SINCE },
  { ...at("Task_Free"), kind: "userTask", elementName: "Review order" },
  { ...at("Task_Worker"), kind: "workerTask", taskType: "ship-parcel" },
  { ...at("Task_Typeless"), kind: "workerTask" },
  { ...at("Task_Async"), kind: "asyncContinuation", retriesLeft: 1 },
  { ...at("Task_AsyncUnknown"), kind: "asyncContinuation" },
  { ...at("Timer_Due"), kind: "timer", dueAt: SINCE },
  { ...at("Message_Paid"), kind: "message", messageName: "PaymentReceived" },
  { ...at("Signal_Stop"), kind: "signal", signalName: "Stop" },
  { ...at("Other_Wait"), kind: "other", description: "Waiting for a condition" },
]

const nameOf = (elementId: string) => (elementId === "Task_Assigned" ? "Approve order" : elementId)

function cellsOf(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  )
}

function ShowElement({ elementId, children }: ElementLinkProps) {
  return (
    <button type="button" data-shows={elementId}>
      {children}
    </button>
  )
}

describe.each(SURFACES)("where an instance waits, with %s", (_surface, slotsOf) => {
  it("names each wait's element, kind and what the engine says of it", () => {
    const { container } = render(
      <WaitingTable engine="prod-a" waits={EVERY_WAIT} nameOf={nameOf} slots={slotsOf().slots} />,
    )
    const table = within(container).getByRole("table", { name: "Waiting at" })

    expect([...table.querySelectorAll("th")].map((head) => head.textContent)).toEqual([
      "Waiting at",
      "Kind",
      "Detail",
      "Since",
      "Due",
    ])
    expect(cellsOf(container).map(([element, kind, detail]) => [element, kind, detail])).toEqual([
      ["Approve order", "User task", "Assigned to mia"],
      ["Review order", "User task", "Unassigned"],
      ["Task_Worker", "Worker task", "Task type ship-parcel"],
      ["Task_Typeless", "Worker task", "Task type "],
      ["Task_Async", "Async continuation", "1 retry left"],
      ["Task_AsyncUnknown", "Async continuation", "—"],
      ["Timer_Due", "Timer", "—"],
      ["Message_Paid", "Message", "PaymentReceived"],
      ["Signal_Stop", "Signal", "Stop"],
      ["Other_Wait", "Waiting", "Waiting for a condition"],
    ])
    expect(cellsOf(container)[0]?.[3]).toMatch(/^(\w{3} \d{1,2}, )?08:00 · /)
    expect(cellsOf(container)[1]?.[4]).toBe("—")
  })

  it("links a wait in a called instance to that instance, beside the element's id", () => {
    const { slots, asked } = slotsOf()
    const { container } = render(
      <WaitingTable
        engine="prod-a"
        waits={WORLD_SCREENS.instance.waits}
        nameOf={nameOf}
        slots={slots}
      />,
    )
    const link = within(container).getByTitle("Open called instance fake-label-of-DSP-3001")

    fireEvent.click(link)

    expect(cellsOf(container)[0]?.[0]).toBe(
      "Activity_RenderLabelin pulse-label fake-label-of-DSP-3001",
    )
    expect(asked.opened).toEqual([
      {
        target: { kind: "instance", engine: "prod-a", instanceId: "fake-label-of-DSP-3001" },
        toSide: false,
      },
    ])
  })
})

describe("where an instance waits", () => {
  it("hands its own waits' elements to the surface's link to the diagram, never a called instance's", () => {
    const waits = [EVERY_WAIT[1]!, ...WORLD_SCREENS.instance.waits]
    const { container } = render(
      <WaitingTable
        engine="prod-a"
        waits={waits}
        nameOf={nameOf}
        ElementLink={ShowElement}
        slots={editorInstanceSlots().slots}
      />,
    )

    expect(
      [...container.querySelectorAll<HTMLElement>("[data-shows]")].map((link) => [
        link.dataset.shows,
        link.textContent,
      ]),
    ).toEqual([["Task_Free", "Review order"]])
  })

  it("says it waits nowhere, and words it in German", () => {
    const { container } = render(
      <LocaleProvider locale="de">
        <WaitingTable
          engine="prod-a"
          waits={[]}
          nameOf={nameOf}
          slots={editorInstanceSlots().slots}
        />
      </LocaleProvider>,
    )
    expect(container.textContent).toContain("Diese Instanz wartet nirgends.")
    cleanup()

    const german = render(
      <LocaleProvider locale="de">
        <WaitingTable
          engine="prod-a"
          waits={[
            ...EVERY_WAIT.slice(0, 1),
            EVERY_WAIT[4]!,
            { ...EVERY_WAIT[4]!, elementId: "Task_AsyncAgain", retriesLeft: 3 },
          ]}
          nameOf={nameOf}
          slots={editorInstanceSlots().slots}
        />
      </LocaleProvider>,
    )
    expect(cellsOf(german.container).map(([, kind, detail]) => [kind, detail])).toEqual([
      ["Benutzeraufgabe", "Zugewiesen an mia"],
      ["Asynchroner Job", "1 Versuch übrig"],
      ["Asynchroner Job", "3 Versuche übrig"],
    ])
  })
})
