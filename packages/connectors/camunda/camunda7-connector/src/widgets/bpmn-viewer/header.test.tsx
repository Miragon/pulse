// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import type { BpmnViewerData } from "../../view-models.js"
import { BpmnViewerHeader } from "./header.js"

afterEach(() => {
  cleanup()
  queryClient.clear()
})

const VIEW: BpmnViewerData = {
  diagramDefinitionId: null,
  processInstanceId: "5f0ce78e-8b14-4c2a-9f3e-100000110866",
  businessKey: "LEA-2026-00413",
  processDefinitionId: "leasing:3:abc",
  processDefinitionName: "Bike leasing",
  activeActivityIds: [],
  incidentActivityIds: [],
  activityStats: [],
  statsScope: "instance",
  engineId: "prod-leasing",
}

function renderHeader(data: BpmnViewerData) {
  const Header: ComponentType<Record<string, unknown>> = () => <BpmnViewerHeader data={data} />
  render(<WidgetFixtureHost widget={Header} data={{}} tools={{}} />)
}

// Names before ids: the instance by its label, as the instance detail does (#322 U13).
describe("BpmnViewerHeader", () => {
  it("titles the view by the process and names the instance by its business key", () => {
    renderHeader(VIEW)
    expect(screen.getByRole("heading", { name: "Bike leasing" })).toBeTruthy()
    expect(screen.getByText("LEA-2026-00413")).toBeTruthy()
    expect(screen.getByText("5f0ce78e…")).toBeTruthy()
  })

  it("falls back to the generic title and the id chip alone", () => {
    renderHeader({ ...VIEW, processDefinitionName: null, businessKey: null })
    expect(screen.getByRole("heading", { name: "BPMN diagram" })).toBeTruthy()
    expect(screen.queryByText("LEA-2026-00413")).toBeNull()
    expect(screen.getByText("5f0ce78e…")).toBeTruthy()
  })
})
