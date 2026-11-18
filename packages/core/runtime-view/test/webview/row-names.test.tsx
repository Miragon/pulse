import { afterEach, describe, expect, it } from "vitest"
import type { BoardView } from "../../src/core/protocol/index.js"
import { BOARD_VIEW } from "../../dev/webview/fixtures/board.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { findRole, mountApp, press, type Harness } from "./harness.js"

const SHIPMENT = { id: "shipment:2", bpmnProcessId: "shipment", version: 2 } as const

const INCIDENT_BOARD = {
  ...BOARD_VIEW,
  rows: [
    [
      {
        kind: "incidentList",
        widget: { widget: "incidentList", title: "Shipment incidents", engines: ["local"] },
        groups: [
          {
            engine: "local",
            incidents: [
              {
                id: "i-1",
                instanceId: "5c0ffee0-3c1d-11ef-9a3e-0242ac120002",
                definition: SHIPMENT,
                elementId: "Task_Ship",
                type: "failedJob",
                message: "Carrier API answered 503",
                createdAt: "2026-10-26T08:00:00.000Z",
              },
            ],
          },
        ],
      },
    ],
  ],
} satisfies BoardView

const OPENS_AND_COPIES_ITS_ID = "Enter opens the row, Ctrl or Cmd+C copies its ID."

function hintOf(row: HTMLElement): string | undefined {
  const words = document.getElementById(row.getAttribute("aria-describedby") ?? "")
  return words?.textContent
}

describe("a row tells a screen reader what it opens and what its keys do", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("names a process row of the engine overview by its process", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.engine)
    const row = await findRole(harness.root, "row", { name: "Process Order fulfillment" })

    expect(hintOf(row)).toBe(OPENS_AND_COPIES_ITS_ID)
  })

  it("names an instance row of a process by its business key", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const row = await findRole(harness.root, "row", { name: "Instance ORD-10442" })

    expect(hintOf(row)).toBe(OPENS_AND_COPIES_ITS_ID)
  })

  it("names a board's instance row by the instance it opens", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.board)
    const row = await findRole(harness.root, "row", { name: "Instance 9b1c4d22…" })

    expect(hintOf(row)).toBe(OPENS_AND_COPIES_ITS_ID)
  })

  it("says that a board's incident row copies its message, and copies it", async () => {
    harness = mountApp()
    harness.publish({ status: "ready", view: INCIDENT_BOARD, refreshing: false })
    const row = await findRole(harness.root, "row", { name: "Instance 5c0ffee0…" })

    row.focus()
    press(row, "c", { ctrlKey: true })

    expect(hintOf(row)).toBe("Enter opens the row, Ctrl or Cmd+C copies its incident message.")
    expect(harness.posted).toEqual([
      { type: "copy", text: "Carrier API answered 503", label: "Incident message" },
    ])
  })
})
