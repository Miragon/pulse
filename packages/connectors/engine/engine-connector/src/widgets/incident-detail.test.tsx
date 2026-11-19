// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ENGINE_INCIDENT_DETAIL_DATA,
  ENGINE_WIDGET_ACTIONS,
  ENGINE_WIDGET_ACTIONS_DATA,
} from "../tool-names.js"
import type { IncidentDetailData } from "../view-models.js"
import { IncidentDetailWidget } from "./incident-detail.js"
import { NavProvider, type NavIntent } from "./navigation.js"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import { formatClock, formatInstant } from "@miragon/pulse-ui"

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
    externalTask: null,
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
    rootCause: null,
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
function renderDetail(
  data: IncidentDetailData,
  tools: Record<string, unknown>,
  host: { writes?: boolean; followUp?: "chat" | "copy" | "none" } = {},
) {
  render(
    <TestViewHost tools={tools} client={queryClient} {...host}>
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
      // A custom type in words from its code, as the extension reads it.
      ["Type", "Invoice mismatch"],
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
    // The strip under the view's bar says the view could not be refreshed (the kit's words);
    // the engine's own reason waits under its Details.
    const reason = await screen.findByText(/inc-1 does not exist/)
    const strip = reason.closest<HTMLElement>('[data-slot="status-strip"]')!
    expect(within(strip).getByText("Couldn't refresh this view")).toBeTruthy()
    fireEvent.click(within(strip).getByRole("button", { name: "Details" }))
    expect(reason.hidden).toBe(false)
    expect(screen.queryByText("Retry job")).toBeNull()
  })

  it("hides Retry when the toolset lacks the retries tool (and never falls back to Resolve)", async () => {
    renderDetail(FAILED_JOB, {
      [ENGINE_WIDGET_ACTIONS_DATA]: { allowedActions: ["engine_resolve_incident"] },
    })
    await gateSettled()
    expect(await screen.findAllByText("Failed job")).not.toHaveLength(0)
    expect(screen.queryByText("Retry job")).toBeNull()
    expect(screen.queryByText("Mark as resolved")).toBeNull()
  })
})

describe("the incident's stacktrace, as the engine gives it", () => {
  const DETAILS = "java.net.SocketTimeoutException: payment gateway\n\tat PaymentWorker.charge(42)"

  /** The Stacktrace tab, the one open first. */
  const stacktraceTab = () => screen.findByRole("tabpanel", { name: "Stacktrace" })

  it("shows a failed external task's error details, as the webview does, under the task's id", async () => {
    renderDetail(
      { ...FAILED_TASK, externalTask: { id: "ext-1", errorDetails: DETAILS } },
      { [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS },
    )
    const tab = await stacktraceTab()
    const text = within(tab).getByLabelText("Stacktrace")
    expect(text.tagName).toBe("PRE")
    expect(text.textContent).toBe(DETAILS)
    expect(within(tab).getByText("External task")).toBeTruthy()
    expect(within(tab).queryByText(/returned no stacktrace/)).toBeNull()
  })

  it("says the worker's details are missing, never that a job has no stacktrace", async () => {
    renderDetail(
      { ...FAILED_TASK, externalTask: { id: "ext-1", errorDetails: null } },
      { [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS },
    )
    const tab = await stacktraceTab()
    expect(within(tab).getByText(/returned no error details/)).toBeTruthy()
    expect(within(tab).queryByLabelText("Stacktrace")).toBeNull()
    expect(within(tab).queryByText(/returned no stacktrace/)).toBeNull()
  })

  it("keeps a failed job's stacktrace under its job", async () => {
    renderDetail(
      { ...FAILED_JOB, job: { ...JOB, stacktrace: "boom\n\tat Billing.charge(7)" } },
      { [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS },
    )
    const tab = await stacktraceTab()
    expect(within(tab).getByLabelText("Stacktrace").textContent).toBe(
      "boom\n\tat Billing.charge(7)",
    )
    expect(within(tab).queryByText("External task")).toBeNull()
  })

  it("offers the stacktrace to copy whole and to scroll by keyboard, on a page that writes nothing too", async () => {
    renderDetail(
      { ...FAILED_JOB, job: { ...JOB, stacktrace: "boom\n\tat Billing.charge(7)" } },
      { [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS },
      { writes: false, followUp: "none" },
    )
    const tab = await stacktraceTab()
    expect(within(tab).getByRole("region", { name: "Stacktrace" }).tabIndex).toBe(0)
    expect(within(tab).getByRole("button", { name: "Copy stacktrace" })).toBeTruthy()
  })
})

/**
 * From an incident the way leads on in Pulse (N9): its instance first, a delegated incident's root
 * cause next (a copy at a call activity, whose failure is in a called instance), both actions of
 * its bar, which holds facts alone; the cause in words among those facts.
 */
describe("the incident's ways on: its instance and a delegated incident's root cause", () => {
  const CAUSE: NonNullable<IncidentDetailData["rootCause"]> = {
    incidentId: "inc-root",
    message: "Blacklist provider unreachable",
    activityId: "checkBlacklist",
    activityName: "Check blacklist",
    processInstanceId: "30668387-aaaa-bbbb-cccc-ddddeeeeffff",
    processName: "Assess customer credibility",
  }

  function renderWithNav(data: IncidentDetailData) {
    const intents: NavIntent[] = []
    const view = render(
      <NavProvider value={(intent) => intents.push(intent)}>
        <TestViewHost tools={{ [ENGINE_WIDGET_ACTIONS_DATA]: ALL_ACTIONS }} client={queryClient}>
          <IncidentDetailWidget data={data} incidentId={data.incidentId} engine="prod" />
        </TestViewHost>
      </NavProvider>,
    )
    return { intents, ...view }
  }

  it("opens its instance, named as the head names it", () => {
    const { intents } = renderWithNav(detail({ businessKey: "INV-7" }))
    fireEvent.click(screen.getByRole("button", { name: "Open instance" }))
    expect(intents).toEqual([
      { type: "instance-detail", processInstanceId: "pi-1", label: "INV-7" },
    ])
    // A root incident has no cause of its own to open.
    expect(screen.queryByRole("button", { name: "Open cause" })).toBeNull()
    expect(screen.queryByText(/^Cause: /)).toBeNull()
  })

  it("says a delegated incident's cause in the bar's facts, as text, and opens it from the group", () => {
    const { intents, container } = renderWithNav(detail({ rootCause: CAUSE }))
    const facts = container.querySelector<HTMLElement>('[data-slot="view-bar-facts"]')!
    expect(
      within(facts).getByText("Cause: Check blacklist in Assess customer credibility"),
    ).toBeTruthy()
    expect(facts.querySelectorAll("a")).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Open cause" }))
    expect(intents).toEqual([
      { type: "incident-detail", incidentId: "inc-root", label: "Check blacklist" },
    ])
  })

  it("names where a delegated incident's failure is: its called instance, copyable", () => {
    renderWithNav(detail({ rootCause: { ...CAUSE, activityName: null, processName: null } }))
    // Without names the element by its id, the process by the called instance's short id.
    expect(screen.getByText("Cause: checkBlacklist in 30668387…")).toBeTruthy()
    const located = screen.getByText("Located in")
    expect(located.nextElementSibling?.textContent).toContain("30668387…")
    expect(screen.getAllByRole("button", { name: "Copy 30668387…" })).toHaveLength(1)
  })

  // X1, D9: every route says when it was read, once, at its bar's end.
  it("says when the server read the incident, once at the bar's end, never among its facts", () => {
    const fetchedAt = "2026-10-09T09:41:00.000Z"
    const { container } = renderWithNav(detail({ fetchedAt }))
    const bar = container.querySelector<HTMLElement>('[data-slot="view-bar"]')!
    const stamps = bar.querySelectorAll<HTMLElement>('[data-slot="freshness-stamp"]')
    expect(stamps).toHaveLength(1)
    expect(stamps[0].textContent).toBe(`As of ${formatClock(fetchedAt, { seconds: false })}`)
    expect(stamps[0].title).toBe(formatInstant(fetchedAt))
    expect(
      bar.querySelector('[data-slot="view-bar-facts"] [data-slot="freshness-stamp"]'),
    ).toBeNull()
  })

  it("counts no history among its facts: the History tab's footer does", () => {
    renderWithNav(detail({}))
    expect(screen.queryByText("History entries")).toBeNull()
    expect(screen.getByText("Occurred")).toBeTruthy()
  })
})
