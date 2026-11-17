// @vitest-environment happy-dom
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import {
  mountPage,
  type FollowUp,
  type ToolCaller,
  type ToolResult,
} from "@miragon/pulse-widget-shell/widgets"
import {
  ENGINE_INCIDENTS_DATA,
  ENGINE_LIST_ENGINES,
  ENGINE_OPEN_COCKPIT,
  ENGINE_WIDGET_ACTIONS,
  ENGINE_WIDGET_ACTIONS_DATA,
} from "../tool-names.js"
import type {
  CockpitAppData,
  CockpitStart,
  IncidentsDashboardData,
  IncidentsDashboardProcess,
  JobPanelData,
} from "../view-models.js"
import { cockpitAfterFailedStart } from "./cockpit-app/failed-start.js"
import { engineViews } from "./views.js"

/**
 * The cockpit on a page outside a chat (the web app's root): widget-shell's browser adapter
 * instead of ext-apps, the view tool and every feed called through the caller the page hands in.
 * The widgets are the chat's, unchanged; only what a hand-off does follows the page.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DASHBOARD: IncidentsDashboardData = {
  totalCount: 3,
  processCount: 1,
  affectedActivityCount: 1,
  last24hCount: 1,
  latestIncident: null,
  processes: [],
  filters: {},
  engineVendor: "CIB seven",
  engineId: "prod-a",
}

/** A process whose engine has no web app to link: its menu holds the hand-off alone. */
const PROCESS: IncidentsDashboardProcess = {
  processDefinitionKey: "invoice",
  processDefinitionName: "Invoice Receipt",
  latestVersion: 1,
  runningInstances: 4,
  incidentCount: 3,
  scannedIncidentCount: 3,
  affectedActivityCount: 1,
  last24hCount: 1,
  latestIncident: null,
  cockpitUrl: null,
  activities: [],
}

/** A job without retries: its row's menu holds hand-offs only. */
const JOBS: JobPanelData = {
  totalCount: 1,
  failedCount: 1,
  jobs: [
    {
      id: "job-1",
      processInstanceId: "pi-1",
      processDefinitionKey: "invoice",
      processDefinitionId: "invoice:1:abc",
      processDefinitionName: "Invoice Receipt",
      activityId: "Activity_ChargeCard",
      activityName: "Charge card",
      retries: 0,
      exceptionMessage: "Card declined",
      dueDate: null,
      suspended: false,
      priority: 0,
      createTime: "2026-06-11T08:00:00.000Z",
    },
  ],
  filters: {},
  engineId: "prod-a",
}

const cockpitData = (start: CockpitStart): CockpitAppData => ({
  engineId: "prod-a",
  engines: [{ id: "prod-a", environment: "default" }],
  start,
})

/** The server as the page reaches it: the cockpit's view tool; every other tool is unknown. */
function serverFor(start: CockpitStart) {
  return vi.fn<ToolCaller>((name) => {
    if (name !== ENGINE_OPEN_COCKPIT) return Promise.reject(new Error(`Unknown tool: ${name}`))
    const result: ToolResult = {
      structuredContent: cockpitData(start),
      content: [{ type: "text", text: "{}" }],
    }
    return Promise.resolve(result)
  })
}

let unmount: (() => void) | undefined

async function openCockpit(
  callTool: ToolCaller,
  followUp?: Exclude<FollowUp, "chat">,
  view: CockpitStart["view"]["section"] = "incidents",
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    unmount = mountPage(engineViews, {
      view: ENGINE_OPEN_COCKPIT,
      args: { engine: "prod-a", view },
      callTool,
      followUp,
      locale: "en",
      container,
    })
  })
  return container
}

afterEach(async () => {
  await act(async () => unmount?.())
  unmount = undefined
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("the cockpit on a page whose start failed for its engine", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps its head over the route, which says the engine's failure in its place", async () => {
    // The page's query client retries a read that may answer next time: the clock waits it out.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    const down = "[503 ProcessEngineException] Engine is shutting down (engine down)"
    const callTool = vi.fn<ToolCaller>((name) => {
      if (name === ENGINE_OPEN_COCKPIT) {
        return Promise.resolve({ isError: true, content: [{ type: "text", text: down }] })
      }
      if (name === ENGINE_LIST_ENGINES) {
        return Promise.resolve({
          structuredContent: {
            engines: [{ id: "prod-a" }, { id: "down" }],
            environments: [],
            defaultEngineId: "prod-a",
          },
          content: [{ type: "text", text: "{}" }],
        })
      }
      return Promise.reject(new Error(down))
    })
    const args = { engine: "down", view: "incidents" }
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      unmount = mountPage(engineViews, {
        view: ENGINE_OPEN_COCKPIT,
        args,
        callTool,
        locale: "en",
        container,
        failedStart: (error) => cockpitAfterFailedStart(args, error),
      })
    })
    for (let step = 0; step < 6; step++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
    }
    expect(screen.getByRole("navigation", { name: "Cockpit sections" })).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Engine down is unreachable (HTTP 503)" }),
    ).toBeTruthy()
    // The route read the engine itself, with the page's view.
    expect(callTool.mock.calls.map(([name, called]) => [name, called.engine])).toContainEqual([
      ENGINE_INCIDENTS_DATA,
      "down",
    ])
  })
})

describe("the cockpit on a page (mountPage)", () => {
  it("opens on the start route the page asked for, from the view tool's data", async () => {
    const callTool = serverFor({ view: { section: "incidents" }, data: DASHBOARD })
    await openCockpit(callTool)
    expect(await screen.findByRole("heading", { name: "prod-a · Incidents" })).toBeTruthy()
    expect(callTool).toHaveBeenCalledWith(ENGINE_OPEN_COCKPIT, {
      engine: "prod-a",
      view: "incidents",
    })
    // The start data seeds its feed: the page reads nothing twice.
    expect(callTool.mock.calls.filter(([name]) => name === ENGINE_INCIDENTS_DATA)).toEqual([])
    // A page owns its viewport: nothing to switch to.
    expect(screen.queryByRole("button", { name: /fullscreen/i })).toBeNull()
  })

  it("hides the chat hand-offs on a page that posts to no chat", async () => {
    await openCockpit(serverFor({ view: { section: "incidents" }, data: DASHBOARD }))
    await screen.findByRole("heading", { name: "prod-a · Incidents" })
    expect(screen.queryByRole("button", { name: "Assess in chat" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Copy prompt/ })).toBeNull()
  })

  it("shows no menu or column that would hold hand-offs only on a page that posts to no chat", async () => {
    const incidents = { ...DASHBOARD, processes: [PROCESS] }
    await openCockpit(serverFor({ view: { section: "incidents" }, data: incidents }))
    await screen.findByText("Invoice Receipt")
    expect(screen.queryByRole("button", { name: /^More actions/ })).toBeNull()
    await act(async () => unmount?.())
    document.body.innerHTML = ""

    await openCockpit(serverFor({ view: { section: "jobs" }, data: JOBS }), undefined, "jobs")
    await screen.findByText("Card declined")
    expect(screen.queryByRole("button", { name: /^More actions/ })).toBeNull()
    // No retry on this page either: no row can fill an actions column, so there is none.
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull()
  })

  it("keeps a row's menu where the page copies its hand-offs", async () => {
    await openCockpit(serverFor({ view: { section: "jobs" }, data: JOBS }), "copy", "jobs")
    await screen.findByText("Card declined")
    expect(
      screen.getByRole("button", { name: "More actions for the job at Charge card" }),
    ).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy()
  })

  it("offers each hand-off's prompt to copy where the page says so", async () => {
    await openCockpit(serverFor({ view: { section: "incidents" }, data: DASHBOARD }), "copy")
    await screen.findByRole("heading", { name: "prod-a · Incidents" })
    expect(screen.getByRole("button", { name: "Copy prompt: Assess in chat" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Assess in chat" })).toBeNull()
  })

  it("offers no write on a page and never asks the gate feed, though the deployment offers every one", async () => {
    const view = serverFor({ view: { section: "jobs" }, data: JOBS })
    const callTool = vi.fn<ToolCaller>((name, args) =>
      name === ENGINE_WIDGET_ACTIONS_DATA
        ? Promise.resolve({
            structuredContent: { allowedActions: [...ENGINE_WIDGET_ACTIONS], readOnlyEngines: [] },
            content: [{ type: "text", text: "{}" }],
          })
        : view(name, args),
    )
    await openCockpit(callTool, "copy", "jobs")
    await screen.findByText("Card declined")
    await act(async () => await Promise.resolve())
    // A page writes nothing, so it asks nothing of the gate: the web app's forward never sees it.
    expect(callTool.mock.calls.map(([name]) => name)).not.toContain(ENGINE_WIDGET_ACTIONS_DATA)
    expect(screen.queryByRole("button", { name: "Retry job" })).toBeNull()
    // The row keeps its menu of hand-offs to copy, so the actions column stays.
    expect(
      screen.getByRole("button", { name: "More actions for the job at Charge card" }),
    ).toBeTruthy()
  })

  it("words a failed view call in the frame with Try again, never a blank page", async () => {
    const callTool = vi.fn<ToolCaller>(() => Promise.reject(new Error("fetch failed")))
    await openCockpit(callTool)
    expect(await screen.findByText("The data source is unreachable")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })
})
