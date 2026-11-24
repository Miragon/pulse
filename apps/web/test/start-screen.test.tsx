// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TestViewHost, WebApiError, type HostAction } from "@miragon/pulse-widget-shell/widgets"
import type { EngineScreenData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { ENGINE_SCREEN_FEED } from "../src/screens/engine/engine-feed.js"
import { ENGINE_VERDICT_FEED } from "../src/screens/engine/verdict-feed.js"
import { onlyEngineOf, readOf } from "../src/screens/start/start-reads.js"
import { StartScreen } from "../src/screens/start/start-screen.js"

/**
 * The web app's start page over the kit world's engine screen (WORLD_SCREENS of
 * @miragon/pulse-screens/testing, what the server's feed builds of the recorded engines:
 * packages/connectors/engine/engine-connector/src/data/screens/screen-data.numbers.test.ts) under
 * each engine's name: every engine side by side with its engine screen's figures, a Camunda 8
 * cluster that stopped counting, a failing engine and a refused profile keeping their rows, each
 * Camunda 7 engine's live state from the server's verdict (none for the cluster), what runs where,
 * the boards, one engine in the start page's place, the Refresh, the reader's return, German.
 */

afterEach(cleanup)

const ENGINE_LIST = "engine_list_engines"

/** Two Camunda 7 engines, a Camunda 8 cluster and a refused profile, beside the server's boards. */
const LIST = {
  engines: [
    { id: "prod-a", dialect: "c7" },
    { id: "down", dialect: "c7" },
    { id: "c8-eu", dialect: "c8" },
  ],
  refused: [{ id: "legacy", reason: "auth.tokenEnv names a variable that is not set." }],
  boards: [{ id: "leasing", title: "Leasing operations", engines: ["prod-a", "c8-eu"] }],
  refusedBoards: [{ id: "broken", problems: 2 }],
}

/** A cluster's engine screen: a process whose incidents it stopped counting at 10,000. */
const CLUSTER: EngineScreenData = {
  engine: "c8-eu",
  asOf: "2026-11-19T08:59:00.000Z",
  info: { product: "Camunda", version: "8.10.9" },
  processes: [
    {
      bpmnProcessId: "pulse-order",
      name: "Order fulfillment",
      latestVersion: 4,
      running: 12_000,
      withIncident: 10_400,
      incidents: 10_000,
      incidentsAtLeast: true,
    },
  ],
  totals: { processes: 1, running: 12_000, withIncident: 10_400 },
}

/** A refusal of the server as the feed's result says it. */
const refusal = (text: string) => ({ isError: true, content: [{ type: "text", text }] })

/** The engine screen of `engine` as its feed answers: the kit world's under its name. */
const worldOn = (engine: string) => ({ ...WORLD_SCREENS.engine, engine, webApp: null })

const ANSWERS: Readonly<Record<string, unknown>> = {
  "prod-a": worldOn("prod-a"),
  down: refusal("[unreachable] connection to engine down failed (engine down)"),
  "c8-eu": { ...CLUSTER, webApp: null },
}

/** The verdict feed's answers per Camunda 7 engine: the server's verdict, or its failure. */
const VERDICTS: Readonly<Record<string, unknown>> = {
  "prod-a": { status: "warning" },
  down: refusal("[unreachable] connection to engine down failed (engine down)"),
}

/** An answer of a feed per engine: as it is, or what its function answers at each call. */
const answerOf = (answers: Readonly<Record<string, unknown>>, engine: string) => {
  const answer = answers[engine]
  return typeof answer === "function" ? (answer as () => unknown)() : answer
}

function renderStart({
  list = LIST,
  answers = ANSWERS,
  verdicts = VERDICTS,
  locale = "en",
}: {
  list?: unknown
  answers?: Readonly<Record<string, unknown>>
  verdicts?: Readonly<Record<string, unknown>>
  locale?: string
} = {}) {
  const actions: HostAction[] = []
  const navigate = vi.fn<(url: string) => void>()
  const replace = vi.fn<(url: string) => void>()
  render(
    <TestViewHost
      tools={{
        [ENGINE_LIST]: list,
        [ENGINE_SCREEN_FEED]: ({ engine }: { engine: string }) => answerOf(answers, engine),
        [ENGINE_VERDICT_FEED]: ({ engine }: { engine: string }) => answerOf(verdicts, engine),
      }}
      onHostAction={(action) => actions.push(action)}
      locale={locale}
      host={{ timeZone: "UTC" }}
      writes={false}
      followUp="none"
      startPage="/app"
    >
      <StartScreen navigate={navigate} replace={replace} />
    </TestViewHost>,
  )
  const calls = (name: string) =>
    actions.flatMap((action) =>
      action.type === "callTool" && action.name === name ? [action.args] : [],
    )
  return {
    navigate,
    replace,
    reads: () => calls(ENGINE_SCREEN_FEED),
    verdictReads: () => calls(ENGINE_VERDICT_FEED),
    lists: () => calls(ENGINE_LIST),
  }
}

/** The rows of a table, each as its cells' texts. */
/** A section of the page by its heading. */
const sectionOf = (heading: string) =>
  screen.getByRole("heading", { level: 2, name: heading }).closest<HTMLElement>("section")!

const rowsOf = (name: string) =>
  Array.from(screen.getByRole("table", { name }).querySelectorAll("tbody > tr"), (row) =>
    Array.from(row.querySelectorAll("td"), (cell) => cell.textContent),
  )

/**
 * How long the page may take to read every engine: the first render of the file on a loaded CI
 * runner took more than waitFor's 1 s and failed the suite (main, 2026-11-24), the file's test
 * timeout is 60 s.
 */
const LOADED_WITHIN = { timeout: 10_000 }

/** The engine table has its rows, the cluster's read. */
async function loaded() {
  await waitFor(() => expect(rowsOf("Engines")[2]?.[2]).toBe("Camunda 8.10.9"), LOADED_WITHIN)
}

describe("the start page", () => {
  it("shows every engine side by side with its engine screen's figures, one read per engine, none of the refused profile", async () => {
    const { reads, replace } = renderStart()
    await loaded()

    expect(rowsOf("Engines")).toEqual([
      [
        "prod-a",
        "Degraded",
        "Fake engine 1.0.0",
        "3",
        "5",
        "3Has open incidents",
        "2Has open incidents",
      ],
      ["downnot read", ...Array<string>(6).fill("—not read")],
      [
        "c8-eu",
        "—Pulse judges no state for this engine",
        "Camunda 8.10.9",
        "1",
        "12,000",
        "10,400Has open incidents",
        "≥ 10,000Has open incidents",
      ],
      ["legacyprofile refused", ...Array<string>(6).fill("—profile refused")],
    ])
    expect(reads()).toEqual([{ engine: "prod-a" }, { engine: "down" }, { engine: "c8-eu" }])
    expect(replace).not.toHaveBeenCalled()
  })

  it("reads each Camunda 7 engine's verdict from the server, never the cluster's or the refused profile's", async () => {
    const { verdictReads } = renderStart()
    await loaded()
    await waitFor(() => expect(rowsOf("Engines")[0]?.[1]).toBe("Degraded"))

    expect(verdictReads()).toEqual([{ engine: "prod-a" }, { engine: "down" }])
    const state = (engine: string) =>
      screen
        .getByRole("row", { name: `Engine ${engine}` })
        .querySelector<HTMLElement>('[data-part="engine-verdict"]')
    expect(state("prod-a")?.getAttribute("data-state")).toBe("warning")
    // The cluster shows none, honestly: the server decides no verdict for Camunda 8.
    expect(state("c8-eu")?.getAttribute("data-state")).toBeNull()
  })

  it("says a failed verdict read in the engine module's words beside the figures it keeps, never ok", async () => {
    renderStart({
      verdicts: {
        ...VERDICTS,
        "prod-a": refusal("[unreachable] connection to engine prod-a failed (engine prod-a)"),
      },
    })
    await loaded()

    await waitFor(() => expect(rowsOf("Engines")[0]?.[1]).toBe("Unreachable"))
    expect(rowsOf("Engines")[0]?.slice(2, 5)).toEqual(["Fake engine 1.0.0", "3", "5"])
    expect(screen.queryByText("prod-a couldn't be read")).toBeNull()
  })

  it("heads the page with All engines, how many the server configures and refused, the Refresh and when the numbers were read", async () => {
    renderStart()
    const heading = await screen.findByRole("heading", { level: 1, name: "All engines" })
    const bar = heading.closest<HTMLElement>("[data-slot=view-bar]")!

    expect(await within(bar).findByText("4 engines · 1 refused")).toBeTruthy()
    expect(within(bar).getByRole("button", { name: "Refresh" })).toBeTruthy()
    await loaded()
    // The oldest answer: the cluster's.
    expect(bar.querySelector("[data-slot=freshness-stamp]")?.textContent).toMatch(/8:59/)
  })

  it("says why an engine was not read in a strip, the kit's words, and a refused profile in the server's words", async () => {
    renderStart()
    await loaded()

    const down = screen
      .getByText("down couldn't be read")
      .closest<HTMLElement>("[data-slot=status-strip]")!
    expect(down.textContent).toContain("unreachable")
    const legacy = screen
      .getByText("legacy couldn't be read")
      .closest<HTMLElement>("[data-slot=status-strip]")!
    expect(legacy.textContent).toContain("Engine legacy cannot be used: its profile is refused")
    expect(legacy.textContent).toContain(
      '[ENGINE_PROFILE_REFUSED] Engine "legacy" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.',
    )
  })

  it("counts what runs where on the engines read, never a rate, and names those not read", async () => {
    renderStart()
    await loaded()
    await waitFor(() =>
      expect(screen.getByRole("table", { name: "Processes by engine" })).toBeTruthy(),
    )

    const section = sectionOf("What runs where")
    expect(within(section).getByText("running instances per engine · all versions")).toBeTruthy()
    expect(section.textContent).toContain(
      "Engines run different processes, so this view shows counts, never rates.",
    )
    expect(rowsOf("Processes by engine").map((row) => row.slice(1))).toEqual([
      ["3", "12,000", "10,401Has open incidents"],
      ["1", "not deployed on c8-eu", "1Has open incidents"],
      ["1", "not deployed on c8-eu", "1Has open incidents"],
    ])
    expect(section.textContent).toContain("Not read, so not in this view: down, legacy")
  })

  it("lists the boards, each opening its page, and the files that give none with their problems", async () => {
    const { navigate } = renderStart()
    await loaded()

    const boards = sectionOf("Boards")
    expect(rowsOf("Boards")).toEqual([["Leasing operations", "prod-a, c8-eu"]])
    const row = within(boards).getByRole("row", { name: "Board Leasing operations" })
    expect(row.getAttribute("data-href") ?? row.querySelector("a")?.getAttribute("href")).toBe(
      "/app/boards/leasing",
    )
    fireEvent.click(row)
    expect(navigate).toHaveBeenCalledWith("/app/boards/leasing")
    expect(boards.textContent).toContain("broken · file refused: 2 problems")
    expect(boards.textContent).toContain("Pulse shows no board for a refused file.")
  })

  it("opens an engine's screen from its row, a refused profile's too", async () => {
    const { navigate } = renderStart()
    await loaded()

    fireEvent.click(screen.getByRole("row", { name: "Engine c8-eu" }))
    fireEvent.click(screen.getByRole("row", { name: "Engine legacy" }))
    expect(navigate.mock.calls.map(([url]) => url)).toEqual([
      "/app/engines/c8-eu",
      "/app/engines/legacy",
    ])
  })

  it("shows no table of what runs where for one engine, and no boards section without boards", async () => {
    renderStart({
      list: {
        engines: [{ id: "prod-a", dialect: "c7" }],
        boards: [{ id: "x", title: "X", engines: ["prod-a"] }],
      },
    })
    await waitFor(() => expect(rowsOf("Engines")[0]?.[3]).toBe("3"))
    expect(screen.queryByRole("heading", { name: "What runs where" })).toBeNull()
    cleanup()
    renderStart({ list: { ...LIST, boards: [], refusedBoards: [] } })
    await loaded()
    expect(screen.queryByRole("heading", { name: "Boards" })).toBeNull()
  })

  it("says what runs where is read while an engine still reads, its skeleton only after 400 ms", async () => {
    let answer: (value: unknown) => void = () => {}
    renderStart({
      answers: {
        ...ANSWERS,
        "c8-eu": () =>
          new Promise((resolve) => {
            answer = resolve
          }),
      },
    })
    await waitFor(() => expect(rowsOf("Engines")[0]?.[3]).toBe("3"))
    const status = within(sectionOf("What runs where")).getByRole("status")
    expect(status.textContent).toBe("Reading the processes of every engine…")
    expect(status.getAttribute("data-skeleton")).toBe("false")
    await waitFor(() => expect(status.getAttribute("data-skeleton")).toBe("true"), {
      timeout: 1_000,
    })
    await act(async () => {
      answer({ ...CLUSTER, webApp: null })
    })
    await waitFor(() =>
      expect(screen.getByRole("table", { name: "Processes by engine" })).toBeTruthy(),
    )
  })

  it("shows no table of what runs where where no engine could be read", async () => {
    renderStart({ list: { engines: [{ id: "down", dialect: "c7" }], refused: LIST.refused } })
    expect(await screen.findByText("down couldn't be read")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "What runs where" })).toBeNull()
  })

  it("gives its place to the one engine of a server without boards, reading nothing itself", async () => {
    const { replace, reads } = renderStart({ list: { engines: [{ id: "solo", dialect: "c8" }] } })
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/engines/solo"))
    expect(reads()).toEqual([])
    expect(screen.queryByRole("table", { name: "Engines" })).toBeNull()
  })

  it("decides the one engine on the engine list: a refused profile alone too, never beside a board", () => {
    expect(onlyEngineOf({ refused: [{ id: "legacy" }] })).toBe("legacy")
    expect(
      onlyEngineOf({ engines: [{ id: "solo" }], refusedBoards: [{ id: "b", problems: 1 }] }),
    ).toBeUndefined()
    expect(onlyEngineOf({ engines: [{ id: "a" }, { id: "b" }] })).toBeUndefined()
    expect(onlyEngineOf({})).toBeUndefined()
  })

  it("takes an engine whose read has not started as pending, and one retrying as failed so far", async () => {
    const read = readOf("slow", undefined)
    expect(read).toMatchObject({ engine: "slow", screen: undefined, error: null, pending: true })
    await expect(read.refetch()).resolves.toBeUndefined()
    const failure = new Error("[unreachable] connection to engine down failed")
    const retrying = readOf("down", {
      data: undefined,
      error: null,
      failureReason: failure,
      isPending: true,
      isFetching: true,
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
      refetch: () => Promise.resolve(),
    })
    expect(retrying).toMatchObject({ error: failure, pending: true, readAt: 0 })
  })

  it("reads every engine and the engine list again on its Refresh, the refused profile never", async () => {
    let failing = true
    const { reads, verdictReads, lists } = renderStart({
      answers: {
        ...ANSWERS,
        down: () =>
          failing
            ? refusal("[unreachable] connection to engine down failed (engine down)")
            : worldOn("down"),
      },
    })
    await loaded()
    failing = false
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(rowsOf("Engines")[1]?.[3]).toBe("3"))
    expect(screen.queryByText("down couldn't be read")).toBeNull()
    expect(
      reads()
        .map(({ engine }) => engine)
        .sort(),
    ).toEqual(["c8-eu", "c8-eu", "down", "down", "prod-a", "prod-a"].sort())
    // Each Camunda 7 engine's verdict with it.
    await waitFor(() => expect(verdictReads()).toHaveLength(4))
    expect(lists()).toHaveLength(2)
  })

  it("keeps an engine's figures where its refresh failed, and says so", async () => {
    let calls = 0
    renderStart({
      answers: {
        ...ANSWERS,
        "prod-a": () =>
          calls++ === 0
            ? worldOn("prod-a")
            : refusal("[unreachable] connection to engine prod-a failed"),
      },
    })
    await loaded()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    const strip = (await screen.findByText("prod-a couldn't be read")).closest<HTMLElement>(
      "[data-slot=status-strip]",
    )!
    expect(strip.textContent).toContain("You're seeing the last loaded state.")
    expect(rowsOf("Engines")[0]?.[3]).toBe("3")
  })

  it("says the engines couldn't be loaded where the list fails, and reads them again on Try again", async () => {
    let fail = true
    renderStart({
      list: () => (fail ? refusal("[unreachable] connection to engine prod-a failed") : LIST),
    })
    const alert = await screen.findByRole("alert")
    fail = false
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    await loaded()
  })

  it("leaves a page's ended session to the frame's notice: no strip says it", async () => {
    renderStart({
      answers: {
        ...ANSWERS,
        down: () => {
          throw new WebApiError(401, { code: "signed_out", message: "No session." })
        },
      },
    })
    await loaded()
    expect(screen.queryByText("down couldn't be read")).toBeNull()
    expect(rowsOf("Engines")[1]?.[0]).toBe("downnot read")
    // A quiet row without a tone: the engine did not fail, no call reached it.
    const cell = screen
      .getByRole("row", { name: "Engine down" })
      .querySelector<HTMLElement>('[data-part="engine"]')
    expect(cell?.getAttribute("data-state")).toBe("unread")
  })

  it("speaks German on a German page", async () => {
    renderStart({ locale: "de" })
    expect(await screen.findByRole("heading", { level: 1, name: "Alle Engines" })).toBeTruthy()
    expect(await screen.findByText("4 Engines · 1 abgelehnt")).toBeTruthy()
    await waitFor(() => expect(rowsOf("Engines")[2]?.[2]).toBe("Camunda 8.10.9"))
    expect(screen.getByText("down konnte nicht gelesen werden")).toBeTruthy()
    expect(sectionOf("Was wo läuft")).toBeTruthy()
    expect(sectionOf("Boards").textContent).toContain("broken · Datei abgelehnt: 2 Probleme")
    expect(screen.getByRole("columnheader", { name: "Zustand" })).toBeTruthy()
    await waitFor(() => expect(rowsOf("Engines")[0]?.[1]).toBe("Beeinträchtigt"))
  })
})

describe("the reader's return to the start page", () => {
  const FIRST_READ = new Date("2026-11-19T09:00:00Z").getTime()

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(FIRST_READ)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** The tab's visibility as the browser says it. */
  function tabIs(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
  }

  /** An engine whose read met a refusal no retry changes: a page's ended session. */
  const AWAY = {
    list: { ...LIST, engines: [...LIST.engines, { id: "away", dialect: "c7" }] },
    answers: {
      ...ANSWERS,
      away: () => {
        throw new WebApiError(401, { code: "signed_out", message: "No session." })
      },
    },
  }

  it("reads every engine again when the window has focus after 60 s, never before, a refusal no retry changes never", async () => {
    const { reads } = renderStart(AWAY)
    await waitFor(() => expect(rowsOf("Engines")[3]?.[0]).toBe("awaynot read"))
    await loaded()
    expect(reads()).toHaveLength(4)
    vi.setSystemTime(FIRST_READ + 59_000)
    await act(async () => {
      fireEvent.focus(window)
    })
    expect(reads()).toHaveLength(4)
    vi.setSystemTime(FIRST_READ + 61_000)
    await act(async () => {
      fireEvent.focus(window)
    })
    await waitFor(() => expect(reads()).toHaveLength(7))
    expect(
      reads()
        .slice(4)
        .map(({ engine }) => engine)
        .sort(),
    ).toEqual(["c8-eu", "down", "prod-a"])
  })

  it("reads each engine once for a return that focuses the window and shows the tab", async () => {
    const { reads } = renderStart()
    await loaded()
    expect(reads()).toHaveLength(3)
    tabIs("visible")
    vi.setSystemTime(FIRST_READ + 61_000)
    await act(async () => {
      fireEvent.focus(window)
      fireEvent(document, new Event("visibilitychange"))
    })
    await waitFor(() => expect(reads()).toHaveLength(6))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(reads()).toHaveLength(6)
  })
})
