// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type { CockpitDashboardData, JobPanelData } from "../view-models.js"
import { ProcessDefinitionsTable } from "./cockpit-dashboard/definitions-table.js"
import { VariablesTable } from "./instance-sections.js"
import { JobPanelWidget } from "./job-panel.js"

/**
 * A table's row actions sit under a head that names them, as the instance list's and a cluster's
 * do: a screen reader's table navigation reads "Actions", never a bare column head. The
 * variables' edit column is there only where the deployment offers the write.
 */

afterEach(cleanup)

const OVERVIEW: CockpitDashboardData = {
  summary: { totalDefinitions: 1, totalRunningInstances: 4, totalFailedJobs: 0, totalIncidents: 0 },
  definitions: [
    {
      id: "invoice:1:d",
      key: "invoice",
      name: "Invoice",
      latestVersion: 1,
      instances: 4,
      failedJobs: 0,
      incidents: [],
    },
  ],
  engineId: "prod",
}

const JOBS: JobPanelData = {
  totalCount: 1,
  failedCount: 1,
  jobs: [
    {
      id: "job-1",
      processInstanceId: "pi-1",
      processDefinitionKey: "invoice",
      processDefinitionId: "invoice:1:abc",
      processDefinitionName: "Invoice receipt",
      activityId: "chargeCard",
      activityName: "Charge card",
      retries: 0,
      exceptionMessage: "Card declined",
      dueDate: null,
      suspended: false,
      priority: 0,
      createTime: "2026-06-11T08:00:00.000Z",
    },
  ],
  filters: {},
  engineId: "prod",
}

const lastHead = () => screen.getAllByRole("columnheader").at(-1)!

describe.each([
  ["en", "Actions"],
  ["de", "Aktionen"],
])("the row actions' head (%s)", (locale, word) => {
  it("the overview's processes: named, right-aligned over the actions, its word read where they scroll", () => {
    render(
      <TestViewHost locale={locale}>
        <ProcessDefinitionsTable data={OVERVIEW} engine="prod" />
      </TestViewHost>,
    )
    const head = lastHead()
    expect(head.textContent).toBe(word)
    expect(head.className).toContain("text-right")
    // Pinned from 40rem up only: below it the word is a screen reader's alone.
    expect(head.querySelector("[data-list-table-scrolls]")?.textContent).toBe(word)
  })

  it("the jobs: named, right-aligned over the pinned actions", () => {
    render(
      <TestViewHost locale={locale}>
        <JobPanelWidget data={JOBS} engine="prod" />
      </TestViewHost>,
    )
    const head = lastHead()
    expect(head.textContent).toBe(word)
    expect(head.className).toContain("text-right")
    expect(head.querySelector("[data-list-table-scrolls]")).toBeNull()
  })

  it("an instance's variables where they can be edited: named, right-aligned over the pinned edit", async () => {
    const tools = {
      [ENGINE_WIDGET_ACTIONS_DATA]: {
        allowedActions: ["engine_set_process_instance_variable"],
        readOnlyEngines: [],
      },
    }
    render(
      <TestViewHost locale={locale} tools={tools}>
        <VariablesTable
          variables={{ amount: { value: 42, type: "Integer" } }}
          instanceId="pi-1"
          engine="prod"
        />
      </TestViewHost>,
    )
    const head = await screen.findByRole("columnheader", { name: word })
    expect(head).toBe(lastHead())
    expect(head.className).toContain("text-right")
    expect(head.querySelector("[data-list-table-scrolls]")).toBeNull()
  })
})
