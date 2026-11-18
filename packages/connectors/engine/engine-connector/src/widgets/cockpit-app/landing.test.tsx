// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { TONE_ICON } from "@miragon/pulse-ui"
import { ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_HEALTH_DATA } from "../../tool-names.js"
import { LandingChooser, type ServerBoards } from "./landing.js"
import {
  TestViewHost,
  WebApiError,
  createTestQueryClient,
  createViewQueryClient,
} from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

// The query client is a singleton: restore it so no feed answer leaks across tests.

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

const ENGINES = [
  { id: "prod-a", environment: "prod" },
  { id: "prod-b", environment: "prod" },
  { id: "test-down", environment: "test" },
  { id: "test-empty", environment: "test" },
  { id: "test-slow", environment: "test" },
  { id: "test-stuck", environment: "test" },
]

/** prod-a incidents, prod-b healthy, test-down unreachable, test-empty empty, test-slow never answers, test-stuck no retries. */
function overviewFeed(args: Record<string, unknown>) {
  if (args.engine === "test-down") throw new Error("ECONNREFUSED")
  if (args.engine === "test-slow") return new Promise(() => {})
  return {
    summary: {
      totalDefinitions: args.engine === "test-empty" ? 0 : 2,
      totalRunningInstances: args.engine === "test-empty" ? 0 : 10,
      totalFailedJobs: args.engine === "test-stuck" ? 4 : 0,
      totalIncidents: args.engine === "prod-a" ? 18 : 0,
    },
    definitions: [],
    engineId: args.engine,
  }
}

function renderLanding(
  onOpenFleet?: () => void,
  engines: Array<{ id: string; environment?: string }> = ENGINES,
) {
  const Landing: ComponentType<Record<string, unknown>> = () => (
    <LandingChooser
      engines={engines}
      defaultEngineId="prod-b"
      onEnterEngine={() => {}}
      onOpenFleet={onOpenFleet}
    />
  )
  render(
    <TestViewHost tools={{ [ENGINE_COCKPIT_OVERVIEW_DATA]: overviewFeed }} client={queryClient}>
      <Landing />
    </TestViewHost>,
  )
}

// #322 U15: the landing is the product signature over a dense engine list.
describe("LandingChooser", () => {
  it("signs the app: Pulse over Operations Cockpit, with the Komet", () => {
    renderLanding()
    expect(screen.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeTruthy()
    expect(screen.getByText("Pulse")).toBeTruthy()
    expect(document.querySelector("[data-brand-mark='komet']")).toBeTruthy()
  })

  it("offers the cross-engine view only when the cockpit passes it in", () => {
    renderLanding(() => {})
    expect(screen.getByRole("button", { name: "Cross-engine overview" })).toBeTruthy()
    cleanup()
    renderLanding(undefined)
    expect(screen.queryByRole("button", { name: "Cross-engine overview" })).toBeNull()
  })

  it("lists every engine at once, grouped by environment", () => {
    renderLanding()
    expect(screen.getByRole("region", { name: "Environment PROD" })).toBeTruthy()
    const test = screen.getByRole("region", { name: "Environment TEST" })
    expect(within(test).getAllByRole("button")).toHaveLength(4)
    expect(screen.getByText("6 engines in 2 environments. Pick one to work with.")).toBeTruthy()
  })

  it("names each engine's state in words inside its button", async () => {
    renderLanding()
    expect(await screen.findByRole("button", { name: /^prod-a\s*,\s*18 incidents$/ })).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: /^test-down\s*,\s*unreachable$/ }),
    ).toBeTruthy()
    expect(await screen.findByRole("button", { name: /^test-empty\s*,\s*empty$/ })).toBeTruthy()
    expect(await screen.findByRole("button", { name: /^test-slow\s*,\s*loading…$/ })).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: /^test-stuck\s*,\s*4 jobs without retries$/ }),
    ).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: /^prod-b\s*default\s*,\s*no incidents$/ }),
    ).toBeTruthy()
  })

  /**
   * F2 (Inspector run of 2026-11-09): an engine that answers the server's login with 401 or 403
   * runs, so its row says what describeError's title says in short, never "unreachable", with the
   * warning tone of a refused profile instead of an outage's danger.
   */
  describe("an engine that refuses the server's login", () => {
    const LOGIN = [{ id: "locked-out" }, { id: "no-access" }, { id: "down" }, { id: "locked" }]

    /** What the server answers for each: the engine's 401 and 403, no answer, a refused profile. */
    function loginFeed(args: Record<string, unknown>) {
      if (args.engine === "locked-out")
        throw new Error(
          "[401] empty response body (engine locked-out). The engine rejected the configured credentials.",
        )
      if (args.engine === "no-access")
        throw new Error(
          "[403 AuthorizationException] The user 'pulse' does not have READ permission (engine no-access)",
        )
      if (args.engine === "locked")
        throw new Error(
          '[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.',
        )
      throw new Error("engine down unreachable (ECONNREFUSED)")
    }

    function renderLogin(locale?: string) {
      render(
        <TestViewHost
          tools={{ [ENGINE_COCKPIT_OVERVIEW_DATA]: loginFeed }}
          client={queryClient}
          locale={locale}
        >
          <LandingChooser engines={LOGIN} onEnterEngine={() => {}} />
        </TestViewHost>,
      )
    }

    const row = async (name: RegExp) => await screen.findByRole("button", { name })
    const mark = (button: HTMLElement) => button.querySelector("svg")?.getAttribute("class") ?? ""

    it("words a 401 and a 403 apart from an unreachable engine and a refused profile", async () => {
      renderLogin()
      const lockedOut = await row(/^locked-out\s*,\s*credentials rejected$/)
      const noAccess = await row(/^no-access\s*,\s*access denied$/)
      const down = await row(/^down\s*,\s*unreachable$/)
      const locked = await row(/^locked\s*,\s*profile refused$/)
      expect(lockedOut.dataset.status).toBe("unauthorized")
      expect(noAccess.dataset.status).toBe("forbidden")
      // The tone of a refused profile, never the outage's.
      expect(mark(lockedOut)).toContain(TONE_ICON.warning)
      expect(mark(noAccess)).toContain(TONE_ICON.warning)
      expect(mark(locked)).toContain(TONE_ICON.warning)
      expect(mark(down)).toContain(TONE_ICON.danger)
      expect(mark(lockedOut)).not.toContain(TONE_ICON.danger)
      // The server's key for a refused login, never the unplugged cable of an engine that is down.
      expect(mark(lockedOut)).toContain("lucide-key-round")
      expect(mark(noAccess)).toContain("lucide-key-round")
      expect(mark(down)).toContain("lucide-unplug")
      expect(mark(lockedOut)).not.toContain("lucide-unplug")
      expect(mark(noAccess)).not.toContain("lucide-unplug")
    })

    it("speaks German on a German host", async () => {
      renderLogin("de")
      expect(await row(/^locked-out\s*,\s*Zugangsdaten abgelehnt$/)).toBeTruthy()
      expect(await row(/^no-access\s*,\s*Zugriff verweigert$/)).toBeTruthy()
      expect(await row(/^down\s*,\s*nicht erreichbar$/)).toBeTruthy()
      expect(await row(/^locked\s*,\s*Profil abgelehnt$/)).toBeTruthy()
    })
  })

  /**
   * A profile the server refused says so without a read, whatever dialect its profile names: the
   * server offers no feed a profile of another dialect, so a read answers an input its enum refuses
   * (Camunda 8 beside Camunda 7) or no such feed (Camunda 7 beside Camunda 8 alone), which a row
   * that read it would call unreachable.
   */
  it("says a refused profile is refused without reading it, whatever dialect it names", async () => {
    const read: string[] = []
    const feed = (args: Record<string, unknown>) => {
      read.push(String(args.engine))
      if (args.engine === "shop") return overviewFeed({ engine: "prod-b" })
      throw new Error(
        'Input validation error: Invalid arguments for tool engine_cockpit_overview_data: engine: Invalid input: expected "shop"',
      )
    }
    render(
      <TestViewHost tools={{ [ENGINE_COCKPIT_OVERVIEW_DATA]: feed }} client={queryClient}>
        <LandingChooser
          engines={[
            { id: "shop", dialect: "c7" },
            { id: "c8bad", refused: { reason: "auth.clientSecretEnv is not set." } },
          ]}
          onEnterEngine={() => {}}
        />
      </TestViewHost>,
    )
    const refused = await screen.findByRole("button", { name: /^c8bad\s*,\s*profile refused$/ })
    expect(refused.dataset.status).toBe("refused")
    const mark = refused.querySelector("svg")?.getAttribute("class") ?? ""
    expect(mark).toContain("lucide-ban")
    expect(mark).toContain(TONE_ICON.warning)
    expect(await screen.findByRole("button", { name: /^shop\s*,\s*no incidents$/ })).toBeTruthy()
    expect(read).toEqual(["shop"])
  })

  /**
   * An engine that does not answer says so from the first failed read, as a board's strip on the
   * same page does, while the view's query client retries quietly behind it (1, 2, 4 s): never
   * "loading…" for the 7 s the retries take.
   */
  it("says an engine is unreachable from its first failed read, its retries quiet", async () => {
    const client = createViewQueryClient()
    let reads = 0
    render(
      <TestViewHost
        tools={{
          [ENGINE_COCKPIT_OVERVIEW_DATA]: () => {
            reads += 1
            throw new Error("[503 ProcessEngineException] Engine is shutting down (engine down)")
          },
        }}
        client={client}
      >
        <LandingChooser engines={[{ id: "down" }]} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    const down = await screen.findByRole("button", { name: /^down\s*,\s*unreachable$/ })
    expect(down.dataset.status).toBe("unreachable")
    // The policy's retries still run behind it: the read is not over yet.
    expect(reads).toBe(1)
    expect(client.isFetching()).toBeGreaterThan(0)
    client.clear()
  })

  /**
   * A counts read that a retry mends never flickers a row that shows counts: over counts on screen
   * the row says a failure only once every retry failed.
   */
  it("keeps an engine's counts through a refetch's failed first attempt", async () => {
    const client = createViewQueryClient()
    let reads = 0
    render(
      <TestViewHost
        tools={{
          [ENGINE_COCKPIT_OVERVIEW_DATA]: (args: Record<string, unknown>) => {
            reads += 1
            if (reads > 1) throw new Error("[503 ProcessEngineException] Busy (engine prod-b)")
            return overviewFeed(args)
          },
          [ENGINE_HEALTH_DATA]: { status: "ok" },
        }}
        client={client}
      >
        <LandingChooser engines={[{ id: "prod-b" }]} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    await screen.findByRole("button", { name: /^prod-b\s*,\s*no incidents$/ })
    // Not awaited: the refetch settles only once its retries ran out.
    act(() => {
      void client.invalidateQueries({ queryKey: ["engine:cockpit-overview"] })
    })
    const key = ["engine:cockpit-overview", "prod-b", { engine: "prod-b" }]
    await waitFor(() => expect(client.getQueryState(key)?.fetchFailureCount).toBe(1))
    // The first attempt failed and its retry waits: the row still shows what it read.
    expect(reads).toBe(2)
    expect(client.isFetching({ queryKey: key })).toBe(1)
    expect(screen.getByRole("button", { name: /^prod-b\s*,\s*no incidents$/ }).dataset.status).toBe(
      "healthy",
    )
    client.clear()
  })

  /**
   * A page whose session ended asked no engine: its rows say nothing of the engine, never
   * "credentials rejected" (the page's frame says the session ended), and keep what they read.
   */
  describe("a page whose session ended", () => {
    const ENDED = () => new WebApiError(401, { code: "signed_out", message: "No session." })

    it("says it read nothing where it read nothing yet, without a tone", async () => {
      render(
        <TestViewHost
          tools={{
            [ENGINE_COCKPIT_OVERVIEW_DATA]: () => {
              throw ENDED()
            },
          }}
          client={createViewQueryClient()}
          followUp="none"
        >
          <LandingChooser engines={[{ id: "prod-a" }]} onEnterEngine={() => {}} />
        </TestViewHost>,
      )
      const row = await screen.findByRole("button", { name: /^prod-a\s*,\s*not loaded$/ })
      expect(row.dataset.status).toBe("notLoaded")
      const mark = row.querySelector("svg")?.getAttribute("class") ?? ""
      expect(mark).toContain("lucide-minus")
      expect(mark).not.toContain(TONE_ICON.warning)
      expect(mark).not.toContain(TONE_ICON.danger)
    })

    it("keeps the counts it read before the session ended", async () => {
      const client = createViewQueryClient()
      let reads = 0
      render(
        <TestViewHost
          tools={{
            [ENGINE_COCKPIT_OVERVIEW_DATA]: (args: Record<string, unknown>) => {
              reads += 1
              if (reads > 1) throw ENDED()
              return overviewFeed(args)
            },
            [ENGINE_HEALTH_DATA]: { status: "ok" },
          }}
          client={client}
          followUp="none"
          locale="de"
        >
          <LandingChooser engines={[{ id: "prod-a" }]} onEnterEngine={() => {}} />
        </TestViewHost>,
      )
      await screen.findByRole("button", { name: /^prod-a\s*,\s*18 Incidents$/ })
      await act(() => client.invalidateQueries({ queryKey: ["engine:cockpit-overview"] }))
      const key = ["engine:cockpit-overview", "prod-a", { engine: "prod-a" }]
      await waitFor(() => expect(client.getQueryState(key)?.status).toBe("error"))
      expect(reads).toBe(2)
      const row = screen.getByRole("button", { name: /^prod-a\s*,\s*18 Incidents$/ })
      expect(row.dataset.status).toBe("incidents")
      expect(screen.queryByText("Zugangsdaten abgelehnt")).toBeNull()
      client.clear()
    })
  })

  it("no named environment: one flat list, no environment heading", () => {
    renderLanding(undefined, [{ id: "solo-a" }, { id: "solo-b" }])
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull()
    expect(screen.getByText("2 engines configured. Pick one to work with.")).toBeTruthy()
  })
})

/** The boards of ENGINE_BOARDS_DIR, under the engines; a file that gives no board says so. */
describe("LandingChooser with the server's boards", () => {
  const BOARDS: ServerBoards = {
    boards: [{ id: "invoices", title: "Invoice operations", engines: ["prod-a", "prod-b"] }],
    refusedBoards: [{ id: "broken", problems: 1 }],
  }

  const HINT =
    "Pulse shows no board for a refused file. The file's problems are in the log the server writes at startup, and whoever runs the server can fix the file."

  function renderBoards(locale?: string, opened: string[][] = [], boards = BOARDS) {
    render(
      <TestViewHost
        tools={{ [ENGINE_COCKPIT_OVERVIEW_DATA]: overviewFeed }}
        client={queryClient}
        locale={locale}
      >
        <LandingChooser
          engines={[{ id: "prod-a" }, { id: "prod-b" }]}
          onEnterEngine={() => {}}
          boards={boards}
          onOpenBoard={(id, title) => opened.push([id, title])}
        />
      </TestViewHost>,
    )
  }

  it("lists each board by its title and engines, a way into it", () => {
    const opened: string[][] = []
    renderBoards(undefined, opened)
    const boards = screen.getByRole("region", { name: "Boards" })
    expect(within(boards).getByRole("heading", { level: 2, name: "Boards" })).toBeTruthy()
    fireEvent.click(
      within(boards).getByRole("button", {
        name: /^Invoice operations\s*,\s*2 engines: prod-a, prod-b$/,
      }),
    )
    expect(opened).toEqual([["invoices", "Invoice operations"]])
    expect(screen.getByText("2 engines and 1 board. Pick one to work with.")).toBeTruthy()
    // Where a narrow row cuts the engines under the name, their title holds the whole list.
    const engines = within(boards).getByText("2 engines: prod-a, prod-b")
    expect(engines.getAttribute("title")).toBe("2 engines: prod-a, prod-b")
  })

  it("names a refused file by its id and problem count, opens nothing, and says where its problems are", () => {
    renderBoards()
    const boards = screen.getByRole("region", { name: "Boards" })
    expect(within(boards).getAllByRole("button")).toHaveLength(1)
    const refused = within(boards).getByText("broken").closest<HTMLElement>("[data-status]")!
    expect(refused.dataset.status).toBe("refused")
    expect(refused.textContent).toContain("file refused: 1 problem")
    expect(refused.querySelector("svg")?.getAttribute("class")).toContain(TONE_ICON.warning)
    expect(within(boards).getByText(HINT)).toBeTruthy()
  })

  it("says nothing of refused files where every file gives a board", () => {
    renderBoards(undefined, [], { boards: BOARDS.boards, refusedBoards: [] })
    const boards = screen.getByRole("region", { name: "Boards" })
    expect(within(boards).getAllByRole("button")).toHaveLength(1)
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it("counts no boards in the subtitle where every file is refused", () => {
    renderBoards(undefined, [], { boards: [], refusedBoards: BOARDS.refusedBoards })
    expect(screen.getByText("2 engines configured. Pick one to work with.")).toBeTruthy()
    expect(screen.getByText(HINT)).toBeTruthy()
  })

  it("gives the engines a heading of their own beside the boards", () => {
    renderBoards()
    const engines = screen.getByRole("region", { name: "Engines" })
    expect(within(engines).getByRole("heading", { level: 2, name: "Engines" })).toBeTruthy()
    expect(within(engines).getAllByRole("button")).toHaveLength(2)
  })

  it("speaks German on a German host", () => {
    renderBoards("de")
    const boards = screen.getByRole("region", { name: "Boards" })
    expect(
      within(boards).getByRole("button", {
        name: /^Invoice operations\s*,\s*2 Engines: prod-a, prod-b$/,
      }),
    ).toBeTruthy()
    expect(within(boards).getByText("Datei abgelehnt: 1 Problem")).toBeTruthy()
    expect(
      within(boards).getByText(
        "Zu einer abgelehnten Datei zeigt Pulse kein Board. Die Probleme der Datei stehen im Log, das der Server beim Start schreibt. Wer den Server betreibt, kann die Datei korrigieren.",
      ),
    ).toBeTruthy()
    expect(
      screen.getByText("2 Engines und 1 Board. Wähl aus, womit du arbeiten willst."),
    ).toBeTruthy()
  })

  it("without boards: no boards section and the engines without a heading of their own", () => {
    renderLanding(undefined, [{ id: "solo-a" }, { id: "solo-b" }])
    expect(screen.queryByRole("region", { name: "Boards" })).toBeNull()
    expect(screen.queryByRole("region", { name: "Engines" })).toBeNull()
  })
})
