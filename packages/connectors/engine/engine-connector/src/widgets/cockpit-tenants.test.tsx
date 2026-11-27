// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import type {
  ClusterDetailData,
  CockpitDashboardData,
  CockpitView,
  IncidentsDashboardData,
  IncidentsDashboardProcess,
  ProcessIncidentsData,
} from "../view-models.js"
import { ClusterDetailWidget } from "./cluster-detail.js"
import { IncidentProcessList } from "./incidents-dashboard/process-list.js"
import { ProcessDefinitionsTable } from "./cockpit-dashboard/definitions-table.js"
import { cockpitReducer, type CockpitState, keptProcesses } from "./cockpit-app/cockpit-state.js"
import { cockpitContext } from "./cockpit-app/model-context.js"
import { crumbLabel, intentToView, selectedEntity, viewKey } from "./nav-core.js"
import { NavProvider, type NavIntent } from "./navigation.js"
import { ProcessDetailHeader } from "./process-incidents/header.js"
import { ProcessDefinitionKpi } from "./process-incidents/kpi.js"
import { ActivityIncidentList } from "./process-incidents/list.js"

// F17b: the chat cockpit's process is a key in one tenant. A key in two tenants is two rows of the
// overview, each opening its own process; the process view names its tenant and opens the lists of
// its runs in it (null: the process without one) where its key holds other processes, by its key
// alone where it is the key's only one, as its counts count, and its siblings in theirs.

afterEach(cleanup)

type ProcessView = Extract<CockpitView, { section: "process-detail" }>

const row = (tenantId: string | undefined, instances: number, sharesKey = true) => ({
  id: `label:1:${tenantId ?? "none"}`,
  key: "label",
  ...(tenantId === undefined ? {} : { tenantId }),
  ...(sharesKey ? { sharesKey: true as const } : {}),
  name: "Label",
  latestVersion: 1,
  instances,
  failedJobs: 0,
  incidents: [],
})

const OVERVIEW: CockpitDashboardData = {
  summary: { totalDefinitions: 2, totalRunningInstances: 3, totalFailedJobs: 0, totalIncidents: 0 },
  definitions: [row("north", 2), row(undefined, 1)],
  engineId: "prod",
}

function rendered(children: React.ReactNode, locale?: string) {
  const go = vi.fn<(intent: NavIntent) => void>()
  render(
    <TestViewHost {...(locale ? { locale } : {})}>
      <NavProvider value={go}>{children}</NavProvider>
    </TestViewHost>,
  )
  return () => go.mock.calls.map(([intent]) => intent)
}

describe("the overview's processes: a row per key and tenant", () => {
  it("names each row's tenant and opens its own process and instances", () => {
    const intents = rendered(<ProcessDefinitionsTable data={OVERVIEW} engine="prod" />)
    expect(screen.getByRole("columnheader", { name: "Tenant" })).toBeTruthy()
    const north = screen.getByRole("row", { name: "Process Label of tenant north" })
    fireEvent.keyDown(north, { key: "Enter" })
    fireEvent.click(within(north).getByRole("button", { name: /^View running instances/ }))
    const none = screen.getByRole("row", { name: "Process Label" })
    fireEvent.keyDown(none, { key: "Enter" })
    fireEvent.click(within(none).getByRole("button", { name: /^View running instances/ }))
    expect(intents()).toEqual([
      { type: "process-detail", processDefinitionKey: "label", tenantId: "north", label: "Label" },
      { type: "process-instances", processDefinitionKey: "label", onlyTenant: "north" },
      { type: "process-detail", processDefinitionKey: "label", label: "Label" },
      { type: "process-instances", processDefinitionKey: "label", onlyTenant: null },
    ])
  })

  it("opens the instances of a key's only process by its key alone, as the row counts them", () => {
    const alone = { ...OVERVIEW, definitions: [row(undefined, 1, false)] }
    const intents = rendered(<ProcessDefinitionsTable data={alone} engine="prod" />)
    const only = screen.getByRole("row", { name: "Process Label" })
    fireEvent.click(within(only).getByRole("button", { name: /^View running instances/ }))
    expect(intents()).toEqual([{ type: "process-instances", processDefinitionKey: "label" }])
  })

  it("says Mandant in German, and no tenant column where no row has one", () => {
    rendered(<ProcessDefinitionsTable data={OVERVIEW} engine="prod" />, "de")
    expect(screen.getByRole("columnheader", { name: "Mandant" })).toBeTruthy()
    expect(screen.getByRole("row", { name: "Prozess Label des Mandanten north" })).toBeTruthy()
    cleanup()
    rendered(
      <ProcessDefinitionsTable
        data={{ ...OVERVIEW, definitions: [row(undefined, 1)] }}
        engine="prod"
      />,
    )
    expect(screen.queryByRole("columnheader", { name: "Tenant" })).toBeNull()
  })
})

const PROCESS: ProcessIncidentsData = {
  processDefinitionKey: "label",
  tenantId: "south",
  sharesKey: true,
  processDefinitionName: "Label",
  diagramVersion: 2,
  diagramDefinitionId: null,
  cockpitUrl: null,
  runningInstances: 7,
  incidentCount: 0,
  failedJobs: 1,
  totalActivityCount: 1,
  affectedDiagramActivityCount: 0,
  latestIncident: null,
  activities: [],
  siblingsWithIncidents: [
    {
      processDefinitionKey: "label",
      tenantId: "north",
      processDefinitionName: "Label",
      incidentCount: 1,
    },
  ],
  engineVendor: "CIB seven",
  engineId: "prod",
}

const scope = { processDefinitionKey: "label", tenantId: "south", engine: "prod" }

describe("the process view: one process in its tenant", () => {
  it("names its tenant in the bar and opens its instances and jobs in it", () => {
    const intents = rendered(
      <>
        <ProcessDetailHeader data={PROCESS} {...scope} />
        <ProcessDefinitionKpi data={PROCESS} {...scope} />
      </>,
    )
    expect(screen.getByText("Tenant south")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /View running instances/ }))
    fireEvent.click(screen.getByText("Jobs without retries").closest("button")!)
    expect(intents()).toEqual([
      { type: "process-instances", processDefinitionKey: "label", onlyTenant: "south" },
      { type: "jobs", processDefinitionKey: "label", onlyTenant: "south", failedOnly: true },
    ])
  })

  it("opens the lists of its key's only process by its key alone, as its tiles count them", () => {
    const alone: ProcessIncidentsData = { ...PROCESS, tenantId: undefined, sharesKey: undefined }
    const intents = rendered(<ProcessDefinitionKpi data={alone} {...scope} />)
    fireEvent.click(screen.getByText("Running").closest("button")!)
    fireEvent.click(screen.getByText("Jobs without retries").closest("button")!)
    expect(intents()).toEqual([
      { type: "process-instances", processDefinitionKey: "label" },
      { type: "jobs", processDefinitionKey: "label", failedOnly: true },
    ])
  })

  it("opens the lists of the process without a tenant in none, and a sibling in its tenant", () => {
    const none: ProcessIncidentsData = { ...PROCESS, tenantId: undefined }
    const intents = rendered(
      <>
        <ProcessDetailHeader data={none} processDefinitionKey="label" engine="prod" />
        <ActivityIncidentList
          data={none}
          processDefinitionKey="label"
          engine="prod"
          emptyVariant="siblings"
        />
      </>,
    )
    expect(screen.queryByText(/^Tenant/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /View running instances/ }))
    fireEvent.click(screen.getByRole("button", { name: /Label · Tenant north/ }))
    expect(intents()).toEqual([
      { type: "process-instances", processDefinitionKey: "label", onlyTenant: null },
      {
        type: "process-incidents",
        processDefinitionKey: "label",
        tenantId: "north",
        label: "Label",
      },
    ])
  })
})

describe("an engine switch keeps a process in its tenant", () => {
  const booted = (): CockpitState => {
    const empty = cockpitReducer({} as CockpitState, { type: "boot", engineId: null, view: null })
    return cockpitReducer(empty, {
      type: "boot",
      engineId: "prod-a",
      view: { section: "process-detail", processDefinitionKey: "label", tenantId: "south" },
    })
  }

  it("asks for the process in its tenant, and says it is gone where only another tenant has it", () => {
    const switched = cockpitReducer(
      cockpitReducer(booted(), { type: "jobs", processDefinitionKey: "label", onlyTenant: null }),
      { type: "switch-engine", id: "prod-b" },
    )
    expect(keptProcesses(switched.stack)).toEqual([
      { key: "label", tenantId: "south" },
      { key: "label", tenantId: null },
    ])
    const north = { key: "label", tenantId: "north" }
    expect(
      cockpitReducer(switched, { type: "process-gone", engineId: "prod-b", process: north }),
    ).toBe(switched)
    const gone = cockpitReducer(switched, {
      type: "process-gone",
      engineId: "prod-b",
      process: { key: "label", tenantId: "south" },
    })
    expect(gone.processGone).toEqual({ engineId: "prod-b", process: "label" })
  })
})

describe("a process view's identity and crumb are its key and tenant", () => {
  it("keys two tenants of a key apart, and a key without one as before", () => {
    const south: ProcessView = {
      section: "process-detail",
      processDefinitionKey: "label",
      tenantId: "south",
    }
    expect(
      intentToView({ type: "process-detail", processDefinitionKey: "label", tenantId: "south" }),
    ).toEqual(south)
    const north = { ...south, tenantId: "north" }
    const key = intentToView({ type: "process-detail", processDefinitionKey: "label" })
    expect(viewKey(key)).toBe("process-detail:label")
    expect(new Set([viewKey(south), viewKey(north), viewKey(key)]).size).toBe(3)
    const lists = [null, "south", undefined].map((onlyTenant) =>
      viewKey({
        section: "jobs",
        processDefinitionKey: "label",
        ...(onlyTenant === undefined ? {} : { onlyTenant }),
      }),
    )
    expect(new Set(lists).size).toBe(3)
    expect(crumbLabel({ ...south, label: "Label" }, "en")).toBe("Label · Tenant south")
    expect(crumbLabel(south, "de")).toBe("label · Mandant south")
    expect(crumbLabel(key, "en")).toBe("label")
    expect(selectedEntity(south)).toEqual({ processDefinitionKey: "label", tenantId: "south" })
  })

  it("tells the model a list's narrowing to a tenant, to none too", () => {
    const list = (onlyTenant: string | null): CockpitView => ({
      section: "process-instances",
      processDefinitionKey: "label",
      onlyTenant,
    })
    expect(selectedEntity(list(null))).toEqual({ processDefinitionKey: "label", onlyTenant: null })
    expect(cockpitContext("prod", list(null)).facts).toEqual({
      view: "process-instances",
      withoutTenantId: true,
    })
    expect(cockpitContext("prod", list("north")).ids).toMatchObject({ onlyTenant: "north" })
  })
})

describe("a cluster and an incidents card open their process in its tenant", () => {
  const CLUSTER = {
    activityId: "work",
    activityName: "Work",
    incidentType: "failedJob",
    messageSignature: null,
    incidentCount: 2,
    scannedIncidentCount: 2,
    lastHourCount: 2,
    firstSeen: null,
    latestIncident: null,
    processDefinitionKeys: ["label"],
    process: { processDefinitionKey: "label", tenantId: "south" },
    representativeMessage: "south failed",
    incidents: [],
    totalMatching: 0,
    fetchedAt: "2026-11-27T08:00:00.000Z",
    engineId: "prod",
  } satisfies ClusterDetailData

  it("opens the process a cluster lies in, in its versions' tenant, and none for two", () => {
    const route = { activityId: "work", incidentType: "failedJob", engine: "prod" }
    const intents = rendered(<ClusterDetailWidget data={CLUSTER} {...route} />)
    fireEvent.click(screen.getByRole("button", { name: "View process" }))
    expect(intents()).toEqual([
      { type: "process-detail", processDefinitionKey: "label", tenantId: "south" },
    ])
    cleanup()
    rendered(<ClusterDetailWidget data={{ ...CLUSTER, process: null }} {...route} />)
    expect(screen.queryByRole("button", { name: "View process" })).toBeNull()
  })

  const card = (tenantId: string | undefined, incidentCount: number) =>
    ({
      processDefinitionKey: "label",
      ...(tenantId === undefined ? {} : { tenantId }),
      processDefinitionName: "Label",
      latestVersion: 1,
      runningInstances: 1,
      incidentCount,
      scannedIncidentCount: incidentCount,
      affectedActivityCount: 1,
      latestIncident: null,
      cockpitUrl: null,
      activities: [],
    }) satisfies IncidentsDashboardProcess
  const INCIDENTS: IncidentsDashboardData = {
    totalCount: 3,
    processCount: 2,
    affectedActivityCount: 2,
    latestIncident: null,
    processes: [card("south", 2), card(undefined, 1)],
    filters: {},
    fetchedAt: "2026-11-27T08:00:00.000Z",
    engineVendor: "CIB seven",
    engineId: "prod",
  }

  it("cards a key's processes apart, the tenant named, each opening its own", () => {
    const intents = rendered(<IncidentProcessList data={INCIDENTS} engine="prod" />, "de")
    expect(screen.getByText("Mandant south")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Label · Mandant south öffnen" }))
    fireEvent.click(screen.getByRole("button", { name: "Label öffnen" }))
    expect(intents()).toEqual([
      {
        type: "process-incidents",
        processDefinitionKey: "label",
        tenantId: "south",
        label: "Label",
      },
      { type: "process-incidents", processDefinitionKey: "label", label: "Label" },
    ])
  })
})
