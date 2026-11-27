// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react"
import { LocaleProvider, NamedId, setFormatLocale } from "@miragon/pulse-ui"
import { FleetSums, type EngineScreenData, type ProcessRowData } from "@miragon/pulse-screens"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SURFACES } from "../instance/instance-slots.test-support.js"
import type { ScreenIdProps } from "../slots.js"
import { ProcessesByEngine } from "./processes-by-engine.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

function row(running: number, tenantId?: string): ProcessRowData {
  return {
    bpmnProcessId: "label",
    ...(tenantId === undefined ? {} : { tenantId }),
    latestVersion: 1,
    running,
    withIncident: 0,
    incidents: 0,
  }
}

function screenOf(engine: string, processes: readonly ProcessRowData[]): EngineScreenData {
  return {
    engine,
    asOf: "2026-11-27T09:00:00.000Z",
    info: null,
    processes,
    totals: { processes: processes.length, running: 0, withIncident: 0 },
  }
}

function Id({ id, name }: ScreenIdProps) {
  return <NamedId name={name} id={id} layout="inline" />
}

describe.each(SURFACES)("what runs where with tenants, in %s", (_surface, slotsOf) => {
  it("shows a key in each tenant as a row of its own, a column naming its tenant", () => {
    const sums = FleetSums.of([
      screenOf("a", [row(1), row(5, "north")]),
      screenOf("b", [row(2, "north")]),
    ])
    const { PlainTable } = slotsOf().slots
    const { container } = render(
      <LocaleProvider locale="de-DE">
        <ProcessesByEngine
          processes={sums.processes}
          engines={["a", "b"]}
          slots={{ PlainTable, Id }}
        />
      </LocaleProvider>,
    )

    expect([...container.querySelectorAll("thead th")].map((head) => head.textContent)).toContain(
      "Mandant",
    )
    expect(
      [...container.querySelectorAll("tbody tr")].map(
        (tr) => tr.querySelectorAll("td")[1]?.textContent,
      ),
    ).toEqual(["north", ""])
  })
})
