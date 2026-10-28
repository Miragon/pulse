// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import type { JobPanelData } from "../view-models.js"
import { JobPanelWidget } from "./job-panel.js"

// #396: two lines; a scoped panel names its process once in the head, since three-line rows cost a chat card a row.

afterEach(() => {
  cleanup()
  queryClient.clear()
})

const JOB: JobPanelData["jobs"][number] = {
  id: "job-1",
  processInstanceId: "pi-1",
  processDefinitionKey: "invoice",
  processDefinitionId: "invoice:1:abc",
  processDefinitionName: "Invoice receipt",
  activityId: "Activity_ChargeCard",
  activityName: "Charge card",
  retries: 0,
  exceptionMessage: "Card declined",
  dueDate: null,
  suspended: false,
  priority: 0,
  createTime: "2026-06-11T08:00:00.000Z",
}

function renderPanel(filters: JobPanelData["filters"]) {
  const data: JobPanelData = {
    totalCount: 1,
    failedCount: 1,
    jobs: [JOB],
    filters,
    engineId: "prod",
  }
  render(
    <WidgetFixtureHost
      widget={JobPanelWidget as unknown as ComponentType<Record<string, unknown>>}
      data={data as unknown as Record<string, unknown>}
    />,
  )
  return screen.getByText("Charge card").closest("td")!
}

describe("a job's subject", () => {
  it("over several processes: the activity, then its id and its process on one quiet line", () => {
    const cell = renderPanel({})
    expect(cell.textContent).toBe("Charge cardActivity_ChargeCard · in Invoice receipt")
  })

  it("in a panel scoped to one process: the activity and its id; the head names the process", () => {
    const cell = renderPanel({ processDefinitionKey: "invoice" })
    expect(cell.textContent).toBe("Charge cardActivity_ChargeCard")
    // Named once, in the head's meta line.
    expect(screen.getAllByText("in Invoice receipt")).toHaveLength(1)
    expect(cell.textContent).not.toContain("Invoice receipt")
  })

  it("over several processes, the head names none", () => {
    renderPanel({})
    expect(screen.getAllByText(/Invoice receipt/)).toHaveLength(1)
  })

  it("without an activity: the process alone under the dash", () => {
    const data: JobPanelData = {
      totalCount: 1,
      failedCount: 1,
      jobs: [{ ...JOB, activityId: null, activityName: null }],
      filters: {},
      engineId: "prod",
    }
    render(
      <WidgetFixtureHost
        widget={JobPanelWidget as unknown as ComponentType<Record<string, unknown>>}
        data={data as unknown as Record<string, unknown>}
      />,
    )
    expect(screen.getByText("in Invoice receipt")).toBeTruthy()
  })
})
