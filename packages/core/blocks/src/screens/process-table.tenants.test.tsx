// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import { ProcessFilter, type ProcessRowData } from "@miragon/pulse-screens"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ProcessTable } from "./process-table.js"
import { pageSlots } from "./slots.test-support.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

function row(tenantId?: string, latestVersion = 1): ProcessRowData {
  return {
    bpmnProcessId: "pulse-label",
    ...(tenantId === undefined ? {} : { tenantId }),
    name: "Print label",
    latestVersion,
    running: 0,
    withIncident: 0,
    incidents: 0,
  }
}

function tableOf(processes: readonly ProcessRowData[], language: "en" | "de" = "en") {
  const { slots, asked } = pageSlots()
  const filter = { scope: "all" } as const
  const { container } = render(
    <LocaleProvider locale={language === "de" ? "de-DE" : "en-US"}>
      <ProcessTable
        engine="prod-a"
        listed={ProcessFilter.apply(processes, filter)}
        filter={filter}
        totals={{ processes: processes.length, running: 0, withIncident: 0 }}
        slots={slots}
      />
    </LocaleProvider>,
  )
  return { container, asked }
}

const heads = (container: HTMLElement) =>
  [...container.querySelectorAll("th")].map((head) => head.textContent)

describe("the process table of an engine with tenants", () => {
  it("lists a key once per tenant, a column naming each row's tenant, and opens a row in it", () => {
    const { container, asked } = tableOf([row(), row("north"), row("south", 2)])
    const north = within(container).getByRole("row", {
      name: "Process Print label of tenant north",
    })

    fireEvent.click(north)

    expect(heads(container)).toContain("Tenant")
    expect(
      [...container.querySelectorAll("tbody tr")].map(
        (tr) => tr.querySelectorAll("td")[1]?.textContent,
      ),
    ).toEqual(["", "north", "south"])
    expect(asked.opened.map(({ target }) => target)).toEqual([
      { kind: "process", engine: "prod-a", bpmnProcessId: "pulse-label", tenantId: "north" },
    ])
  })

  it("names a row without a process name by its key and its tenant", () => {
    const { bpmnProcessId, latestVersion, running, withIncident, incidents } = row()
    const bare = {
      bpmnProcessId,
      tenantId: "south",
      latestVersion,
      running,
      withIncident,
      incidents,
    }
    const { container } = tableOf([bare])

    expect(
      within(container).getByRole("row", { name: "Process pulse-label of tenant south" }),
    ).toBeTruthy()
  })

  it("names the tenant in German as the Mandant", () => {
    const { container } = tableOf([row("north")], "de")

    expect(heads(container)).toContain("Mandant")
    expect(
      within(container).getByRole("row", { name: "Prozess Print label des Mandanten north" }),
    ).toBeTruthy()
  })

  it("shows no tenant column where no process has a tenant", () => {
    const { container } = tableOf([row()])

    expect(heads(container)).not.toContain("Tenant")
  })
})
