// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { TestViewHost, type FollowUp } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitDashboardData, IncidentInstance, JobPanelData } from "../view-models.js"
import { ProcessDefinitionsTable } from "./cockpit-dashboard/definitions-table.js"
import { JobPanelWidget } from "./job-panel.js"
import { NavProvider, type NavIntent } from "./navigation.js"
import { IncidentTable } from "./process-incidents/incident-table.js"
import type { IncidentRecoveryState } from "./process-incidents/use-incident-recovery.js"

// One row convention on every surface (owner direction 2026-11-18): a table row opens what it
// names on a click or Enter and copies its id on Ctrl or Cmd with C, as the webview's rows do; its
// further actions stay at its end and open nothing.

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
})

afterEach(cleanup)

const DEFINITIONS: CockpitDashboardData = {
  summary: { totalDefinitions: 2, totalRunningInstances: 8, totalFailedJobs: 0, totalIncidents: 0 },
  definitions: ["invoice", "shipping"].map((key) => ({
    id: `${key}:1:d`,
    key,
    name: key === "invoice" ? "Invoice receipt" : null,
    latestVersion: 1,
    instances: 4,
    failedJobs: 0,
    incidents: [],
  })),
  engineId: "prod",
}

function renderDefinitions() {
  const go = vi.fn<(intent: NavIntent) => void>()
  render(
    <TestViewHost>
      <NavProvider value={go}>
        <ProcessDefinitionsTable data={DEFINITIONS} engine="prod" />
      </NavProvider>
    </TestViewHost>,
  )
  return go
}

describe("the overview's processes", () => {
  it("open their process on a click or Enter, named by it; Instances at the row's end", () => {
    const go = renderDefinitions()
    const row = screen.getByRole("row", { name: "Process Invoice receipt" })
    fireEvent.click(within(row).getByText("Invoice receipt"))
    fireEvent.keyDown(row, { key: "Enter" })
    fireEvent.click(within(row).getByRole("button", { name: /^View running instances/ }))
    expect(go.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "process-detail", processDefinitionKey: "invoice", label: "Invoice receipt" },
      { type: "process-detail", processDefinitionKey: "invoice", label: "Invoice receipt" },
      { type: "process-instances", processDefinitionKey: "invoice" },
    ])
    expect(screen.getByRole("row", { name: "Process shipping" })).toBeTruthy()
    expect(screen.queryAllByRole("button", { name: /^Open/ })).toEqual([])
  })

  it("copy their key on Ctrl or Cmd with C and say so", async () => {
    renderDefinitions()
    fireEvent.keyDown(screen.getByRole("row", { name: "Process shipping" }), {
      key: "c",
      metaKey: true,
    })
    expect(await screen.findByText("ID copied")).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("shipping")
  })
})

function incident(id: string, over: Partial<IncidentInstance> = {}): IncidentInstance {
  return {
    id,
    processInstanceId: `pi-${id}`,
    incidentType: "failedJob",
    incidentMessage: `message ${id}`,
    incidentTimestamp: "2026-10-09T09:30:00.000+0000",
    activityId: "charge",
    activityName: "Charge card",
    cockpitInstanceUrl: null,
    businessKey: `ORD-${id}`,
    recovery: { action: "none" },
    ...over,
  }
}

/** The recovery the table reads: `retry` offers a write per row, `done` marks rows done. */
function recoveryOf({
  retry = false,
  done = [],
}: {
  retry?: boolean
  done?: string[]
}): IncidentRecoveryState {
  return {
    actionFor: () => (retry ? "retry" : null),
    isDone: (row: IncidentInstance) => done.includes(row.id),
    isPending: () => false,
    errorOf: () => null,
    act: vi.fn(),
  } as unknown as IncidentRecoveryState
}

function renderIncidents(
  options: { retry?: boolean; done?: string[]; followUp?: FollowUp; subject?: "element" } = {},
) {
  const onAnalyze = vi.fn<(id: string) => void>()
  render(
    <TestViewHost followUp={options.followUp ?? "chat"}>
      <IncidentTable
        incidents={[
          incident("1"),
          incident("2", { incidentTimestamp: "2026-10-09T11:45:00.000+0000" }),
        ]}
        recovery={recoveryOf(options)}
        onAnalyze={onAnalyze}
        subject={options.subject}
      />
    </TestViewHost>,
  )
  return onAnalyze
}

describe("an incident table's rows", () => {
  it("open their incident on a click or Enter; the write and the menu at the end open nothing", () => {
    const onAnalyze = renderIncidents({ retry: true })
    const row = screen.getByRole("row", { name: "Incident of instance ORD-1" })
    fireEvent.click(within(row).getByText("message 1"))
    fireEvent.keyDown(row, { key: "Enter" })
    fireEvent.click(within(row).getByRole("button", { name: "Retry" }))
    fireEvent.click(within(row).getByRole("button", { name: /^More actions/ }))
    expect(onAnalyze.mock.calls).toEqual([["1"], ["1"]])
    expect(screen.queryAllByRole("button", { name: /^Open/ })).toEqual([])
  })

  it("name an instance's incidents by their element and their time, each its own", () => {
    renderIncidents({ subject: "element" })
    const names = screen
      .getAllByRole("row", { name: /^Incident at Charge card, / })
      .map((row) => row.getAttribute("aria-label"))
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    expect(names[0]).toContain(
      within(screen.getAllByRole("row")[1]).getAllByRole("cell")[2].textContent,
    )
  })

  it("open nothing once their incident is done, the row saying so in words", () => {
    const onAnalyze = renderIncidents({ done: ["2"] })
    const done = screen.getByText("ORD-2").closest("tr")!
    expect(done.hasAttribute("aria-label")).toBe(false)
    fireEvent.click(within(done).getByText("message 2"))
    fireEvent.keyDown(done, { key: "Enter" })
    expect(onAnalyze).not.toHaveBeenCalled()
    expect(done.textContent).toContain("Retry scheduled")
  })

  it("leave out the column of actions where no row shows one (a page without writes or chat)", () => {
    renderIncidents({ followUp: "none" })
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull()
    cleanup()
    renderIncidents({ followUp: "none", retry: true })
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy()
  })
})

const JOBS: JobPanelData = {
  totalCount: 1,
  allCount: 3,
  failedCount: 1,
  fetchedAt: "2026-10-09T09:30:00.000Z",
  jobs: [
    {
      id: "job-7",
      processInstanceId: "pi-7",
      processDefinitionKey: "invoice",
      processDefinitionId: "invoice:1:d",
      processDefinitionName: "Invoice receipt",
      activityId: "charge",
      activityName: "Charge card",
      retries: 0,
      exceptionMessage: "Card declined",
      dueDate: null,
      suspended: false,
      priority: 0,
      createTime: "2026-10-09T09:00:00.000Z",
    },
  ],
  filters: { failedOnly: true },
  engineId: "prod",
}

// The jobs had no row target (A2): a job has no view of its own, so its row opens its instance,
// where its incident shows, and copies the job's own id.
describe("the jobs' rows", () => {
  it("open their job's instance on a click or Enter and copy the job's id", async () => {
    const go = vi.fn<(intent: NavIntent) => void>()
    render(
      <TestViewHost>
        <NavProvider value={go}>
          <JobPanelWidget data={JOBS} engine="prod" failedOnly />
        </NavProvider>
      </TestViewHost>,
    )
    const row = screen.getByRole("row", { name: "Job at Charge card, instance pi-7" })
    fireEvent.click(within(row).getByText("Card declined"))
    fireEvent.keyDown(row, { key: "Enter" })
    expect(go.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "instance-detail", processInstanceId: "pi-7" },
      { type: "instance-detail", processInstanceId: "pi-7" },
    ])
    fireEvent.keyDown(row, { key: "c", metaKey: true })
    expect(await screen.findByText("Job ID copied")).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("job-7")
  })
})
