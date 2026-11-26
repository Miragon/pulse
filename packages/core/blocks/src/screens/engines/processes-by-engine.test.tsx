// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react"
import { LocaleProvider, NamedId, setFormatLocale } from "@miragon/pulse-ui"
import { FleetSums, type EngineScreenData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SURFACES } from "../instance/instance-slots.test-support.js"
import type { ScreenIdProps } from "../slots.js"
import { ProcessesByEngine } from "./processes-by-engine.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const SECOND: EngineScreenData = {
  ...WORLD_SCREENS.engine,
  engine: "prod-b",
  processes: [
    {
      bpmnProcessId: "pulse-order",
      latestVersion: 4,
      running: 1_200,
      withIncident: 7,
      incidents: 3,
    },
    {
      bpmnProcessId: "audit",
      latestVersion: 1,
      running: 4,
      withIncident: 0,
      incidents: 0,
    },
  ],
}

const SUMS = FleetSums.of([WORLD_SCREENS.engine, SECOND])
const ENGINES = ["conformance", "prod-b"]

function Id({ id, name }: ScreenIdProps) {
  return <NamedId name={name} id={id} layout="inline" />
}

function cells(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  )
}

describe.each(SURFACES)("what runs where, in %s", (_surface, slotsOf) => {
  function shown(locale = "en", unread?: readonly string[]) {
    const { PlainTable } = slotsOf().slots
    return render(
      <LocaleProvider locale={locale}>
        <ProcessesByEngine
          processes={SUMS.processes}
          engines={ENGINES}
          slots={{ PlainTable, Id }}
          {...(unread === undefined ? {} : { unread })}
        />
      </LocaleProvider>,
    ).container
  }

  it("counts each process's running instances per engine and its instances with incident over all, an empty cell where it is not deployed", () => {
    const container = shown()

    expect([...container.querySelectorAll("thead th")].map((head) => head.textContent)).toEqual([
      "Process",
      "conformance",
      "prod-b",
      "With incident",
    ])
    const rows = cells(container)
    expect(rows.map((row) => row.slice(1))).toEqual([
      ["3", "1,200", "8Has open incidents"],
      ["1", "not deployed on prod-b", "1Has open incidents"],
      ["1", "not deployed on prod-b", "1Has open incidents"],
      ["not deployed on conformance", "4", "0"],
    ])
    expect(rows.map((row) => row[0])).toEqual([
      expect.stringContaining("pulse-order"),
      expect.stringContaining("pulse-dispatch"),
      expect.stringContaining("pulse-label"),
      expect.stringContaining("audit"),
    ])
    expect(container.querySelectorAll('[data-part="incident-count"][data-tone]')).toHaveLength(3)
  })

  it("says above the table that it shows counts, never rates, and names the engines it could not read", () => {
    const container = shown("en", ["down", "locked"])

    expect(container.querySelector('[data-part="counts-note"]')?.textContent).toBe(
      "Engines run different processes, so this view shows counts, never rates.",
    )
    expect(container.querySelector('[data-part="unread"]')?.textContent).toBe(
      "Not read, so not in this view: down, locked",
    )
    expect(shown().querySelector('[data-part="unread"]')).toBeNull()
  })

  it("speaks German on a German host", () => {
    const container = shown("de", ["down"])

    expect([...container.querySelectorAll("thead th")].map((head) => head.textContent)).toEqual([
      "Prozess",
      "conformance",
      "prod-b",
      "Mit Incident",
    ])
    expect(container.querySelector('[data-part="counts-note"]')?.textContent).toBe(
      "Engines führen verschiedene Prozesse, darum zeigt diese Ansicht Zahlen, nie Raten.",
    )
    expect(cells(container)[3]?.[1]).toBe("auf conformance nicht bereitgestellt")
    expect(container.querySelector('[data-part="unread"]')?.textContent).toBe(
      "Nicht gelesen, darum nicht in dieser Ansicht: down",
    )
  })
})

describe("what runs where, with no process on the engines read", () => {
  it("says no process is deployed there", () => {
    const { PlainTable } = SURFACES[0][1]().slots
    const container = render(
      <LocaleProvider locale="en">
        <ProcessesByEngine processes={[]} engines={ENGINES} slots={{ PlainTable, Id }} />
      </LocaleProvider>,
    ).container

    expect(container.textContent).toContain("No process is deployed on these engines.")
  })
})
