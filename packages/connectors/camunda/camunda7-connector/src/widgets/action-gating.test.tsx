// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { createElement, type ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CAMUNDA7_WIDGET_ACTIONS, CAMUNDA7_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type { JobPanelData } from "../view-models.js"
import { GATING_SITES } from "./action-gating.sites.js"
import { GATING_RENDERERS } from "./action-gating.test-support.js"
import { VariablesTable } from "./instance-sections.js"
import { JobPanelWidget } from "./job-panel.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

/** Wait for the feed, so an absent control is a decision. */
async function feedSettled() {
  await waitFor(() =>
    expect(
      queryClient.getQueryCache().find({ queryKey: ["camunda7-widget-actions"], exact: false })
        ?.state.status,
    ).toBe("success"),
  )
}

/** Every widget write offered. */
const EVERY_WRITE = [...CAMUNDA7_WIDGET_ACTIONS]

describe("every in-widget write renders its control only where it is allowed", () => {
  it.each(GATING_SITES)(
    "$site — shown when the deployment offers it",
    async ({ site, control }) => {
      render(GATING_RENDERERS[site](EVERY_WRITE, queryClient))
      expect(await screen.findByRole("button", { name: control })).toBeTruthy()
    },
  )

  it.each(GATING_SITES)(
    "$site — hidden (not disabled) when everything but it is offered",
    async ({ site, control, write }) => {
      render(
        GATING_RENDERERS[site](
          EVERY_WRITE.filter((offered) => offered !== write),
          queryClient,
        ),
      )
      await feedSettled()
      expect(screen.queryByRole("button", { name: control })).toBeNull()
    },
  )
})

const JOBS: JobPanelData = {
  totalCount: 1,
  failedCount: 1,
  jobs: [
    {
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
    },
  ],
  filters: {},
  engineId: "default",
}

/** What a read-only deployment's widget-actions feed answers: no write. */
let readOnlyFeed: { allowedActions: string[] }
beforeAll(async () => {
  readOnlyFeed = await widgetActionsFeedFor("read-only")
})

/** The jobs route on the fixture's engine. */
const JobPanel: ComponentType<Record<string, unknown>> = ({ data }) => (
  <JobPanelWidget data={data as JobPanelData} engine="default" />
)

const Variables: ComponentType<Record<string, unknown>> = () => (
  <VariablesTable
    variables={{ amount: { value: 42, type: "Integer" } }}
    instanceId="pi-1"
    engine="default"
  />
)

function renderWith(widget: ComponentType<Record<string, unknown>>, feed: unknown) {
  render(
    <TestViewHost tools={{ [CAMUNDA7_WIDGET_ACTIONS_DATA]: feed }} client={queryClient}>
      {createElement(widget, widget === JobPanel ? { data: JOBS } : {})}
    </TestViewHost>,
  )
}

describe("the gate fails closed and hides only the write", () => {
  it("hides the job retry button in read-only but keeps the AI handoffs", async () => {
    renderWith(JobPanel, readOnlyFeed)
    await feedSettled()
    expect(screen.queryByText("Retry job")).toBeNull()
    // The hand-offs wait behind the row's "more" button (#322 U11).
    fireEvent.click(screen.getByRole("button", { name: "More actions for the job at chargeCard" }))
    expect(screen.getByRole("menuitem", { name: "Explain error in chat" })).toBeTruthy()
  })

  it("fails closed while the feed has not answered", () => {
    renderWith(JobPanel, () => new Promise(() => {}))
    expect(screen.getByText("Card declined")).toBeTruthy()
    expect(screen.queryByText("Retry job")).toBeNull()
  })

  it("drops the variable edit column (not just the button) in read-only", async () => {
    renderWith(Variables, { allowedActions: ["camunda7_set_process_instance_variable"] })
    expect(await screen.findByText("Edit")).toBeTruthy()
    expect(screen.getAllByRole("columnheader")).toHaveLength(4)
    cleanup()
    queryClient = createTestQueryClient()

    renderWith(Variables, { allowedActions: [] })
    await feedSettled()
    expect(screen.queryByText("Edit")).toBeNull()
    expect(screen.getAllByRole("columnheader")).toHaveLength(3)
  })
})
