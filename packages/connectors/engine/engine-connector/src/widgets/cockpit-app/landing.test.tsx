// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { TONE_ICON } from "@miragon/pulse-ui"
import { ENGINE_COCKPIT_OVERVIEW_DATA } from "../../tool-names.js"
import { LandingChooser, type ServerBoards } from "./landing.js"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"

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
  })

  it("names a refused file by its id and problem count, opens nothing, and says where its problems are", () => {
    renderBoards()
    const boards = screen.getByRole("region", { name: "Boards" })
    expect(within(boards).getAllByRole("button")).toHaveLength(1)
    const refused = within(boards).getByText("broken").parentElement!
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
