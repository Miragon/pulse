// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import {
  CAMUNDA7_ACTIVITY_INCIDENTS_DATA,
  CAMUNDA7_PROCESS_INCIDENTS_DATA,
  CAMUNDA7_PROCESS_INSTANCES_DATA,
  CAMUNDA7_WIDGET_ACTIONS_DATA,
} from "../tool-names.js"
import type {
  ActivityIncidentsData,
  IncidentInstance,
  InstanceDetailData,
  ProcessIncidentsData,
  ProcessInstancesData,
} from "../view-models.js"
import { ProcessDefinitionKpi } from "./process-incidents/kpi.js"
import { ActivityIncidentList } from "./process-incidents/list.js"
import { ProcessInstancesWidget } from "./process-instances/list.js"
import {
  FAILED_JOB_INCIDENT,
  Standalone,
  adminActions,
  completeTheOpenTask,
  installWritePathHarness,
  instance,
  recorder,
  renderInstance,
  type Calls,
} from "./write-path.test-support.js"

// #341: a write re-reads every view showing what it changed (`WRITE_POLICY`), mounted ones at once,
// unmounted on next mount; marks follow the rows' own data, never a sibling feed that answers first.

installWritePathHarness()

const INSTANCE_ROWS: ProcessInstancesData = {
  processDefinitionKey: "invoice",
  processDefinitionName: "Invoice",
  totalCount: 1,
  returnedCount: 1,
  withIncidentCount: 1,
  suspendedCount: 0,
  instances: [
    {
      id: "pi-1",
      businessKey: "INV-7",
      processDefinitionKey: "invoice",
      processDefinitionName: null,
      version: 1,
      suspended: false,
      hasIncident: true,
    },
  ],
  filters: {},
  engineId: "prod",
}

const DEFINITION: ProcessIncidentsData = {
  processDefinitionKey: "invoice",
  processDefinitionName: "Invoice",
  diagramVersion: 1,
  diagramDefinitionId: null,
  cockpitUrl: null,
  runningInstances: 1,
  incidentCount: 1,
  last24hCount: 1,
  failedJobs: 1,
  totalActivityCount: null,
  affectedDiagramActivityCount: null,
  latestIncident: "2026-10-10T08:00:00.000+0000",
  activities: [
    {
      activityId: "chargeCard",
      activityName: "Charge card",
      representativeMessage: "seeded summary",
      incidentCount: 1,
      firstSeen: null,
      latestIncident: "2026-10-10T08:00:00.000+0000",
    },
  ],
  siblingsWithIncidents: null,
  engineVendor: "CIB seven",
  engineId: "prod",
}

function activityRows(incidents: IncidentInstance[]): ActivityIncidentsData {
  return {
    processDefinitionKey: "invoice",
    activityId: "chargeCard",
    incidents,
    totalCount: incidents.length,
    engineId: "prod",
  }
}

// The cockpit unmounts left views, and a remount within the 30 s staleTime serves the cache unless
// the write invalidated it.
async function rereadsAfter(
  view: ComponentType<Record<string, unknown>>,
  feed: string,
  answer: unknown,
  write: { data: InstanceDetailData; tools: Record<string, unknown>; run: () => Promise<void> },
) {
  const reads: Calls = []
  const tools = {
    [CAMUNDA7_WIDGET_ACTIONS_DATA]: adminActions(),
    ...recorder(reads, feed, () => answer),
  }
  const first = render(<WidgetFixtureHost widget={view} data={{}} tools={tools} />)
  await waitFor(() => expect(reads).toHaveLength(1))
  first.unmount()

  const detail = renderInstance(Standalone, write.data, write.tools)
  await write.run()
  detail.unmount()

  render(<WidgetFixtureHost widget={view} data={{}} tools={tools} />)
  await waitFor(() => expect(reads).toHaveLength(2))
}

describe("a write refreshes every view that shows what it changed", () => {
  it("an incident remedy refreshes the instance list's incident flag (hasIncident)", async () => {
    const InstanceList: ComponentType<Record<string, unknown>> = () => (
      <ProcessInstancesWidget data={null} processDefinitionKey="invoice" engine="prod" />
    )
    const writes: Calls = []
    await rereadsAfter(InstanceList, CAMUNDA7_PROCESS_INSTANCES_DATA, INSTANCE_ROWS, {
      data: instance({ incidents: [FAILED_JOB_INCIDENT], incidentCount: 1, openTasks: [] }),
      tools: recorder(writes, "camunda7_set_job_retries", () => ({ success: true })),
      run: async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
        await waitFor(() => expect(writes).toHaveLength(1))
      },
    })
  })

  it("completing a task refreshes the definition view's running-instance count", async () => {
    const DefinitionKpi: ComponentType<Record<string, unknown>> = () => (
      <ProcessDefinitionKpi processDefinitionKey="invoice" engine="prod" />
    )
    const writes: Calls = []
    await rereadsAfter(DefinitionKpi, CAMUNDA7_PROCESS_INCIDENTS_DATA, DEFINITION, {
      data: instance(),
      tools: recorder(writes, "camunda7_complete_task", () => ({
        success: true,
        outcome: "completed",
      })),
      run: async () => {
        await completeTheOpenTask()
        await waitFor(() => expect(writes).toHaveLength(1))
      },
    })
  })
})

describe("the definition view's remedy marks follow the rows they mark", () => {
  it("a definition refetch that lands before the rows' refetch does not bring the row's Retry back", async () => {
    let rowReads = 0
    let releaseRows!: (rows: ActivityIncidentsData) => void
    render(
      <WidgetFixtureHost
        widget={ActivityIncidentList as unknown as ComponentType<Record<string, unknown>>}
        data={DEFINITION as unknown as Record<string, unknown>}
        tools={{
          [CAMUNDA7_WIDGET_ACTIONS_DATA]: adminActions(),
          camunda7_set_job_retries: () => ({ success: true }),
          [CAMUNDA7_PROCESS_INCIDENTS_DATA]: () => ({
            ...DEFINITION,
            activities: [{ ...DEFINITION.activities[0], representativeMessage: "fresh summary" }],
          }),
          // The rows' own refetch is slower.
          [CAMUNDA7_ACTIVITY_INCIDENTS_DATA]: () => {
            rowReads += 1
            if (rowReads === 1) return activityRows([FAILED_JOB_INCIDENT])
            return new Promise((resolve) => (releaseRows = resolve))
          },
        }}
      />,
    )
    fireEvent.click(await screen.findByText("Charge card"))
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Retry scheduled")).toBeTruthy()

    // The definition feed answered; the rows are still the pre-retry page.
    expect(await screen.findByText("fresh summary")).toBeTruthy()
    await waitFor(() => expect(rowReads).toBe(2))
    expect(screen.getByText("Retry scheduled")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()

    // The rows' refetch lands: server truth replaces the mark.
    act(() => releaseRows(activityRows([])))
    expect(await screen.findByText("No open incidents.")).toBeTruthy()
  })
})
