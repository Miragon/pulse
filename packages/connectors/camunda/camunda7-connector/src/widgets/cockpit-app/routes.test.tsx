// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import {
  TestViewHost,
  createTestQueryClient,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"
import {
  CAMUNDA7_CLUSTER_DETAIL_DATA,
  CAMUNDA7_COCKPIT_OVERVIEW_DATA,
  CAMUNDA7_ENGINE_HEALTH_DATA,
  CAMUNDA7_HISTORY_TIMELINE_DATA,
  CAMUNDA7_INCIDENT_DETAIL_DATA,
  CAMUNDA7_INCIDENTS_DATA,
  CAMUNDA7_INSTANCE_DETAIL_DATA,
  CAMUNDA7_JOBS_DATA,
  CAMUNDA7_PROCESS_INCIDENTS_DATA,
  CAMUNDA7_PROCESS_INSTANCES_DATA,
} from "../../tool-names.js"
import type { CockpitStart, CockpitView } from "../../view-models.js"
import { CockpitRoute } from "./routes.js"

afterEach(() => {
  cleanup()
})

/** Every section and the feed its route reads, scoped to the cockpit's engine. */
const ROUTES: Array<[CockpitView, string, Record<string, unknown>]> = [
  [{ section: "overview" }, CAMUNDA7_ENGINE_HEALTH_DATA, {}],
  [{ section: "overview" }, CAMUNDA7_COCKPIT_OVERVIEW_DATA, {}],
  [{ section: "incidents" }, CAMUNDA7_INCIDENTS_DATA, {}],
  [
    { section: "cluster-detail", activityId: "charge", incidentType: "failedJob" },
    CAMUNDA7_CLUSTER_DETAIL_DATA,
    { activityId: "charge", incidentType: "failedJob" },
  ],
  [
    { section: "process-detail", processDefinitionKey: "invoice", focus: "incidents" },
    CAMUNDA7_PROCESS_INCIDENTS_DATA,
    { processDefinitionKey: "invoice" },
  ],
  [
    { section: "process-instances", processDefinitionKey: "invoice" },
    CAMUNDA7_PROCESS_INSTANCES_DATA,
    { processDefinitionKey: "invoice" },
  ],
  [
    { section: "instance-detail", processInstanceId: "pi-1" },
    CAMUNDA7_INSTANCE_DETAIL_DATA,
    { processInstanceId: "pi-1" },
  ],
  [{ section: "incident-detail", incidentId: "inc-1" }, CAMUNDA7_INCIDENT_DETAIL_DATA, {}],
  [{ section: "jobs", failedOnly: true }, CAMUNDA7_JOBS_DATA, { failedOnly: true }],
  [
    { section: "history", processInstanceId: "pi-1" },
    CAMUNDA7_HISTORY_TIMELINE_DATA,
    { processInstanceId: "pi-1" },
  ],
]

/** A route opened on its start data, the feed it would read, and the query namespace a write invalidates. */
const SEEDED: Array<[string, CockpitView, CockpitStart, string, string, string]> = [
  [
    "jobs",
    { section: "jobs", processDefinitionKey: "invoice", failedOnly: true },
    {
      view: { section: "jobs", processDefinitionKey: "invoice", failedOnly: true },
      data: {
        totalCount: 0,
        failedCount: 0,
        jobs: [],
        filters: { processDefinitionKey: "invoice", failedOnly: true },
        engineId: "prod-a",
      },
    },
    CAMUNDA7_JOBS_DATA,
    "camunda7:jobs",
    "Jobs",
  ],
  [
    "process-instances",
    { section: "process-instances", processDefinitionKey: "invoice" },
    {
      view: { section: "process-instances", processDefinitionKey: "invoice" },
      data: {
        processDefinitionKey: "invoice",
        processDefinitionName: "Invoice",
        totalCount: 0,
        returnedCount: 0,
        withIncidentCount: 0,
        suspendedCount: 0,
        instances: [],
        filters: {},
        engineId: "prod-a",
      },
    },
    CAMUNDA7_PROCESS_INSTANCES_DATA,
    "camunda7:process-instances",
    "Invoice",
  ],
  [
    "process-detail",
    { section: "process-detail", processDefinitionKey: "invoice", focus: "incidents" },
    {
      view: { section: "process-detail", processDefinitionKey: "invoice", focus: "incidents" },
      data: {
        processDefinitionKey: "invoice",
        processDefinitionName: "Invoice",
        diagramVersion: 2,
        diagramDefinitionId: null,
        cockpitUrl: null,
        runningInstances: 4,
        incidentCount: 0,
        last24hCount: 0,
        failedJobs: 0,
        totalActivityCount: 2,
        affectedDiagramActivityCount: 0,
        latestIncident: null,
        activities: [],
        siblingsWithIncidents: null,
        engineVendor: "CIB seven",
        engineId: "prod-a",
      },
    },
    CAMUNDA7_PROCESS_INCIDENTS_DATA,
    "camunda7:process-incidents",
    "Invoice",
  ],
]

describe("CockpitRoute", () => {
  it.each(ROUTES)("%o reads %s on the cockpit's engine", async (view, feed, args) => {
    const actions: HostAction[] = []
    // No fakes: every read fails, so only the calls the route makes count.
    render(
      <TestViewHost onHostAction={(action) => actions.push(action)}>
        <CockpitRoute view={view} engine="prod-a" />
      </TestViewHost>,
    )
    await waitFor(() =>
      expect(actions).toContainEqual({
        type: "callTool",
        name: feed,
        args: expect.objectContaining({ ...args, engine: "prod-a" }) as unknown,
      }),
    )
  })
})

describe("a seeded route", () => {
  it.each(SEEDED)(
    "%s reads no feed until invalidated",
    async (_name, view, seed, feed, namespace, shown) => {
      const actions: HostAction[] = []
      const client = createTestQueryClient()
      render(
        <TestViewHost onHostAction={(action) => actions.push(action)} client={client}>
          <CockpitRoute view={view} engine="prod-a" seed={seed} />
        </TestViewHost>,
      )
      expect((await screen.findAllByText(shown)).length).toBeGreaterThan(0)
      const reads = () => actions.filter((a) => a.type === "callTool" && a.name === feed)
      expect(reads()).toEqual([])
      await act(() => client.invalidateQueries({ queryKey: [namespace] }))
      await waitFor(() => expect(reads()).not.toEqual([]))
    },
  )

  it("ignores a seed of another route", async () => {
    const actions: HostAction[] = []
    render(
      <TestViewHost onHostAction={(action) => actions.push(action)}>
        <CockpitRoute view={{ section: "jobs" }} engine="prod-a" seed={SEEDED[1][2]} />
      </TestViewHost>,
    )
    await waitFor(() =>
      expect(actions).toContainEqual({
        type: "callTool",
        name: CAMUNDA7_JOBS_DATA,
        args: expect.objectContaining({ engine: "prod-a" }) as unknown,
      }),
    )
  })
})
