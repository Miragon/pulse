// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

/**
 * prod-a and prod-b share `invoice`, prod-a and prod-c `billing`; prod-b's backlog does not answer;
 * down answers nothing.
 */
const DEFINITIONS: Record<string, DefinitionStat[]> = {
  "prod-a": [definition("invoice", "Invoice Receipt", 3, 2), definition("billing", "Billing", 1)],
  "prod-b": [
    definition("invoice", "Invoice Receipt", 4),
    definition("onboarding", "Onboarding", 0),
  ],
  "prod-c": [definition("billing", "Billing", 2)],
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

/**
 * A case renders widgets in happy-dom and waits for their queries: up to 0.2 s alone, up to 3.1 s
 * on the CI runner, where `pnpm test` runs every package's suite at once on four cores.
 */
const RENDER = { timeout: 15_000 }

describe("the cross-engine landscape, read from each engine", RENDER, () => {
  it("totals the engines that answered as a lower bound; the rows, not a tile, count the engines", async () => {
    renderFleet()
    const landscape = screen.getByRole("region", { name: "Process landscape" })
    // 3 + 1 on prod-a, 4 + 0 on prod-b: a sum of counts, never an average or a rate.
    expect(await within(landscape).findByText("≥ 8")).toBeTruthy()
    expect(within(landscape).getByText("1 on several engines")).toBeTruthy()
    // N8: the header counts the engines, each row says its state; no tile repeats them.
    expect(within(landscape).queryByText("Engines")).toBeNull()
    expect(within(landscape).queryByText(/unreachable/)).toBeTruthy()
    expect(document.querySelectorAll("[data-slot='kpi-label']")).toHaveLength(3)
  })

  it("rows every engine with its load and backlog, an engine without an answer in words", async () => {
    renderFleet()
    const table = await screen.findByRole("region", { name: "Load and job backlog per engine" })
    await waitFor(() => expect(within(table).getByText("unreachable")).toBeTruthy())
    const rows = within(table).getAllByRole("row").slice(1)
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
    // One head row: the columns name themselves, so the backlog can give way on a narrow table.
    expect(within(table).queryByRole("columnheader", { name: "Load (absolute)" })).toBeNull()
    const heads = within(table)
      .getAllByRole("columnheader", { hidden: true })
      .map((head) => head.textContent)
    expect(heads).toContain("Jobs due later")
    // Four backlog columns and the inventory give way on a narrow table (`hideBelow`).
    const css = table.closest("[data-list-table]")?.querySelector("style")?.textContent ?? ""
    expect(css.match(/display: none/g)).toHaveLength(5)
  })

  it("opens an engine from its row, on a click or Enter", async () => {
    const entered: string[] = []
    render(
      <TestViewHost tools={TOOLS} client={queryClient}>
        <FleetView
          engines={[{ id: "prod-a" }, { id: "prod-b" }]}
          onEnterEngine={(id) => entered.push(id)}
        />
      </TestViewHost>,
    )
    const table = await screen.findByRole("region", { name: "Load and job backlog per engine" })
    const row = within(table).getByText("prod-b", { selector: "span" }).closest("tr")!
    fireEvent.click(row)
    fireEvent.keyDown(within(table).getByText("prod-a", { selector: "span" }).closest("tr")!, {
      key: "Enter",
    })
    expect(entered).toEqual(["prod-b", "prod-a"])
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
    // On every engine read: its cells say so, no pill repeats it (D14), and no legend explains
    // an empty cell.
    expect(within(matrix).queryByText("on 2 engines")).toBeNull()
    expect(screen.queryByText(/An empty cell/)).toBeNull()
    expect(cells(rows[0]).slice(1)).toEqual(["3", "4", "2Has open incidents"])
    // Not deployed is an empty cell, said for screen readers; deployed with nothing running is 0.
    expect(cells(rows.find((r) => r.textContent?.includes("Onboarding"))!).slice(1)).toEqual([
      "not deployed on this engine",
      "0",
      "0",
    ])
    expect(screen.getByText("No column for down: its row above says why.")).toBeTruthy()
  })

  it("names how many engines run a process only where not every engine does", async () => {
    render(
      <TestViewHost tools={TOOLS} client={queryClient}>
        <FleetView
          engines={[{ id: "prod-a" }, { id: "prod-b" }, { id: "prod-c" }]}
          onEnterEngine={() => {}}
        />
      </TestViewHost>,
    )
    const matrix = await screen.findByRole("region", { name: "Process definitions by engine" })
    await waitFor(() => expect(within(matrix).getAllByText("on 2 engines")).toHaveLength(2))
    const heads = within(matrix)
      .getAllByRole("columnheader")
      .map((head) => head.textContent)
    expect(heads).toEqual(["Process definition", "prod-a", "prod-b", "prod-c", "Incidents"])
  })

  it("asks only the engine module's feeds and offers no performance hand-off", async () => {
    const { calls } = renderFleet()
    await screen.findByRole("region", { name: "Process definitions by engine" })
    expect(new Set(calls)).toEqual(
      new Set([ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_JOB_BACKLOG_DATA, ENGINE_HEALTH_DATA]),
    )
    expect(screen.getByText("Analyses across all engines")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Analyze failures in chat" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Analyze performance in chat" })).toBeNull()
  })

  it("shows no analyses section, nor the header's hand-off, where the host shows no hand-off", async () => {
    render(
      <TestViewHost tools={TOOLS} client={queryClient} followUp="none">
        <FleetView engines={[{ id: "prod-a" }, { id: "prod-b" }]} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    await screen.findByRole("region", { name: "Process definitions by engine" })
    expect(screen.getByRole("heading", { name: "Cross-engine overview" })).toBeTruthy()
    expect(screen.queryByText("Analyses across all engines")).toBeNull()
    expect(screen.queryByText("The AI runs these analyses in the chat")).toBeNull()
    expect(screen.queryByRole("button", { name: /in chat$/ })).toBeNull()
  })

  it("words its analyses for a page that copies their prompts, never for a chat it posts to", async () => {
    render(
      <TestViewHost tools={TOOLS} client={queryClient} followUp="copy">
        <FleetView engines={[{ id: "prod-a" }, { id: "prod-b" }]} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    await screen.findByRole("region", { name: "Process definitions by engine" })
    expect(screen.getByText("Analyses across all engines")).toBeTruthy()
    expect(
      screen.getByText("Copy a prompt, then the AI runs the analysis in your chat"),
    ).toBeTruthy()
    expect(screen.queryByText("The AI runs these analyses in the chat")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Copy prompt: Analyze failures in chat" }),
    ).toBeTruthy()
  })

  it("counts nothing while no engine has answered: unknown, never 0", async () => {
    render(
      <TestViewHost tools={TOOLS} client={queryClient}>
        <FleetView engines={[{ id: "down" }, { id: "also-down" }]} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    const landscape = screen.getByRole("region", { name: "Process landscape" })
    await waitFor(() => expect(within(landscape).getAllByText("unreachable")).toHaveLength(2))
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
    const table = screen.getByRole("region", { name: "Load and job backlog per engine" })
    await waitFor(() => expect(within(table).getByText("unreachable")).toBeTruthy())
    expect(within(table).getByText("profile refused")).toBeTruthy()
  })

  it("never reads a profile the server refused, whatever dialect it names: refused, never unreachable", async () => {
    const read: string[] = []
    const feed = (args: Record<string, unknown>) => {
      read.push(String(args.engine))
      if (args.engine === "c8bad") throw new Error("Tool engine_cockpit_overview_data not found")
      return overviewFeed(args)
    }
    render(
      <TestViewHost tools={{ ...TOOLS, [ENGINE_COCKPIT_OVERVIEW_DATA]: feed }} client={queryClient}>
        <FleetView
          engines={[
            { id: "prod-a" },
            { id: "c8bad", refused: { reason: "auth.clientSecretEnv is not set." } },
          ]}
          onEnterEngine={() => {}}
        />
      </TestViewHost>,
    )
    const landscape = screen.getByRole("region", { name: "Process landscape" })
    const table = screen.getByRole("region", { name: "Load and job backlog per engine" })
    await waitFor(() => expect(within(table).getByText("profile refused")).toBeTruthy())
    expect(within(landscape).queryByText(/unreachable/)).toBeNull()
    const row = within(table).getByText("c8bad", { selector: "span" }).closest("tr")!
    expect(row.querySelector("svg")?.getAttribute("class")).toContain("lucide-ban")
    expect(read.every((engine) => engine === "prod-a")).toBe(true)
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

    /** The row of an engine, its mark the first icon. */
    const rowOf = (engine: string) =>
      within(screen.getByRole("region", { name: "Load and job backlog per engine" }))
        .getByText(engine, { selector: "span" })
        .closest("tr")!

    it("words a 401 and a 403 apart, never as unreachable, each with a refused profile's tone", async () => {
      const landscape = renderLogin()
      const table = screen.getByRole("region", { name: "Load and job backlog per engine" })
      await waitFor(() => expect(within(table).getByText("credentials rejected")).toBeTruthy())
      expect(within(table).getByText("access denied")).toBeTruthy()
      expect(within(landscape).queryByText(/unreachable/)).toBeNull()
      const mark = rowOf("locked-out").querySelector("svg")?.getAttribute("class") ?? ""
      expect(mark).toContain("lucide-key-round")
    })

    it("marks an unreachable engine in the outage's tone beside one that refused the login", async () => {
      renderLogin([{ id: "prod-a" }, { id: "down" }, { id: "locked-out" }])
      const table = screen.getByRole("region", { name: "Load and job backlog per engine" })
      await waitFor(() => expect(within(table).getByText("unreachable")).toBeTruthy())
      expect(rowOf("down").querySelector("svg")?.getAttribute("class")).toContain("lucide-unplug")
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

    it("speaks German on a German host", async () => {
      renderLogin(ENGINES, "de")
      const table = screen.getByRole("region", { name: "Last und Job-Rückstand je Engine" })
      await waitFor(() => expect(within(table).getByText("Zugangsdaten abgelehnt")).toBeTruthy())
      expect(within(table).getByText("Zugriff verweigert")).toBeTruthy()
      expect(within(table).getByText("Profil abgelehnt")).toBeTruthy()
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
