// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { TestViewHost, type FollowUp } from "@miragon/pulse-widget-shell/widgets"
import type { IncidentInstance } from "../view-models.js"
import { VariablesTab } from "./instance-detail/variables-tab.js"
import { IncidentTable } from "./process-incidents/incident-table.js"
import { useIncidentRecovery } from "./process-incidents/use-incident-recovery.js"

/**
 * A menu or a row that holds hand-offs alone shows only where the host shows a hand-off: a page
 * outside a chat that hides them (`followUp` "none") gets no empty menu and no empty row, and an
 * entry of another kind keeps its menu.
 */

afterEach(cleanup)

const MENU = "More actions for this incident"

function incident(id: string, cockpitInstanceUrl: string | null): IncidentInstance {
  return {
    id,
    processInstanceId: `pi-${id}`,
    incidentType: "failedJob",
    incidentMessage: `message ${id}`,
    incidentTimestamp: "2026-10-09T09:30:00.000+0000",
    activityId: "charge",
    activityName: null,
    cockpitInstanceUrl,
    businessKey: null,
    recovery: { action: "none" },
  }
}

const INCIDENTS = [
  incident("linked", "https://engine.example/camunda/app/cockpit/#/process-instance/pi-linked"),
  incident("bare", null),
]

function Incidents() {
  const recovery = useIncidentRecovery("prod", { resetOn: INCIDENTS })
  return (
    <IncidentTable
      incidents={INCIDENTS}
      recovery={recovery}
      onAnalyze={() => {}}
      engine="prod"
      vendor="CIB seven"
    />
  )
}

async function menuOf(followUp: FollowUp, id: string) {
  render(
    <TestViewHost followUp={followUp}>
      <Incidents />
    </TestViewHost>,
  )
  const row = (await screen.findByText(`message ${id}`)).closest("tr")!
  return within(row).queryByRole("button", { name: MENU })
}

function entriesOf(menu: HTMLElement): HTMLElement[] {
  fireEvent.click(menu)
  return within(screen.getByRole("menu", { name: MENU })).getAllByRole("menuitem")
}

describe("an incident row's menu", () => {
  it("shows none where its one entry would be a hand-off the host hides", async () => {
    expect(await menuOf("none", "bare")).toBeNull()
  })

  it("holds the engine's link alone where the host hides hand-offs", async () => {
    const entries = entriesOf((await menuOf("none", "linked"))!)
    expect(entries.map((entry) => entry.tagName)).toEqual(["A"])
  })

  it("holds the hand-off where the host copies its prompt", async () => {
    const entries = entriesOf((await menuOf("copy", "bare"))!)
    expect(entries.map((entry) => entry.textContent)).toEqual(["Copy prompt: Draft ticket in chat"])
  })
})

describe("the variables tab", () => {
  function renderTab(followUp: FollowUp) {
    render(
      <TestViewHost followUp={followUp}>
        <div data-testid="tab">
          <VariablesTab
            variables={{}}
            instanceId="pi-1"
            definitionId="invoice:1:abc"
            engineId="prod"
            readOnly
          />
        </div>
      </TestViewHost>,
    )
    return screen.getByTestId("tab")
  }

  it("starts with its table where the host hides hand-offs, no empty row above it", () => {
    expect(renderTab("none").childElementCount).toBe(1)
  })

  it("leads with its hand-off in a chat", () => {
    const tab = renderTab("chat")
    expect(tab.childElementCount).toBe(2)
    expect(within(tab).getByRole("button", { name: "Check variables in chat" })).toBeTruthy()
  })
})
