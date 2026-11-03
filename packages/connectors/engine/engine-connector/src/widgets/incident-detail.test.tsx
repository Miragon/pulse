// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  ENGINE_INCIDENT_DETAIL_DATA,
  ENGINE_WIDGET_ACTIONS,
  ENGINE_WIDGET_ACTIONS_DATA,
} from "../tool-names.js"
import type { IncidentDetailData } from "../view-models.js"
import { IncidentDetailWidget } from "./incident-detail.js"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

// #328: Retry for built-in types, Resolve only for custom ones, each only with its tool.

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

const ALL_ACTIONS = { allowedActions: [...ENGINE_WIDGET_ACTIONS] }

function detail(over: Partial<IncidentDetailData>): IncidentDetailData {
  return {
    incidentId: "inc-1",
    incidentType: "failedJob",
    incidentMessage: "boom",
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
    job: null,
    recovery: { action: "resolve" },
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
    ...over,
  }
}

const JOB = { id: "job-1", retries: 0, exceptionMessage: "boom", stacktrace: null, dueDate: null }

const FAILED_JOB = detail({ job: JOB, recovery: { action: "retry-job", jobId: "job-1" } })
const FAILED_TASK = detail({
  incidentType: "failedExternalTask",
  recovery: { action: "retry-external-task", externalTaskId: "ext-1" },
})
const CUSTOM = detail({ incidentType: "invoiceMismatch" })

type Calls = Array<[string, Record<string, unknown>]>

/** The incident-detail route on the fixtures' engine. */
function renderDetail(data: IncidentDetailData, tools: Record<string, unknown>) {
  render(
    <TestViewHost tools={tools} client={queryClient}>
      <IncidentDetailWidget data={data} incidentId={data.incidentId} engine="prod" />
    </TestViewHost>,
  )
}

function recording(calls: Calls, ...names: string[]): Record<string, unknown> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      (args: Record<string, unknown>) => {
        calls.push([name, args])
        return { success: true }
      },
    ]),
  )
}

// So an absent button is a decision.
async function gateSettled() {
  await waitFor(() =>
    expect(
      queryClient.getQueryCache().find({ queryKey: ["engine-widget-actions"], exact: false })?.state
        .status,
    ).toBe("success"),
  )
}

describe("the incident detail offers the remedy the engine accepts", () => {
  it("failedJob: Retry job sets the job's retries to 1 on the incident's engine, no Resolve", async () => {
    const calls: Calls = []
    renderDetail(FAILED_JOB, {
      [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
      ...recording(calls, "engine_set_job_retries", "engine_set_external_task_retries"),
    })
    fireEvent.click(await screen.findByText("Retry job"))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual([
      "engine_set_job_retries",
      { jobId: "job-1", retries: 1, engine: "prod" },
    ])
    expect(screen.queryByText("Mark as resolved")).toBeNull()
  })

  it("failedExternalTask: Retry task sets the external task's retries, no Resolve", async () => {
    const calls: Calls = []
    renderDetail(FAILED_TASK, {
      [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
      ...recording(calls, "engine_set_job_retries", "engine_set_external_task_retries"),
    })
    fireEvent.click(await screen.findByText("Retry task"))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual([
      "engine_set_external_task_retries",
      { externalTaskId: "ext-1", retries: 1, engine: "prod" },
    ])
    expect(screen.queryByText("Mark as resolved")).toBeNull()
  })

  it("a custom incident gets Resolve and no Retry", async () => {
    renderDetail(CUSTOM, { [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS })
    expect(await screen.findByText("Mark as resolved")).toBeTruthy()
    expect(screen.queryByText("Retry job")).toBeNull()
    expect(screen.queryByText("Retry task")).toBeNull()
  })

  it("labels each detail's failure section by its own heading, two details on one page included", async () => {
    const Two = () => (
      <>
        <IncidentDetailWidget data={CUSTOM} incidentId={CUSTOM.incidentId} engine="prod" />
        <IncidentDetailWidget
          data={{ ...CUSTOM, incidentId: "inc-2" }}
          incidentId="inc-2"
          engine="prod"
        />
      </>
    )
    render(
      <TestViewHost tools={{}} client={queryClient}>
        <Two />
      </TestViewHost>,
    )
    const sections = await screen.findAllByRole("region", { name: "Error message" })
    expect(sections).toHaveLength(2)
    const ids = sections.map((s) => s.getAttribute("aria-labelledby"))
    expect(new Set(ids).size).toBe(2)
  })

  it("its confirmation names the instance as the head does: business key, then short id", async () => {
    const instanceId = "5f0ce78e-8b14-4c2a-9f3e-100000110866"
    renderDetail(
      detail({
        incidentType: "invoiceMismatch",
        processInstanceId: instanceId,
        businessKey: "LEA-7",
      }),
      { [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS },
    )
    fireEvent.click(await screen.findByText("Mark as resolved"))
    const dialog = await screen.findByRole("alertdialog")
    const lines = [...dialog.querySelectorAll("dt")].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ])
    expect(lines).toEqual([
      ["Incident", "inc-1"],
      ["Type", "invoiceMismatch"],
      ["Business key", "LEA-7"],
      ["Process instance", "5f0ce78e…"],
      ["Engine", "prod"],
    ])
  })

  it("offers no remedy once a refetch cannot confirm the incident is still open", async () => {
    renderDetail(FAILED_JOB, {
      [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
      [ENGINE_INCIDENT_DETAIL_DATA]: () => {
        throw new Error("Incident inc-1 does not exist")
      },
    })
    expect(await screen.findByText("Retry job")).toBeTruthy()
    // A write elsewhere (a variable edit) or a refresh re-reads the incident.
    void queryClient.invalidateQueries({ queryKey: ["engine:incident-detail"] })
    expect(await screen.findByText(/inc-1 does not exist/)).toBeTruthy()
    expect(screen.queryByText("Retry job")).toBeNull()
  })

  it("hides Retry when the toolset lacks the retries tool (and never falls back to Resolve)", async () => {
    renderDetail(FAILED_JOB, {
      [ENGINE_WIDGET_ACTIONS_DATA]: { allowedActions: ["engine_resolve_incident"] },
    })
    await gateSettled()
    expect(await screen.findAllByText("failedJob")).not.toHaveLength(0)
    expect(screen.queryByText("Retry job")).toBeNull()
    expect(screen.queryByText("Mark as resolved")).toBeNull()
  })
})
