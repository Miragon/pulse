import { afterEach, beforeAll, expect } from "vitest"
import { createElement, type ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ENGINE_INSTANCE_DETAIL_DATA, ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type { IncidentInstance, InstanceDetailData, OpenUserTask } from "../view-models.js"
import { InstanceDetailWidget } from "./instance-detail.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"
import {
  TestViewHost,
  createTestQueryClient,
  createViewQueryClient,
} from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test, so a failing feed answers at once.
let queryClient = createTestQueryClient()

let admin: { allowedActions: string[] }

export const adminActions = () => admin

export function installWritePathHarness(): void {
  beforeAll(async () => {
    admin = await widgetActionsFeedFor("admin")
  })
  afterEach(() => {
    cleanup()
    queryClient = createTestQueryClient()
  })
}

// The view's production client: 3 retries with 1/2/4 s backoff, `error` null all that time (only `failureReason`).
export function withProductionRetries() {
  queryClient = createViewQueryClient()
}

export function task(id: string, name: string): OpenUserTask {
  return {
    id,
    name,
    assignee: null,
    created: "2026-10-10T08:00:00.000+0000",
    due: null,
    priority: 50,
    processDefinitionId: "invoice:1:abc",
    processInstanceId: "pi-1",
    taskDefinitionKey: id,
    description: null,
    formSchema: { taskId: id, fields: [] },
  }
}

export function instance(over: Partial<InstanceDetailData> = {}): InstanceDetailData {
  return {
    instance: {
      id: "pi-1",
      definitionId: "invoice:1:abc",
      businessKey: "INV-7",
      suspended: false,
      ended: false,
    },
    processDefinitionName: null,
    definitionKey: "invoice",
    activityTree: null,
    variables: { amount: { value: 42, type: "Integer" } },
    incidents: [],
    incidentCount: 0,
    diagramDefinitionId: null,
    activeActivityIds: ["review"],
    incidentActivityIds: [],
    openTasks: [task("review", "Review invoice")],
    openTaskCount: 1,
    engineId: "prod",
    ...over,
  }
}

export const FAILED_JOB_INCIDENT: IncidentInstance = {
  id: "inc-1",
  processInstanceId: "pi-1",
  incidentType: "failedJob",
  incidentMessage: "Card declined",
  incidentTimestamp: "2026-10-10T08:00:00.000+0000",
  activityId: "charge",
  activityName: "Charge card",
  cockpitInstanceUrl: null,
  businessKey: null,
  recovery: { action: "retry-job", jobId: "job-1" },
}

export type Calls = Array<[string, Record<string, unknown>]>

export function recorder(
  calls: Calls,
  name: string,
  answer: (args: Record<string, unknown>) => unknown,
) {
  return {
    [name]: (args: Record<string, unknown>) => {
      calls.push([name, args])
      return answer(args)
    },
  }
}

/** The instance view opened on its start data, as `engine_open_cockpit` seeds it. */
export const Seeded: ComponentType<Record<string, unknown>> = ({ data }) => (
  <InstanceDetailWidget data={data as InstanceDetailData} processInstanceId="pi-1" engine="prod" />
)
export const InCockpit: ComponentType<Record<string, unknown>> = () => (
  <InstanceDetailWidget processInstanceId="pi-1" engine="prod" />
)

export function renderInstance(
  widget: ComponentType<Record<string, unknown>>,
  data: InstanceDetailData | null,
  tools: Record<string, unknown>,
  onModelContext?: (text: string) => void,
) {
  return render(
    <TestViewHost
      tools={{ [ENGINE_WIDGET_ACTIONS_DATA]: admin, ...tools }}
      onModelContext={onModelContext}
      client={queryClient}
    >
      {createElement(widget, data ? { data } : {})}
    </TestViewHost>,
  )
}

export async function completeTheOpenTask() {
  fireEvent.click(await screen.findByRole("button", { name: "Complete" }))
  fireEvent.click(await screen.findByRole("button", { name: "Complete task" }))
}

export const feedCalls = (calls: Calls) =>
  calls.filter(([name]) => name === ENGINE_INSTANCE_DETAIL_DATA)

/** Radix tabs switch on mouse-down (and focus), not on click. */
export function openTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }))
}

export async function confirmIn(dialogButton: string) {
  const dialog = await screen.findByRole("alertdialog")
  fireEvent.click(within(dialog).getByRole("button", { name: dialogButton }))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
}
