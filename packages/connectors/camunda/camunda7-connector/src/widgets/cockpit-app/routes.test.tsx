// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { TestViewHost, type HostAction } from "@miragon/pulse-widget-shell/widgets"
import {
  CAMUNDA7_CLUSTER_DETAIL_DATA,
  CAMUNDA7_COCKPIT_OVERVIEW_DATA,
  CAMUNDA7_ENGINE_HEALTH_DATA,
  CAMUNDA7_INCIDENT_DETAIL_DATA,
  CAMUNDA7_INCIDENTS_DATA,
  CAMUNDA7_INSTANCE_DETAIL_DATA,
  CAMUNDA7_PROCESS_INCIDENTS_DATA,
  CAMUNDA7_PROCESS_INSTANCES_DATA,
  CAMUNDA7_PROCESS_LIST_DATA,
} from "../../tool-names.js"
import type { CockpitView } from "../nav-core.js"
import { CockpitRoute } from "./routes.js"

afterEach(() => {
  cleanup()
})

/** Every section and the feed its route reads, scoped to the cockpit's engine. */
const ROUTES: Array<[CockpitView, string, Record<string, unknown>]> = [
  [{ section: "overview" }, CAMUNDA7_ENGINE_HEALTH_DATA, {}],
  [{ section: "overview" }, CAMUNDA7_COCKPIT_OVERVIEW_DATA, {}],
  [{ section: "process-list" }, CAMUNDA7_PROCESS_LIST_DATA, {}],
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

  // #346: engine scope is irrelevant to per-user preferences.
  it("renders the shell's settings page with every module's section", async () => {
    render(
      <TestViewHost hostWidgets={{ "acme:settings": () => <p>acme-section</p> }}>
        <CockpitRoute view={{ section: "settings" }} engine="prod-a" />
      </TestViewHost>,
    )
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy()
    expect(await screen.findByText("acme-section")).toBeTruthy()
  })
})
