// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import {
  TestViewHost,
  createTestQueryClient,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"
import {
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_HEALTH_DATA,
  ENGINE_JOB_BACKLOG_DATA,
} from "../../tool-names.js"
import type { CockpitDashboardData, DefinitionStat, JobBacklogData } from "../../view-models.js"
import { FleetView } from "./fleet-view.js"

let queryClient = createTestQueryClient()
afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

function definition(key: string, name: string, instances: number, incidents = 0): DefinitionStat {
  return {
    id: `${key}:1:d`,
    key,
    name,
    latestVersion: 1,
    instances,
    failedJobs: 0,
    incidents: incidents > 0 ? [{ incidentType: "failedJob", incidentCount: incidents }] : [],
  }
}

/** prod-a and prod-b share `invoice`; prod-b's backlog does not answer; down answers nothing. */
const DEFINITIONS: Record<string, DefinitionStat[]> = {
  "prod-a": [definition("invoice", "Invoice Receipt", 3, 2), definition("billing", "Billing", 1)],
  "prod-b": [
    definition("invoice", "Invoice Receipt", 4),
    definition("onboarding", "Onboarding", 0),
  ],
}

function overviewFeed(args: Record<string, unknown>): CockpitDashboardData {
  const definitions = DEFINITIONS[String(args.engine)]
  if (!definitions) throw new Error("ECONNREFUSED")
  return {
    summary: {
      totalDefinitions: 2,
      totalRunningInstances: 0,
      totalFailedJobs: 0,
      totalIncidents: 0,
    },
    definitions,
    engineId: String(args.engine),
  }
}

function backlogFeed(args: Record<string, unknown>): JobBacklogData {
  if (args.engine !== "prod-a") throw new Error("Engine is shutting down")
  return {
    executableJobs: 12,
    suspendedJobs: 3,
    jobsDueLater: 7,
    externalTasks: 5,
    engineId: "prod-a",
  }
}

const TOOLS = {
  [ENGINE_COCKPIT_OVERVIEW_DATA]: overviewFeed,
  [ENGINE_JOB_BACKLOG_DATA]: backlogFeed,
  [ENGINE_HEALTH_DATA]: () => {
    throw new Error("not under test")
  },
}

function renderFleet(locale?: string) {
  const calls: string[] = []
  render(
    <TestViewHost
      tools={TOOLS}
      client={queryClient}
      locale={locale}
      onHostAction={(action: HostAction) => {
        if (action.type === "callTool") calls.push(action.name)
      }}
    >
      <FleetView
        engines={[{ id: "prod-a" }, { id: "prod-b" }, { id: "down" }]}
        onEnterEngine={() => {}}
      />
    </TestViewHost>,
  )
  return { calls }
}

/** Every cell, a column the narrow test region hides included. */
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell", { hidden: true })
    .map((c) => c.textContent)

describe("the cross-engine landscape, read from each engine", () => {
  it("totals the engines that answered as a lower bound, and counts the unreachable one", async () => {
    renderFleet()
    const landscape = screen.getByRole("region", { name: "Process landscape" })
    await waitFor(() => expect(within(landscape).getByText("1 unreachable")).toBeTruthy())
    // 3 + 1 on prod-a, 4 + 0 on prod-b: a sum of counts, never an average or a rate.
    expect(within(landscape).getByText("≥8")).toBeTruthy()
    expect(within(landscape).getByText("1 on several engines")).toBeTruthy()
  })

  it("rows every engine with its load and backlog, an engine without an answer in words", async () => {
    renderFleet()
    const table = await screen.findByRole("region", { name: "Load and job backlog per engine" })
    await waitFor(() => expect(within(table).getByText("unreachable")).toBeTruthy())
    const rows = within(table).getAllByRole("row").slice(2)
    await waitFor(() =>
      expect(cells(rows[0])).toEqual([
        "prod-a",
        "4",
        "2",
        "0",
        "12",
        "3",
        "7",
        "5",
        "2(1 only here)",
      ]),
    )
    // The overview answered, the backlog did not: unknown, never 0.
    expect(cells(rows[1]).slice(4, 8)).toEqual(Array(4).fill(expect.stringContaining("—")))
    expect(cells(rows[2]).slice(1)).toEqual(Array(8).fill(expect.stringContaining("—")))
    expect(screen.getByText("— No answer from this engine: figure unknown")).toBeTruthy()
    expect(within(table).getByRole("columnheader", { name: "Load (absolute)" })).toBeTruthy()
    expect(
      within(table).getByRole("columnheader", { name: "Job backlog, comparable across engines" }),
    ).toBeTruthy()
  })

  it("lays out what runs where: shared first, a column per answering engine, the rest named", async () => {
    renderFleet()
    const matrix = await screen.findByRole("region", { name: "Process definitions by engine" })
    const heads = within(matrix)
      .getAllByRole("columnheader")
      .map((h) => h.textContent)
    expect(heads).toEqual(["Process definition", "prod-a", "prod-b", "Incidents"])
    const rows = within(matrix).getAllByRole("row").slice(1)
    expect(within(rows[0]).getByText("Invoice Receipt")).toBeTruthy()
    expect(within(rows[0]).getByText("on 2 engines")).toBeTruthy()
    expect(cells(rows[0]).slice(1)).toEqual(["3", "4", "2"])
    // Not deployed is an empty cell, said for screen readers; deployed with nothing running is 0.
    expect(cells(rows.find((r) => r.textContent?.includes("Onboarding"))!).slice(1)).toEqual([
      "not deployed on this engine",
      "0",
      "0",
    ])
    expect(screen.getByText("No column for down: this engine has not answered.")).toBeTruthy()
  })

  it("asks only the engine module's feeds and offers no performance hand-off", async () => {
    const { calls } = renderFleet()
    await screen.findByRole("region", { name: "Process definitions by engine" })
    expect(new Set(calls)).toEqual(
      new Set([ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_JOB_BACKLOG_DATA, ENGINE_HEALTH_DATA]),
    )
    expect(screen.getByRole("button", { name: "Analyze failures in chat" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Analyze performance in chat" })).toBeNull()
  })

  it("counts nothing while no engine has answered: unknown, never 0", async () => {
    render(
      <TestViewHost tools={TOOLS} client={queryClient}>
        <FleetView engines={[{ id: "down" }, { id: "also-down" }]} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    const landscape = screen.getByRole("region", { name: "Process landscape" })
    await waitFor(() => expect(within(landscape).getByText("2 unreachable")).toBeTruthy())
    expect(within(landscape).queryByText(/^≥?0$/)).toBeNull()
    expect(
      screen.getByText(
        "No engine has answered, so there are no process definitions to show. Check that the engines are reachable.",
      ),
    ).toBeTruthy()
  })

  it("speaks German on a German host", async () => {
    renderFleet("de")
    const table = await screen.findByRole("region", { name: "Last und Job-Rückstand je Engine" })
    await waitFor(() => expect(within(table).getByText("nicht erreichbar")).toBeTruthy())
    expect(screen.getByRole("region", { name: "Prozesslandschaft" })).toBeTruthy()
    expect(
      screen.getByText("Keine Spalte für down: Diese Engine hat nicht geantwortet."),
    ).toBeTruthy()
  })
})
