// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import type { IncidentInstance, InstanceDetailData } from "../view-models.js"
import { InstanceDetailWidget } from "./instance-detail.js"
import { NavProvider, type NavIntent } from "./navigation.js"
import { FAILED_JOB_INCIDENT, instance } from "./write-path.test-support.js"

/** What VS Code shows and the cockpit lacked: each incident's element, and the way to the process. */

afterEach(() => {
  cleanup()
})

const at = (
  id: string,
  activityId: string | null,
  activityName: string | null,
): IncidentInstance => ({
  ...FAILED_JOB_INCIDENT,
  id,
  incidentMessage: `message ${id}`,
  activityId,
  activityName,
})

/** No open task, so the view opens on its Incidents tab. */
const withIncidents = (over: Partial<InstanceDetailData> = {}) =>
  instance({
    processDefinitionName: "Invoice Receipt",
    incidents: [
      at("inc-1", "chargeCard", "Charge card"),
      at("inc-2", "Gateway_1x9", null),
      at("inc-3", null, null),
    ],
    incidentCount: 3,
    openTasks: [],
    openTaskCount: 0,
    ...over,
  })

function renderDetail(data: InstanceDetailData, locale?: string) {
  const intents: NavIntent[] = []
  const view = render(
    <NavProvider value={(intent) => intents.push(intent)}>
      <TestViewHost locale={locale}>
        <InstanceDetailWidget data={data} processInstanceId="pi-1" engine="prod" />
      </TestViewHost>
    </NavProvider>,
  )
  return { intents, ...view }
}

describe("the instance's Incidents tab names each incident's element", () => {
  it("by its diagram name over the id, the id where it has none, a dash where the engine names none", () => {
    renderDetail(withIncidents())
    const table = screen.getByRole("region", { name: "Incidents of this instance" })
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent)
    expect(headers.slice(0, 2)).toEqual(["Activity", "Error message"])

    const firstCells = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("td")!)
    // The name leads, the BPMN id on the quiet line below it.
    expect(firstCells[0].textContent).toBe("Charge cardchargeCard")
    // Without a name the id leads, in mono, never a blank cell.
    expect(firstCells[1].textContent).toBe("Gateway_1x9")
    expect(firstCells[1].querySelector(".font-mono")).not.toBeNull()
    expect(firstCells[2].textContent).toBe("—")
  })

  it("in German too", () => {
    renderDetail(withIncidents(), "de")
    const table = screen.getByRole("region", { name: "Incidents dieser Instanz" })
    expect(within(table).getAllByRole("columnheader")[0].textContent).toBe("Aktivität")
  })
})

describe("the instance's header leads to its process", () => {
  it("as its first action, a drill into the cockpit's process route; the meta line stays facts", () => {
    const { intents, container } = renderDetail(withIncidents())
    const header = container.querySelector<HTMLElement>('[data-slot="widget-header"]')!
    const [facts, group] = Array.from(header.children) as HTMLElement[]
    // Facts only (invariant 6): the process is named there, the way to it is an action.
    expect(facts.textContent).toContain("Invoice Receipt")
    expect(facts.querySelectorAll("a")).toHaveLength(0)
    expect(within(facts).queryByRole("button", { name: /process|invoice/i })).toBeNull()

    const actions = within(group).getAllByRole("button")
    expect(actions[0].textContent).toBe("View process")
    fireEvent.click(actions[0])
    expect(intents).toEqual([
      { type: "process-detail", processDefinitionKey: "invoice", label: "Invoice Receipt" },
    ])
  })

  it("in German too", () => {
    const { intents } = renderDetail(withIncidents(), "de")
    fireEvent.click(screen.getByRole("button", { name: "Prozess anzeigen" }))
    expect(intents).toEqual([
      { type: "process-detail", processDefinitionKey: "invoice", label: "Invoice Receipt" },
    ])
  })

  it("not while the process's key is unknown (a bare id the engine could not resolve)", () => {
    renderDetail(withIncidents({ definitionKey: null }))
    expect(screen.queryByRole("button", { name: "View process" })).toBeNull()
  })
})
