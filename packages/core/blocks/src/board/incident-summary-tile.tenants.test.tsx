// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react"
import { setFormatLocale } from "@miragon/pulse-ui"
import type { IncidentSummaryData } from "@miragon/pulse-board"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IncidentSummaryTile } from "./incident-summary-tile.js"
import { testSlots } from "./slots.test-support.js"

/**
 * A board's incident summary per process over an engine with tenants (owner decision 2026-11-26,
 * F17): a key deployed in two tenants is a row each, named with its tenant, kept apart among the
 * rows and opening its own tenant's process.
 */

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const LABEL = { id: "label:1", bpmnProcessId: "label", version: 1 } as const

const IN_TWO_TENANTS: IncidentSummaryData = {
  kind: "incidentSummary",
  widget: { widget: "incidentSummary", engines: ["shop"], groupBy: "process" },
  engines: 1,
  known: 1,
  total: 6,
  rows: [
    {
      engine: "shop",
      process: { ...LABEL, id: "label:north", tenantId: "north" },
      withIncident: 2,
    },
    {
      engine: "shop",
      process: { ...LABEL, id: "label:south", tenantId: "south" },
      withIncident: 3,
    },
    { engine: "shop", process: LABEL, withIncident: 1 },
  ],
}

describe("an incident summary per process over a key in two tenants", () => {
  it("shows a row per tenant, named with its tenant, each opening its own tenant's process", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const { slots, asked } = testSlots()
    render(<IncidentSummaryTile tile={IN_TWO_TENANTS} slots={slots} />)

    const rows = within(screen.getByRole("list")).getAllByRole("button")
    expect(rows.map((row) => row.textContent)).toEqual([
      "label · Tenant northshop2with incident",
      "label · Tenant southshop3with incident",
      "labelshop1with incident",
    ])
    for (const row of rows) row.click()
    expect(asked.opened.map(({ target }) => target)).toEqual([
      {
        kind: "instances",
        engine: "shop",
        bpmnProcessId: "label",
        tenantId: "north",
        filter: { scope: "withIncident" },
      },
      {
        kind: "instances",
        engine: "shop",
        bpmnProcessId: "label",
        tenantId: "south",
        filter: { scope: "withIncident" },
      },
      {
        kind: "instances",
        engine: "shop",
        bpmnProcessId: "label",
        filter: { scope: "withIncident" },
      },
    ])
    expect(errors.mock.calls.flat().join(" ")).not.toContain("same key")
    errors.mockRestore()
  })
})
