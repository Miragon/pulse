// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_WIDGET_ACTIONS, ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type { IncidentDetailData, IncidentInstance, JobPanelData } from "../view-models.js"
import { IncidentDetailWidget } from "./incident-detail.js"
import { VariablesTable } from "./instance-sections.js"
import { JobPanelWidget } from "./job-panel.js"
import { EngineActionDialog } from "./lib/engine-action-dialog.js"
import { IncidentTable } from "./process-incidents/incident-table.js"
import { useIncidentRecovery } from "./process-incidents/use-incident-recovery.js"
import {
  Seeded,
  completeTheOpenTask,
  installWritePathHarness,
  instance,
  renderInstance,
} from "./write-path.test-support.js"

// D2: a failed write names its object in the toast; the inline hint words the failure through
// `describeError`, and the engine's own text shows only under "Details" (invariant 6, #322).

installWritePathHarness()

const ALL_ACTIONS = { allowedActions: [...ENGINE_WIDGET_ACTIONS] }
const ENGINE_TEXT = "Boom raw-engine-text at org.camunda.Secret.java:42"

/** The tool's own error answer, as the server words an engine failure. */
const engineFails = (status: number, type: string) => () => ({
  isError: true,
  content: [{ type: "text", text: `[${status} ${type}] ${ENGINE_TEXT} (engine prod)` }],
})

/** What the view shows without opening anything: no "Details" disclosure, no toast. */
function shownText(): string {
  const copy = document.body.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll('details, [data-slot="toast"]')) hidden.remove()
  return copy.textContent ?? ""
}

function toastText(): string {
  return [...document.querySelectorAll('[data-slot="toast"]')].map((t) => t.textContent).join(" ")
}

async function expectWordedFailure(title: string, hint: string, toast: string) {
  const heading = await screen.findByText(title)
  const state = heading.closest('[data-slot="error-state"]')!
  expect(state.getAttribute("role")).toBe("alert")
  expect(state.textContent).toContain(hint)
  expect(state.querySelector("details")?.textContent).toContain(ENGINE_TEXT)
  await waitFor(() => expect(toastText()).toContain(toast))
  expect(shownText()).not.toContain("raw-engine-text")
  expect(shownText()).not.toContain("Exception]")
}

const expectEngineError = (status: number, toast: string) =>
  expectWordedFailure(
    `Engine prod reported an error (HTTP ${status})`,
    "You'll find the reason under Details. Try again, or ask in the chat.",
    toast,
  )

const FAILED_JOB: JobPanelData["jobs"][number] = {
  id: "job-1",
  processInstanceId: "pi-1",
  processDefinitionKey: "invoice",
  processDefinitionId: "invoice:1:abc",
  processDefinitionName: null,
  activityId: "chargeCard",
  activityName: null,
  retries: 0,
  exceptionMessage: "Card declined",
  dueDate: null,
  suspended: false,
  priority: 0,
  createTime: "2026-06-11T08:00:00.000Z",
}

const JOBS: JobPanelData = {
  totalCount: 1,
  failedCount: 1,
  jobs: [FAILED_JOB],
  filters: { failedOnly: true },
  engineId: "prod",
}

function renderJobs(locale?: string) {
  render(
    <TestViewHost
      locale={locale}
      tools={{
        [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
        engine_set_job_retries: engineFails(500, "ProcessEngineException"),
      }}
    >
      <JobPanelWidget data={JOBS as never} engine="prod" failedOnly />
    </TestViewHost>,
  )
}

function incident(id: string, over: Partial<IncidentInstance>): IncidentInstance {
  return {
    id,
    processInstanceId: "pi-1",
    incidentType: "failedJob",
    incidentMessage: `message ${id}`,
    incidentTimestamp: "2026-10-09T09:30:00.000+0000",
    cockpitInstanceUrl: null,
    businessKey: null,
    recovery: { action: "none" },
    ...over,
  }
}

const INCIDENTS = [
  incident("job", { recovery: { action: "retry-job", jobId: "job-1" } }),
  incident("custom", { incidentType: "invoiceMismatch", recovery: { action: "resolve" } }),
]

function Incidents() {
  const recovery = useIncidentRecovery("prod", { resetOn: INCIDENTS })
  return (
    <>
      <IncidentTable incidents={INCIDENTS} recovery={recovery} onAnalyze={() => {}} />
      <EngineActionDialog action={recovery.resolve} />
    </>
  )
}

function renderIncidents() {
  render(
    <TestViewHost
      tools={{
        [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
        engine_set_job_retries: engineFails(500, "ProcessEngineException"),
        engine_resolve_incident: engineFails(500, "ProcessEngineException"),
      }}
    >
      <Incidents />
    </TestViewHost>,
  )
}

async function rowOf(message: string) {
  return (await screen.findByText(message)).closest("tr")!
}

const FAILED_JOB_DETAIL: IncidentDetailData = {
  incidentId: "inc-1",
  incidentType: "failedJob",
  incidentMessage: "Card declined",
  incidentTimestamp: "2026-10-09T09:30:00.000+0000",
  activityId: "charge",
  activityName: "Charge card",
  processDefinitionKey: "invoice",
  processDefinitionId: "invoice:1:abc",
  processDefinitionName: "Invoice",
  processDefinitionVersion: 1,
  processInstanceId: "pi-1",
  businessKey: null,
  cockpitInstanceUrl: null,
  engineVendor: "CIB seven",
  diagramDefinitionId: null,
  job: {
    id: "job-1",
    retries: 0,
    exceptionMessage: "Card declined",
    stacktrace: null,
    dueDate: null,
  },
  recovery: { action: "retry-job", jobId: "job-1" },
  instance: {
    id: "pi-1",
    definitionId: "invoice:1:abc",
    businessKey: null,
    suspended: false,
    ended: false,
  },
  activityTree: null,
  variables: {},
  historyTotalCount: null,
  engineId: "prod",
}

describe("a failed write shows the engine's text only under Details (D2)", () => {
  it("job panel: Retry job", async () => {
    renderJobs()
    fireEvent.click(await screen.findByRole("button", { name: "Retry job" }))
    await expectEngineError(500, "Couldn't retry the job for instance pi-1")
  })

  it("job panel in German: the hint and the toast speak the host's language", async () => {
    renderJobs("de")
    fireEvent.click(await screen.findByRole("button", { name: "Job neu versuchen" }))
    await expectWordedFailure(
      "Die Engine prod meldet einen Fehler (HTTP 500)",
      "Den Grund findest du unter Details. Versuch es noch mal oder frag im Chat nach.",
      "Job für Instanz pi-1 konnte nicht neu eingeplant werden",
    )
  })

  it("variables: Save keeps the input and words the rejection", async () => {
    render(
      <TestViewHost
        tools={{
          [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
          engine_set_process_instance_variable: engineFails(400, "InvalidRequestException"),
        }}
      >
        <VariablesTable
          variables={{ amount: { value: 42, type: "Integer" } }}
          instanceId="pi-1"
          engine="prod"
        />
      </TestViewHost>,
    )
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
    fireEvent.change(screen.getByDisplayValue("42"), { target: { value: "43" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await expectEngineError(400, "Couldn't save variable amount")
    expect(screen.getByDisplayValue("43")).toBeTruthy()
  })

  it("open task: Complete task keeps the form open and words the failure", async () => {
    renderInstance(Seeded, instance(), {
      engine_complete_task: engineFails(500, "ProcessEngineException"),
    })
    await completeTheOpenTask()
    await expectEngineError(500, "Couldn't complete task Review invoice")
    expect(screen.getByRole("button", { name: "Complete task" })).toBeTruthy()
  })

  it("incident row: Retry", async () => {
    renderIncidents()
    fireEvent.click(
      await within(await rowOf("message job")).findByRole("button", { name: "Retry" }),
    )
    await expectEngineError(500, "Couldn't retry the job for instance pi-1")
  })

  it("incident row: a failed resolve stays at its row once the dialog is closed", async () => {
    renderIncidents()
    const row = await rowOf("message custom")
    fireEvent.click(await within(row).findByRole("button", { name: "Mark as resolved" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as resolved" }))
    expect(await within(dialog).findByText("Engine prod reported an error (HTTP 500)")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep open" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    const state = (await screen.findByText("Engine prod reported an error (HTTP 500)")).closest(
      '[data-slot="error-state"]',
    )!
    expect(state.querySelector("details")?.textContent).toContain(ENGINE_TEXT)
    expect(shownText()).not.toContain("raw-engine-text")
  })

  it("incident detail: Retry job", async () => {
    render(
      <TestViewHost
        tools={{
          [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
          engine_set_job_retries: engineFails(500, "ProcessEngineException"),
        }}
      >
        <IncidentDetailWidget data={FAILED_JOB_DETAIL} incidentId="inc-1" engine="prod" />
      </TestViewHost>,
    )
    fireEvent.click(await screen.findByRole("button", { name: "Retry job (sets retries to 1)" }))
    await expectEngineError(500, "Couldn't retry the job for instance pi-1")
  })
})
