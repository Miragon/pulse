// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import {
  CAMUNDA7_COCKPIT_OVERVIEW_DATA,
  CAMUNDA7_ENGINE_HEALTH_DATA,
  CAMUNDA7_INSTANCE_DETAIL_DATA,
  CAMUNDA7_JOBS_DATA,
  CAMUNDA7_LIST_ENGINES,
  CAMUNDA7_WIDGET_ACTIONS_DATA,
} from "../tool-names.js"
import type { JobPanelData } from "../view-models.js"
import { CockpitApp } from "./cockpit-app/app.js"
import { JobPanelWidget } from "./job-panel.js"
import {
  InCockpit,
  Standalone,
  adminActions,
  completeTheOpenTask,
  feedCalls,
  installWritePathHarness,
  instance,
  recorder,
  renderInstance,
  task,
  withProductionRetries,
  type Calls,
} from "./write-path.test-support.js"

// #341. Current-state gating lives in `write-state.test.tsx`, refresh completeness in `write-refresh.test.tsx`.

installWritePathHarness()

const AFTER_REVIEW = instance({
  activeActivityIds: ["approve"],
  openTasks: [task("approve", "Approve invoice")],
  variables: { amount: { value: 42, type: "Integer" }, reviewed: { value: true, type: "Boolean" } },
})

describe("completing a user task refreshes the instance (N99)", () => {
  it("standalone: the tool result is a seed — the view refetches and shows the next task", async () => {
    const calls: Calls = []
    renderInstance(Standalone, instance(), {
      ...recorder(calls, "camunda7_complete_task", () => ({ success: true, outcome: "completed" })),
      ...recorder(calls, CAMUNDA7_INSTANCE_DETAIL_DATA, () => AFTER_REVIEW),
    })
    expect(await screen.findByText("Review invoice")).toBeTruthy()
    // The show tool just read the seed.
    expect(feedCalls(calls)).toHaveLength(0)

    await completeTheOpenTask()

    expect(await screen.findByText("Approve invoice")).toBeTruthy()
    expect(screen.queryByText("Review invoice")).toBeNull()
    // The refetch is scoped to the engine and instance the seed came from.
    expect(feedCalls(calls)).toEqual([
      [CAMUNDA7_INSTANCE_DETAIL_DATA, { processInstanceId: "pi-1", engine: "prod" }],
    ])
    expect(calls[0]).toEqual([
      "camunda7_complete_task",
      { taskId: "review", variables: {}, engine: "prod" },
    ])
  })

  it("cockpit: the self-fetched instance refetches after the completion", async () => {
    const calls: Calls = []
    let current = instance()
    renderInstance(InCockpit, null, {
      ...recorder(calls, "camunda7_complete_task", () => {
        current = AFTER_REVIEW
        return { success: true, outcome: "completed" }
      }),
      ...recorder(calls, CAMUNDA7_INSTANCE_DETAIL_DATA, () => current),
    })
    expect(await screen.findByText("Review invoice")).toBeTruthy()

    await completeTheOpenTask()

    expect(await screen.findByText("Approve invoice")).toBeTruthy()
    expect(feedCalls(calls)).toHaveLength(2)
  })

  it("offers no Suspend/Cancel from the refetch's FIRST failure on — not after the client's retries", async () => {
    // The runtime read is a 404 now; the stale snapshot must not offer actions, not even during the
    // ~7 s of production retries.
    withProductionRetries()
    const calls: Calls = []
    const contexts: string[] = []
    renderInstance(
      Standalone,
      instance(),
      {
        camunda7_complete_task: () => ({ success: true, outcome: "completed" }),
        ...recorder(calls, CAMUNDA7_INSTANCE_DETAIL_DATA, () => {
          throw new Error("Process instance with id pi-1 does not exist")
        }),
      },
      (text) => contexts.push(text),
    )
    expect(await screen.findByRole("button", { name: "Suspend" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Cancel instance" })).toBeTruthy()
    await waitFor(() => expect(contexts.at(-1)).toContain('state="running"'))

    await completeTheOpenTask()

    expect(await screen.findByText(/pi-1 does not exist/)).toBeTruthy()
    // One attempt so far: the client is still retrying, the gate is closed already.
    expect(feedCalls(calls)).toHaveLength(1)
    // The model is not told the instance still runs.
    await waitFor(() => expect(contexts.at(-1)).toContain('state="unconfirmed"'))
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Cancel instance" })).toBeNull()
    // The way out of the stale state: retry the read.
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })
})

describe("a confirmation names its target (N108)", () => {
  it("cancel: names instance, business key and engine; Keep instance vs Cancel instance", async () => {
    const calls: Calls = []
    renderInstance(Standalone, instance(), {
      ...recorder(calls, "camunda7_delete_process_instance", () => ({ success: true })),
    })
    fireEvent.click(await screen.findByRole("button", { name: "Cancel instance" }))

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("pi-1")).toBeTruthy()
    expect(within(dialog).getByText("INV-7")).toBeTruthy()
    expect(within(dialog).getByText("prod")).toBeTruthy()
    const buttons = within(dialog)
      .getAllByRole("button")
      .map((b) => b.textContent)
    expect(buttons).toContain("Keep instance")
    expect(buttons).toContain("Cancel instance")
    // Never a bare "Cancel" next to "Cancel instance".
    expect(buttons).not.toContain("Cancel")

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep instance" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(calls).toHaveLength(0)
  })

  it("suspend: names the instance; Keep running vs Suspend instance", async () => {
    const calls: Calls = []
    renderInstance(Standalone, instance(), {
      ...recorder(calls, "camunda7_set_process_instance_suspension", () => ({ success: true })),
      [CAMUNDA7_INSTANCE_DETAIL_DATA]: () => instance(),
    })
    fireEvent.click(await screen.findByRole("button", { name: "Suspend" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("pi-1")).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Keep running" })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend instance" }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual([
      "camunda7_set_process_instance_suspension",
      { processInstanceId: "pi-1", suspended: true, engine: "prod" },
    ])
  })

  it("resolve: names the incident and its instance; Keep open vs Mark as resolved", async () => {
    const calls: Calls = []
    const withIncident = instance({
      incidents: [
        {
          id: "inc-9",
          processInstanceId: "pi-1",
          incidentType: "invoiceMismatch",
          incidentMessage: "amount mismatch",
          incidentTimestamp: "2026-10-10T08:00:00.000+0000",
          cockpitInstanceUrl: null,
          businessKey: null,
          recovery: { action: "resolve" },
        },
      ],
      incidentCount: 1,
      openTasks: [],
      openTaskCount: 0,
    })
    renderInstance(Standalone, withIncident, {
      ...recorder(calls, "camunda7_resolve_incident", () => ({ success: true })),
    })
    fireEvent.click(await screen.findByRole("button", { name: "Mark as resolved" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("inc-9")).toBeTruthy()
    expect(within(dialog).getByText("invoiceMismatch")).toBeTruthy()
    expect(within(dialog).getByText("pi-1")).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Keep open" })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as resolved" }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual(["camunda7_resolve_incident", { incidentId: "inc-9", engine: "prod" }])
  })
})

describe("the cockpit refreshes and retries instead of dead-ending (N103)", () => {
  it("an instance that failed to load offers a Retry", async () => {
    let fail = true
    renderInstance(InCockpit, null, {
      [CAMUNDA7_INSTANCE_DETAIL_DATA]: () => {
        if (fail) throw new Error("engine timeout")
        return instance()
      },
    })
    expect(await screen.findByText("engine timeout")).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("Review invoice")).toBeTruthy()
  })

  it("the cockpit's Refresh re-reads the open view's feed", async () => {
    const overviewCalls: unknown[] = []
    const Cockpit: ComponentType<Record<string, unknown>> = () => (
      <CockpitApp data={{ engineId: "prod", engines: [{ id: "prod", environment: "default" }] }} />
    )
    render(
      <WidgetFixtureHost
        widget={Cockpit}
        data={{}}
        tools={{
          [CAMUNDA7_LIST_ENGINES]: { engines: [{ id: "prod" }], defaultEngineId: null },
          [CAMUNDA7_ENGINE_HEALTH_DATA]: (args: Record<string, unknown>) => {
            overviewCalls.push(args)
            throw new Error("not under test")
          },
          [CAMUNDA7_COCKPIT_OVERVIEW_DATA]: (args: Record<string, unknown>) => {
            overviewCalls.push(args)
            return {
              summary: {
                totalDefinitions: 0,
                totalRunningInstances: 0,
                totalFailedJobs: 0,
                totalIncidents: 0,
              },
              definitions: [],
              engineId: "prod",
            }
          },
        }}
      />,
    )
    const refresh = await screen.findByRole("button", { name: "Refresh" })
    await waitFor(() => expect(overviewCalls.length).toBeGreaterThan(0))
    const before = overviewCalls.length
    fireEvent.click(refresh)
    await waitFor(() => expect(overviewCalls.length).toBeGreaterThan(before))
  })
})

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

describe("a standalone show view refreshes after a write (K46)", () => {
  it("job panel: Retry refetches the seeded page — the retried job leaves the failed-only list", async () => {
    const calls: Calls = []
    const AFTER_RETRY: JobPanelData = { ...JOBS, totalCount: 0, failedCount: 0, jobs: [] }
    render(
      <WidgetFixtureHost
        widget={JobPanelWidget as unknown as ComponentType<Record<string, unknown>>}
        data={JOBS as unknown as Record<string, unknown>}
        tools={{
          [CAMUNDA7_WIDGET_ACTIONS_DATA]: adminActions(),
          ...recorder(calls, "camunda7_set_job_retries", () => ({ success: true })),
          ...recorder(calls, CAMUNDA7_JOBS_DATA, () => AFTER_RETRY),
        }}
      />,
    )
    fireEvent.click(await screen.findByRole("button", { name: "Retry job" }))

    expect(await screen.findByText("No jobs in this selection.")).toBeTruthy()
    expect(calls.map(([name]) => name)).toEqual(["camunda7_set_job_retries", CAMUNDA7_JOBS_DATA])
    expect(calls[1][1]).toMatchObject({ engine: "prod", failedOnly: true, firstResult: 0 })
  })
})
