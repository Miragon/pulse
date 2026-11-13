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

/** What the server answers for an engine whose profile it refused: it never asks that engine. */
const REFUSED =
  '[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.'

/** What the server answers for an engine that refuses its login: 401 and 403, the engine runs. */
const LOGIN_REFUSED: Record<string, string> = {
  "locked-out":
    "[401] empty response body (engine locked-out). The engine rejected the configured credentials.",
  "no-access":
    "[403 AuthorizationException] The user 'pulse' does not have READ permission (engine no-access)",
}

function overviewFeed(args: Record<string, unknown>): CockpitDashboardData {
  if (args.engine === "locked") throw new Error(REFUSED)
  const login = LOGIN_REFUSED[String(args.engine)]
  if (login) throw new Error(login)
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
    expect(within(landscape).getByText("≥ 8")).toBeTruthy()
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
        // Open incidents alarm by their icon and words; the number stays neutral.
        "2Has open incidents",
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
    expect(screen.getByText("— Not read from this engine: figure unknown")).toBeTruthy()
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
    expect(cells(rows[0]).slice(1)).toEqual(["3", "4", "2Has open incidents"])
    // Not deployed is an empty cell, said for screen readers; deployed with nothing running is 0.
    expect(cells(rows.find((r) => r.textContent?.includes("Onboarding"))!).slice(1)).toEqual([
      "not deployed on this engine",
      "0",
      "0",
    ])
    expect(screen.getByText("No column for down: its row above says why.")).toBeTruthy()
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
    expect(within(landscape).queryByText(/^(≥\s)?0$/)).toBeNull()
    expect(
      screen.getByText(
        "The server could not read any engine, so there are no process definitions to show. Each engine's row above says why.",
      ),
    ).toBeTruthy()
  })

  it("counts a refused profile apart from an unreachable engine, and words it", async () => {
    render(
      <TestViewHost tools={TOOLS} client={queryClient}>
        <FleetView
          engines={[{ id: "prod-a" }, { id: "down" }, { id: "locked" }]}
          onEnterEngine={() => {}}
        />
      </TestViewHost>,
    )
    const landscape = screen.getByRole("region", { name: "Process landscape" })
    await waitFor(() =>
      expect(within(landscape).getByText("1 unreachable · 1 with profile refused")).toBeTruthy(),
    )
    const table = screen.getByRole("region", { name: "Load and job backlog per engine" })
    expect(within(table).getByText("profile refused")).toBeTruthy()
    expect(within(table).getByText("unreachable")).toBeTruthy()
  })

  /** F2: an engine that refuses the server's login answered, so it is not counted unreachable. */
  describe("an engine that refuses the server's login", () => {
    const ENGINES = [{ id: "prod-a" }, { id: "locked-out" }, { id: "no-access" }, { id: "locked" }]

    function renderLogin(engines = ENGINES, locale?: string) {
      render(
        <TestViewHost tools={TOOLS} client={queryClient} locale={locale}>
          <FleetView engines={engines} onEnterEngine={() => {}} />
        </TestViewHost>,
      )
      return screen.getByRole("region", {
        name: locale === "de" ? "Prozesslandschaft" : "Process landscape",
      })
    }

    const trendOf = (landscape: HTMLElement, text: string) =>
      within(landscape).getByText(text, { exact: true })
    /** The tone of the icon of its own shape beside a KPI's trend line (never a coloured dot). */
    const toneOf = (landscape: HTMLElement, text: string) =>
      trendOf(landscape, text)
        .closest("[data-slot='kpi-trend']")
        ?.querySelector("svg[data-tone]")
        ?.getAttribute("data-tone")

    it("counts a 401 and a 403 apart, never as unreachable, with a refused profile's tone", async () => {
      const landscape = renderLogin()
      await waitFor(() =>
        expect(
          trendOf(
            landscape,
            "1 with profile refused · 1 with credentials rejected · 1 with access denied",
          ),
        ).toBeTruthy(),
      )
      expect(within(landscape).queryByText(/unreachable/)).toBeNull()
      expect(
        toneOf(
          landscape,
          "1 with profile refused · 1 with credentials rejected · 1 with access denied",
        ),
      ).toBe("warning")
      const table = screen.getByRole("region", { name: "Load and job backlog per engine" })
      expect(within(table).getByText("credentials rejected")).toBeTruthy()
      expect(within(table).getByText("access denied")).toBeTruthy()
      expect(within(table).queryByText("unreachable")).toBeNull()
    })

    it("keeps the outage's tone when an engine is unreachable too", async () => {
      const landscape = renderLogin([{ id: "prod-a" }, { id: "down" }, { id: "locked-out" }])
      await waitFor(() =>
        expect(trendOf(landscape, "1 unreachable · 1 with credentials rejected")).toBeTruthy(),
      )
      expect(toneOf(landscape, "1 unreachable · 1 with credentials rejected")).toBe("danger")
    })

    /** The landscape's notes on an engine it could not read never say it did not answer. */
    it("names them below the table and the matrix without saying they did not answer", async () => {
      const landscape = renderLogin()
      expect(
        await within(landscape).findByText(
          "No columns for locked-out, no-access, locked: their rows above say why.",
        ),
      ).toBeTruthy()
      expect(
        within(landscape).getByText("— Not read from this engine: figure unknown"),
      ).toBeTruthy()
      expect(within(landscape).queryByText(/answer/)).toBeNull()
    })

    it("says why no process shows when every engine refuses the login, not to check reachability", async () => {
      const landscape = renderLogin([{ id: "locked-out" }, { id: "no-access" }])
      await waitFor(() =>
        expect(
          within(landscape).getByText(
            "The server could not read any engine, so there are no process definitions to show. Each engine's row above says why.",
          ),
        ).toBeTruthy(),
      )
      expect(within(landscape).queryByText(/reachable|answer/)).toBeNull()
      const de = renderLogin([{ id: "locked-out" }], "de")
      await waitFor(() =>
        expect(
          within(de).getByText(
            "Der Server konnte keine Engine lesen, deshalb gibt es keine Prozessdefinitionen zu zeigen. Warum, steht oben in der Zeile jeder Engine.",
          ),
        ).toBeTruthy(),
      )
      expect(within(de).queryByText(/erreichbar|geantwortet/)).toBeNull()
    })

    it("words them on the engine cards as the landing does", async () => {
      renderLogin()
      expect(
        await screen.findByRole("button", { name: /^locked-out\b.*credentials rejected/ }),
      ).toBeTruthy()
      expect(
        await screen.findByRole("button", { name: /^no-access\b.*access denied/ }),
      ).toBeTruthy()
    })

    it("speaks German on a German host", async () => {
      const landscape = renderLogin(ENGINES, "de")
      await waitFor(() =>
        expect(
          trendOf(
            landscape,
            "1 mit abgelehntem Profil · 1 mit abgelehnten Zugangsdaten · 1 mit verweigertem Zugriff",
          ),
        ).toBeTruthy(),
      )
      const table = screen.getByRole("region", { name: "Last und Job-Rückstand je Engine" })
      expect(within(table).getByText("Zugangsdaten abgelehnt")).toBeTruthy()
      expect(within(table).getByText("Zugriff verweigert")).toBeTruthy()
    })
  })

  it("speaks German on a German host", async () => {
    renderFleet("de")
    const table = await screen.findByRole("region", { name: "Last und Job-Rückstand je Engine" })
    await waitFor(() => expect(within(table).getByText("nicht erreichbar")).toBeTruthy())
    expect(screen.getByRole("region", { name: "Prozesslandschaft" })).toBeTruthy()
    expect(
      screen.getByText("Keine Spalte für down: Warum, steht oben in ihrer Zeile."),
    ).toBeTruthy()
  })
})
