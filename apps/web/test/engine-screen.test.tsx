// @vitest-environment happy-dom
import { useState } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TestViewHost, WebApiError, type HostAction } from "@miragon/pulse-widget-shell/widgets"
import type { ProcessFilterData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { EngineRoute } from "../src/screens/engine/engine-route.js"
import { EngineScreen } from "../src/screens/engine/engine-screen.js"
import { ENGINE_SCREEN_FEED } from "../src/screens/engine/engine-feed.js"
import { usePageSlots } from "../src/screens/slots.js"

/**
 * The web app's engine screen over the kit world's screen (WORLD_SCREENS of
 * @miragon/pulse-screens/testing, the numbers the editors' engine tab shows of the same world and
 * the server's feed builds of the recorded engines: packages/connectors/engine/engine-connector/
 * src/data/screens/screen-data.numbers.test.ts): its bar, its rows and scopes in English and
 * German, a row's link and copy, the Refresh, a read when the reader comes back after 60 s, its
 * states and the engines it leaves to the cockpit.
 */

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
})

afterEach(cleanup)

const WEB_APP = { url: "https://ops.example/camunda/app/cockpit/default", vendor: "CIB seven" }

/** The feed's answer for `engine`: the world's screen under its name, with its web app. */
const answer = (engine = "prod", webApp: typeof WEB_APP | null = WEB_APP) => ({
  ...WORLD_SCREENS.engine,
  engine,
  webApp,
})

/** A refusal of the server as the feed's result says it. */
const refusal = (text: string) => ({ isError: true, content: [{ type: "text", text }] })

/** The screen as the page holds it: its filter the page's, which each pick sets anew. */
function Filtered({
  first,
  onFilter,
  ...props
}: {
  first: ProcessFilterData
  onFilter: (filter: ProcessFilterData) => void
  navigate: (url: string) => void
  ready: boolean
}) {
  const [filter, setFilter] = useState(first)
  return (
    <EngineScreen
      engine="prod"
      filter={filter}
      onFilter={(next) => {
        onFilter(next)
        setFilter(next)
      }}
      {...props}
    />
  )
}

function renderScreen({
  feed = answer(),
  locale = "en",
  navigate = vi.fn<(url: string) => void>(),
  filter = { scope: "all" },
  ready = true,
}: {
  feed?: unknown
  locale?: string
  navigate?: (url: string) => void
  filter?: ProcessFilterData
  ready?: boolean
} = {}) {
  const actions: HostAction[] = []
  const onFilter = vi.fn<(filter: ProcessFilterData) => void>()
  render(
    <TestViewHost
      tools={{ [ENGINE_SCREEN_FEED]: feed }}
      onHostAction={(action) => actions.push(action)}
      locale={locale}
      host={{ timeZone: "UTC" }}
      writes={false}
      followUp="none"
      startPage="/app"
    >
      <Filtered first={filter} onFilter={onFilter} navigate={navigate} ready={ready} />
    </TestViewHost>,
  )
  const reads = () =>
    actions.filter((action) => action.type === "callTool" && action.name === ENGINE_SCREEN_FEED)
  return { navigate, reads, onFilter }
}

/**
 * Every row of the process table as its cells show it, the columns a narrow region drops too
 * (happy-dom runs no container query, so they stay dropped here).
 */
const rows = () =>
  Array.from(screen.getByRole("table", { name: /Process/ }).querySelectorAll("tbody > tr"), (row) =>
    Array.from(row.querySelectorAll("td"), (cell) => cell.textContent),
  )

describe("the engine screen", () => {
  it("heads the page with the engine, its product, its Refresh, its web app and when it was read", async () => {
    renderScreen()
    const heading = await screen.findByRole("heading", { level: 1, name: "prod" })
    const bar = heading.closest<HTMLElement>("[data-slot=view-bar]")!
    expect(await within(bar).findByText("Fake engine 1.0.0")).toBeTruthy()
    expect(within(bar).getByRole("button", { name: "Refresh" })).toBeTruthy()
    const link = within(bar).getByRole("link", { name: /Open in CIB seven/ })
    expect(link.getAttribute("href")).toBe(WEB_APP.url)
    const stamp = bar.querySelector("[data-slot=freshness-stamp]")
    expect(stamp?.textContent).toMatch(/^As of Nov 19, 0?9:00/)
  })

  it("shows each process with the numbers of the kit's world, over every version", async () => {
    renderScreen()
    await screen.findByRole("table", { name: "Processes" })
    expect(rows()).toEqual([
      ["Order fulfillment pulse-order", "v2", "3", "1Has open incidents"],
      ["Dispatch order pulse-dispatch", "v1", "1", "1Has open incidents"],
      ["Print label pulse-label", "v1", "1", "1Has open incidents"],
    ])
    expect(
      screen.getByText("3 processes · 5 running · 3 with incident · all versions"),
    ).toBeTruthy()
  })

  it("speaks German where the page does, the same numbers", async () => {
    renderScreen({ locale: "de" })
    const table = await screen.findByRole("table", { name: "Prozesse" })
    const heads = Array.from(table.querySelectorAll("th"), (head) => head.textContent)
    expect(heads).toEqual(["Prozess", "Neueste Version", "Laufend", "Mit Incident"])
    expect(
      screen.getByText("3 Prozesse · 5 laufend · 3 mit Incident · alle Versionen"),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeTruthy()
  })

  it("filters by scope and search in the browser, reading nothing again", async () => {
    const { reads, onFilter } = renderScreen()
    await screen.findByRole("table", { name: "Processes" })
    const search = screen.getByRole("searchbox", { name: "Search by name or BPMN process ID" })
    fireEvent.change(search, { target: { value: "label" } })
    fireEvent.keyDown(search, { key: "Enter" })
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0][0]).toBe("Print label pulse-label")
    expect(onFilter).toHaveBeenLastCalledWith({ scope: "all", search: "label" })
    fireEvent.change(search, { target: { value: "nothing like it" } })
    fireEvent.keyDown(search, { key: "Enter" })
    expect(await screen.findByText("No processes match this filter.")).toBeTruthy()
    expect(reads()).toHaveLength(1)
  })

  it("shows the filter the page's address names, and asks the page for each pick", async () => {
    const { onFilter } = renderScreen({ filter: { scope: "withIncident", search: "order" } })
    await screen.findByRole("table", { name: "Processes" })
    expect(rows().map((row) => row[0])).toEqual([
      "Order fulfillment pulse-order",
      "Dispatch order pulse-dispatch",
    ])
    const scope = screen.getByRole("radio", { name: /^With incident/ })
    expect(scope.getAttribute("aria-checked")).toBe("true")
    expect(
      screen.getByRole<HTMLInputElement>("searchbox", {
        name: "Search by name or BPMN process ID",
      }).value,
    ).toBe("order")
    fireEvent.click(screen.getByRole("radio", { name: /^All/ }))
    expect(onFilter).toHaveBeenLastCalledWith({ scope: "all", search: "order" })
  })

  it("opens a process from its row, a link to its address, and copies its BPMN process ID", async () => {
    const { navigate } = renderScreen()
    const row = await screen.findByRole("row", { name: "Process Order fulfillment" })
    expect(row.dataset.href).toBe("/app/engines/prod/processes/pulse-order")
    fireEvent.click(within(row).getByText("v2"))
    expect(navigate).toHaveBeenCalledWith("/app/engines/prod/processes/pulse-order")
    fireEvent.keyDown(row, { key: "c", ctrlKey: true })
    expect(await screen.findByText("BPMN process ID copied")).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("pulse-order")
  })

  it("reads again on Refresh, the numbers on screen while it reads", async () => {
    const { reads } = renderScreen()
    await screen.findByRole("table", { name: "Processes" })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    await waitFor(() => expect(reads()).toHaveLength(2))
    expect(screen.getByRole("table", { name: "Processes" })).toBeTruthy()
  })

  it("says an engine without a product an em dash, and offers no web app it does not know", async () => {
    renderScreen({ feed: { ...answer("prod", null), info: null } })
    const bar = (
      await screen.findByRole("heading", { level: 1, name: "prod" })
    ).closest<HTMLElement>("[data-slot=view-bar]")!
    expect(await within(bar).findByText("—")).toBeTruthy()
    expect(within(bar).getByText("The engine didn't say what it is")).toBeTruthy()
    expect(within(bar).queryByRole("link")).toBeNull()
  })

  it("says an engine that lists no process, whatever the search", async () => {
    renderScreen({
      feed: { ...answer(), processes: [], totals: { processes: 0, running: 0, withIncident: 0 } },
    })
    expect(
      await screen.findByText(
        "No processes deployed on prod, or you may not have permission to see them.",
      ),
    ).toBeTruthy()
  })

  it("words a refused profile itself, with no Try again, under its bar", async () => {
    renderScreen({
      feed: refusal(
        '[ENGINE_PROFILE_REFUSED] Engine "prod" was refused: auth.tokenEnv names no variable.',
      ),
    })
    expect(await screen.findByRole("heading", { level: 1, name: "prod" })).toBeTruthy()
    const alert = await screen.findByRole("alert")
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("words an engine whose dialect the server does not read, with no Try again", async () => {
    renderScreen({
      feed: refusal('[ENGINE_DIALECT_NOT_SERVED] Engine "prod" is a Camunda 8 engine.'),
    })
    const alert = await screen.findByRole("alert")
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("says a Camunda 8 cluster below the version Pulse reads, with its fix, and reads it again on Try again", async () => {
    const { reads } = renderScreen({
      feed: refusal(
        "[misconfigured] Pulse reads Camunda 8.9 or newer. This cluster runs 8.8.12. (engine prod)",
      ),
    })
    const alert = await screen.findByRole("alert")
    expect(
      within(alert).getByRole("heading", { name: "Pulse reads Camunda 8.9 or newer" }),
    ).toBeTruthy()
    expect(
      within(alert).getByText(
        "The cluster of prod is on Camunda 8.8.12. Ask whoever runs it to update it to 8.9 or newer.",
      ),
    ).toBeTruthy()
    await act(async () => fireEvent.click(within(alert).getByRole("button", { name: "Try again" })))
    await waitFor(() => expect(reads()).toHaveLength(2))
  })

  it("says a Camunda 8 cluster without secondary storage, with the board's hint, in German too", async () => {
    renderScreen({
      locale: "de",
      feed: refusal(
        "[misconfigured] This cluster runs without secondary storage, so Pulse has nothing to read. (engine prod) Pulse reads the cluster's search API, which needs secondary storage such as Elasticsearch, OpenSearch or a relational database.",
      ),
    })
    const alert = await screen.findByRole("alert")
    expect(
      within(alert).getByRole("heading", {
        name: "Der Cluster von prod hat keinen Sekundärspeicher",
      }),
    ).toBeTruthy()
    expect(
      within(alert).getByText(
        "Pulse liest die Such-API des Clusters, und die braucht einen Sekundärspeicher wie Elasticsearch, OpenSearch oder eine relationale Datenbank. Bitte die Person, die den Cluster betreibt, einen einzurichten.",
      ),
    ).toBeTruthy()
  })

  it("words a Camunda 8 token endpoint's refusal as a refused login, as Camunda 7's", async () => {
    renderScreen({
      feed: refusal(
        "[unauthorized] the token endpoint refused the client: unauthorized_client (engine prod) Check auth.clientId in the engine's profile.",
      ),
    })
    const alert = await screen.findByRole("alert")
    expect(
      within(alert).getByRole("heading", { name: "Engine prod rejected the server's credentials" }),
    ).toBeTruthy()
  })

  it("words an unreachable engine with Try again, which reads it again", async () => {
    const { reads } = renderScreen({
      feed: refusal("[unreachable] connection to engine prod failed: ECONNREFUSED (engine prod)"),
    })
    const alert = await screen.findByRole("alert")
    const retry = within(alert).getByRole("button", { name: "Try again" })
    await act(async () => fireEvent.click(retry))
    await waitFor(() => expect(reads()).toHaveLength(2))
  })
})

describe("a refresh that fails over the numbers on screen", () => {
  /** A feed that answers the screen first, then `next` (a result, or a thrown failure). */
  const thenFails = (next: () => unknown) => {
    let calls = 0
    return () => {
      calls += 1
      return calls === 1 ? answer() : next()
    }
  }

  it("says so under the bar, keeps the rows, and Try again reads again", async () => {
    const { reads } = renderScreen({
      feed: thenFails(() =>
        refusal("[unreachable] connection to engine prod failed (engine prod)"),
      ),
    })
    await screen.findByRole("table", { name: "Processes" })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    expect(await screen.findByText("Couldn't refresh this view")).toBeTruthy()
    expect(screen.getByText(/You're seeing the last loaded state\.$/)).toBeTruthy()
    expect(screen.getByRole("table", { name: "Processes" })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })))
    await waitFor(() => expect(reads()).toHaveLength(3))
  })

  it.each([
    [
      "en",
      "Couldn't refresh this view",
      "Pulse reads Camunda 8.9 or newer. The cluster of prod is on Camunda 8.8.0. Ask whoever runs it to update it to 8.9 or newer. You're seeing the last loaded state.",
    ],
    [
      "de",
      "Die Ansicht konnte nicht aktualisiert werden",
      "Pulse liest Camunda 8.9 oder neuer. Der Cluster von prod läuft auf Camunda 8.8.0. Bitte die Person, die ihn betreibt, ihn auf 8.9 oder neuer zu aktualisieren. Du siehst den zuletzt geladenen Stand.",
    ],
  ] as const)(
    "%s: says a Camunda 8 cluster's problem with its fix over the rows on screen",
    async (locale, title, detail) => {
      renderScreen({
        locale,
        feed: thenFails(() =>
          refusal(
            "[misconfigured] Pulse reads Camunda 8.9 or newer. This cluster runs 8.8.0. (engine prod)",
          ),
        ),
      })
      await screen.findByRole("table")
      await act(async () =>
        fireEvent.click(
          screen.getByRole("button", { name: locale === "de" ? "Aktualisieren" : "Refresh" }),
        ),
      )
      expect(await screen.findByText(title)).toBeTruthy()
      expect(screen.getByText(detail)).toBeTruthy()
      expect(screen.getByRole("table")).toBeTruthy()
    },
  )

  it("keeps its Refresh in place while it reads, a second click reading nothing", async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const { reads } = renderScreen({
      feed: thenFails(async () => {
        await held
        return answer()
      }),
    })
    await screen.findByRole("table", { name: "Processes" })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    const busy = await screen.findByRole("button", { name: "Refreshing…" })
    expect(busy.getAttribute("aria-disabled")).toBe("true")
    await act(async () => fireEvent.click(busy))
    expect(reads()).toHaveLength(2)
    await act(async () => release?.())
    expect(await screen.findByRole("button", { name: "Refresh" })).toBeTruthy()
  })

  it("says a failure without words of its own in the kit's words, with nothing under Details", async () => {
    renderScreen({
      feed: thenFails(() => {
        throw new Error("")
      }),
    })
    await screen.findByRole("table", { name: "Processes" })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    const strip = (await screen.findByText("Couldn't refresh this view")).closest<HTMLElement>(
      "[role=status],[role=alert]",
    )
    expect(strip).not.toBeNull()
    expect(within(strip as HTMLElement).queryByText("Details")).toBeNull()
  })

  it("offers no Try again for a refusal no retry changes", async () => {
    renderScreen({
      feed: thenFails(() =>
        refusal(
          '[ENGINE_PROFILE_REFUSED] Engine "prod" was refused: auth.tokenEnv names no variable.',
        ),
      ),
    })
    await screen.findByRole("table", { name: "Processes" })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    expect(await screen.findByText("Couldn't refresh this view")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("leaves a page's ended session to the frame's notice: no strip, the rows kept", async () => {
    const { reads } = renderScreen({
      feed: thenFails(() => {
        throw new WebApiError(401, { code: "signed_out", message: "No session." })
      }),
    })
    await screen.findByRole("table", { name: "Processes" })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    await waitFor(() => expect(reads()).toHaveLength(2))
    expect(screen.queryByText("Couldn't refresh this view")).toBeNull()
    expect(screen.getByRole("table", { name: "Processes" })).toBeTruthy()
  })
})

describe("the reader's return to the page", () => {
  const FIRST_READ = new Date("2026-11-19T09:00:00Z").getTime()

  beforeEach(() => {
    // Only the clock: the reads, their retries and the test's waits keep real timers.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(FIRST_READ)
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, "visibilityState")
  })

  /** `seconds` after the first read, the window gets focus again (and, with `tab`, the tab shows). */
  async function returnAfter(seconds: number, { tab = false } = {}) {
    vi.setSystemTime(FIRST_READ + seconds * 1000)
    await act(async () => {
      fireEvent.focus(window)
      if (tab) fireEvent(document, new Event("visibilitychange"))
    })
  }

  /** The tab's visibility as the browser says it. */
  function tabIs(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
  }

  it("reads again when the window has focus after 60 s, never before", async () => {
    const { reads } = renderScreen()
    await screen.findByRole("table", { name: "Processes" })
    await returnAfter(59)
    expect(reads()).toHaveLength(1)
    await returnAfter(61)
    await waitFor(() => expect(reads()).toHaveLength(2))
    // The numbers stay on screen while it reads.
    expect(screen.getByRole("table", { name: "Processes" })).toBeTruthy()
  })

  it("reads once for a return that focuses the window and shows the tab", async () => {
    const { reads } = renderScreen()
    await screen.findByRole("table", { name: "Processes" })
    tabIs("visible")
    await returnAfter(61, { tab: true })
    await waitFor(() => expect(reads()).toHaveLength(2))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(reads()).toHaveLength(2)
  })

  it("reads again when its tab shows after 60 s, and nothing while it is hidden", async () => {
    const { reads } = renderScreen()
    await screen.findByRole("table", { name: "Processes" })
    vi.setSystemTime(FIRST_READ + 120_000)
    tabIs("hidden")
    await act(async () => {
      fireEvent(document, new Event("visibilitychange"))
    })
    expect(reads()).toHaveLength(1)
    tabIs("visible")
    await act(async () => {
      fireEvent(document, new Event("visibilitychange"))
    })
    await waitFor(() => expect(reads()).toHaveLength(2))
  })

  it("reads a failure again that a retry may change", async () => {
    const { reads } = renderScreen({
      feed: refusal("[unreachable] connection to engine prod failed (engine prod)"),
    })
    await screen.findByRole("alert")
    await returnAfter(61)
    await waitFor(() => expect(reads()).toHaveLength(2))
  })

  it("never reads a refusal again that no retry changes", async () => {
    const { reads } = renderScreen({
      feed: refusal(
        '[ENGINE_PROFILE_REFUSED] Engine "prod" was refused: auth.tokenEnv names no variable.',
      ),
    })
    await screen.findByRole("alert")
    await returnAfter(61)
    expect(reads()).toHaveLength(1)
  })

  it("reads nothing on a return before the screen reads", async () => {
    const { reads } = renderScreen({ ready: false })
    await returnAfter(61)
    expect(reads()).toHaveLength(0)
  })
})

describe("the page's slots of a screen", () => {
  it("link an engine's processes, a process, a version and an instance to their addresses, and open them in the page", () => {
    const navigate = vi.fn<(url: string) => void>()
    const engine = { kind: "engine", engine: "prod a" } as const
    const process = { kind: "process", engine: "prod", bpmnProcessId: "order" } as const
    const version = {
      kind: "version",
      engine: "prod",
      bpmnProcessId: "order",
      version: 7,
      definitionId: "order:7:4a1c",
    } as const
    const instance = { kind: "instance", engine: "prod", instanceId: "8f3c/2a1e" } as const
    function Probe() {
      const slots = usePageSlots(navigate)
      return (
        <>
          <p data-testid="engine">{slots.linkOf?.(engine)}</p>
          <p data-testid="process">{slots.linkOf?.(process)}</p>
          <p data-testid="version">{slots.linkOf?.(version)}</p>
          <p data-testid="instance">{slots.linkOf?.(instance)}</p>
          <button
            type="button"
            onClick={() => {
              slots.onOpen(engine, { toSide: false })
            }}
          >
            Open
          </button>
        </>
      )
    }
    render(<Probe />)
    expect(screen.getByTestId("engine").textContent).toBe("/app/engines/prod%20a")
    expect(screen.getByTestId("process").textContent).toBe("/app/engines/prod/processes/order")
    // A version is the process screen at its number, a new subject of the page's history.
    expect(screen.getByTestId("version").textContent).toBe(
      "/app/engines/prod/processes/order?version=7",
    )
    expect(screen.getByTestId("instance").textContent).toBe(
      "/app/engines/prod/instances/8f3c%2F2a1e",
    )
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    expect(navigate).toHaveBeenCalledWith("/app/engines/prod%20a")
  })
})

describe("the engine's own address", () => {
  const LIST = {
    engines: [
      { id: "prod", environment: "default", dialect: "c7" },
      { id: "orders", environment: "default", dialect: "c8" },
    ],
    refused: [{ id: "legacy", reason: "no url" }],
  }

  function renderRoute(engine: string, list: unknown = LIST) {
    const actions: HostAction[] = []
    render(
      <TestViewHost
        tools={{ engine_list_engines: list, [ENGINE_SCREEN_FEED]: answer(engine) }}
        onHostAction={(action) => actions.push(action)}
      >
        <EngineRoute
          engine={engine}
          navigate={vi.fn()}
          filter={{ scope: "all" }}
          onFilter={vi.fn()}
          fallback={<p data-testid="cockpit">the cockpit</p>}
        />
      </TestViewHost>,
    )
    return () => actions.flatMap((action) => (action.type === "callTool" ? [action.name] : []))
  }

  it("shows the screen of a Camunda 7 engine the list names", async () => {
    const calls = renderRoute("prod")
    expect(await screen.findByRole("table", { name: "Processes" })).toBeTruthy()
    expect(calls()).toEqual(["engine_list_engines", ENGINE_SCREEN_FEED])
    expect(screen.queryByText("Incidents and jobs show at their instances")).toBeNull()
  })

  it("shows the screen of a Camunda 8 engine, which says where its incidents show", async () => {
    const calls = renderRoute("orders")
    expect(await screen.findByRole("table", { name: "Processes" })).toBeTruthy()
    expect(calls()).toEqual(["engine_list_engines", ENGINE_SCREEN_FEED])
    const strip = screen
      .getByText("Incidents and jobs show at their instances")
      .closest("[role=status]")
    expect(strip?.textContent).toContain("Open a process, then an instance.")
    expect(screen.queryByTestId("cockpit")).toBeNull()
  })

  it.each([
    ["a refused profile", "legacy"],
    ["an engine the server does not configure", "nowhere"],
  ])("leaves %s to the cockpit's one state, and reads nothing of it", async (_name, engine) => {
    const calls = renderRoute(engine)
    expect(await screen.findByTestId("cockpit")).toBeTruthy()
    expect(calls()).toEqual(["engine_list_engines"])
  })

  it("names the engine in the screen's bar while the list is read, and shows the screen where it fails", async () => {
    const calls = renderRoute("prod", refusal("Input validation error: no list"))
    expect(screen.getByRole("heading", { level: 1, name: "prod" })).toBeTruthy()
    // Before it reads: no Refresh that could read an engine the screen may not serve.
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull()
    expect(await screen.findByRole("table", { name: "Processes" })).toBeTruthy()
    expect(calls()).toEqual(["engine_list_engines", ENGINE_SCREEN_FEED])
  })
})
