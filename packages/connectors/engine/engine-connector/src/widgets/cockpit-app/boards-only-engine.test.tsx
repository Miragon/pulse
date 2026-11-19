// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  TestViewHost,
  createTestQueryClient,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"
import {
  ENGINE_BOARD_DATA,
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_HEALTH_DATA,
  ENGINE_JOB_BACKLOG_DATA,
  ENGINE_LIST_ENGINES,
} from "../../tool-names.js"
import type { CockpitAppData, CockpitEngineInfo } from "../../view-models.js"
import { BOARD } from "../board/board.test-support.js"
import { CockpitApp } from "./app.js"

afterEach(cleanup)

/**
 * An engine of another dialect (Camunda 8), which the server reads on boards only: the start data
 * and the engine list name its dialect, its web app and the boards that name it. Each of its
 * routes is ONE state that reads nothing, its landing row reads nothing and shows no verdict, and
 * the cross-engine view leaves it out and names it.
 */

const C7 = { id: "prod-a", environment: "default", dialect: "c7" } as const
const ON_BOARDS: CockpitEngineInfo = {
  id: "orders-c8",
  environment: "default",
  dialect: "c8",
  webAppUrl: "https://operate.example/operate",
  boards: ["invoices"],
}
const ON_NO_BOARD: CockpitEngineInfo = { id: "orders-c8", environment: "default", dialect: "c8" }

interface Board {
  id: string
  title: string
  engines: string[]
}

/** The server's one board: it names prod-a and every engine whose start data says it does. */
const invoicesOver = (engines: readonly CockpitEngineInfo[]): Board => ({
  id: "invoices",
  title: "Invoices",
  engines: [
    "prod-a",
    ...engines.filter(({ boards }) => boards?.includes("invoices")).map(({ id }) => id),
  ],
})

/** An engine as engine_list_engines names it: its dialect, and its web app as written. */
const listedOf = ({ id, environment, dialect, webAppUrl }: CockpitEngineInfo) => ({
  id,
  environment,
  ...(dialect === undefined ? {} : { dialect }),
  ...(webAppUrl === undefined ? {} : { cockpitUrl: webAppUrl }),
})

/** Stable: the test host memoizes on it. Fullscreen shows the head and the trail apart. */
const FULLSCREEN = { displayMode: "fullscreen" } as const
const INLINE = { displayMode: "inline" } as const

const overviewOf = (args: Record<string, unknown>) => ({
  summary: { totalDefinitions: 1, totalRunningInstances: 3, totalFailedJobs: 0, totalIncidents: 0 },
  definitions: [],
  engineId: args.engine,
})

/**
 * The cockpit over `engines` as `engine_open_cockpit` hands them over (`started`: the start data
 * names only those), its engine list naming each with its dialect and web app, as the server's
 * does.
 */
function renderCockpit({
  engines,
  started = engines,
  engineId = null,
  boards = [invoicesOver(engines)],
  locale,
  host = FULLSCREEN,
}: {
  engines: CockpitEngineInfo[]
  started?: CockpitEngineInfo[]
  engineId?: string | null
  boards?: Board[]
  locale?: string
  host?: typeof FULLSCREEN | typeof INLINE
}) {
  const actions: HostAction[] = []
  const contexts: string[] = []
  const data: CockpitAppData = { engineId, engines: started, start: null }
  render(
    <TestViewHost
      client={createTestQueryClient()}
      host={host}
      locale={locale}
      onHostAction={(action) => actions.push(action)}
      onModelContext={(text) => contexts.push(text)}
      tools={{
        [ENGINE_LIST_ENGINES]: () => ({
          engines: engines.map(listedOf),
          environments: [],
          defaultEngineId: null,
          ...(boards.length > 0 ? { boards } : {}),
        }),
        [ENGINE_COCKPIT_OVERVIEW_DATA]: overviewOf,
        [ENGINE_HEALTH_DATA]: (args: Record<string, unknown>) => ({
          status: "ok",
          statusRule: "ok",
          summary: { totalIncidents: 0 },
          clusters: [],
          fetchedAt: "2026-06-11T14:05:00.000Z",
          engineId: args.engine,
        }),
        [ENGINE_JOB_BACKLOG_DATA]: (args: Record<string, unknown>) => ({
          executableJobs: 0,
          suspendedJobs: 0,
          jobsDueLater: 0,
          externalTasks: 0,
          engineId: args.engine,
        }),
        [ENGINE_BOARD_DATA]: () => BOARD,
      }}
    >
      <CockpitApp data={data} />
    </TestViewHost>,
  )
  /** Every tool call that named the engine. */
  const readsOf = (engine: string) =>
    actions.filter((a) => a.type === "callTool" && a.args.engine === engine)
  return { actions, contexts, readsOf }
}

const gate = () => document.querySelector<HTMLElement>("[data-slot='boards-only-engine']")
const landingRow = (name: RegExp) => screen.findByRole("button", { name })

describe("an engine the server reads on boards only: its routes' one state", () => {
  it("names the boards that show it, each a way in, its web app and the way back, reading nothing", async () => {
    const { contexts, readsOf } = renderCockpit({ engines: [C7, ON_BOARDS] })
    fireEvent.click(await screen.findByRole("button", { name: /^orders-c8\b/ }))
    // The route's one heading at the top, as a route's view bar's title is.
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "orders-c8 is a Camunda 8 engine",
    ])
    expect(screen.getByText("Pulse shows it here on boards: open one that names it.")).toBeTruthy()
    const boards = screen.getByRole("list", { name: "Boards that name orders-c8" })
    expect(within(boards).getByRole("button", { name: /^Invoices\s*,\s*2 engines/ })).toBeTruthy()
    expect(screen.getByText("You can also open it in Operate.")).toBeTruthy()
    const operate = screen.getByRole("link", { name: /^Open in Operate/ })
    expect(operate.getAttribute("href")).toBe("https://operate.example/operate")
    // No section of the engine reads it: every read of it would be refused.
    expect(readsOf("orders-c8")).toEqual([])
    await waitFor(() => expect(contexts.at(-1)).toContain("boardsOnly=true"))
    expect(contexts.at(-1)).toContain('dialect="c8"')
    expect(contexts.at(-1)).toContain('boards=["invoices"]')
    expect(contexts.at(-1)).not.toMatch(/engine_\w+/)
    fireEvent.click(within(boards).getByRole("button", { name: /^Invoices\b/ }))
    expect(await screen.findByRole("heading", { level: 1, name: "Invoices" })).toBeTruthy()
  })

  // No route of one engine serves its dialect (ROUTE_DIALECTS): the head offers none of its
  // sections, and its trail names the engine, never a view it has not.
  // The trail's first crumb is the one way back: the state offers no "All engines" of its own.
  it("shows once, with no section of an engine above it, and the trail's 'All engines' leads back to the chooser", async () => {
    const { readsOf } = renderCockpit({ engines: [C7, ON_BOARDS], engineId: "orders-c8" })
    expect(gate()).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Cockpit sections" })).toBeNull()
    for (const section of ["Overview", "Incidents", "Jobs"]) {
      expect(screen.queryByRole("button", { name: section }), section).toBeNull()
    }
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(
      within(trail)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["All engines"])
    expect(within(trail).getByText("orders-c8").getAttribute("aria-current")).toBe("page")
    expect(readsOf("orders-c8")).toEqual([])
    // The switcher to a Camunda 7 engine brings its sections back, and to this one the gate.
    fireEvent.change(screen.getByLabelText("Selected engine"), { target: { value: "prod-a" } })
    expect(screen.getByRole("navigation", { name: "Cockpit sections" })).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Selected engine"), { target: { value: "orders-c8" } })
    expect(gate()).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Cockpit sections" })).toBeNull()
    expect(readsOf("orders-c8")).toEqual([])
    expect(within(gate()!).queryByRole("button", { name: "All engines" })).toBeNull()
    expect(screen.getAllByRole("button", { name: "All engines" })).toHaveLength(1)
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("button", {
        name: "All engines",
      }),
    )
    expect(screen.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeTruthy()
  })

  it("inline too: its trail takes the head's row, with no section beside it", () => {
    renderCockpit({ engines: [C7, ON_BOARDS], engineId: "orders-c8", host: INLINE })
    expect(gate()).toBeTruthy()
    const head = document.querySelector<HTMLElement>("[data-slot='cockpit-head']")!
    const trail = within(head).getByRole("navigation", { name: "Breadcrumb" })
    expect(within(trail).getByRole("button", { name: "All engines" })).toBeTruthy()
    expect(within(gate()!).queryByRole("button", { name: "All engines" })).toBeNull()
    expect(document.querySelector("[data-slot='cockpit-trail']")).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Cockpit sections" })).toBeNull()
  })

  it("no board names it, no web app: it says so and that whoever runs the server adds one", async () => {
    const { contexts } = renderCockpit({ engines: [C7, ON_NO_BOARD], engineId: "orders-c8" })
    expect(gate()).toBeTruthy()
    expect(
      screen.getByText(
        "Pulse shows it here on boards only, and no board names it yet. Ask whoever runs this Pulse server to add one.",
      ),
    ).toBeTruthy()
    expect(screen.queryByRole("list", { name: /^Boards that name/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /Operate/ })).toBeNull()
    await waitFor(() => expect(contexts.at(-1)).toContain("boardCount=0"))
  })

  it("is known from the engine list alone, in a cockpit without start data", async () => {
    const { readsOf } = renderCockpit({ engines: [C7, ON_BOARDS], started: [] })
    const row = await landingRow(/^orders-c8\s*,\s*Camunda 8, on boards$/)
    fireEvent.click(row)
    expect(gate()).toBeTruthy()
    expect(screen.getByRole("link", { name: /^Open in Operate/ }).getAttribute("href")).toBe(
      "https://operate.example/operate",
    )
    expect(screen.getByRole("list", { name: "Boards that name orders-c8" })).toBeTruthy()
    expect(readsOf("orders-c8")).toEqual([])
  })

  // No chooser, so no trail takes the sections' place: the head's sections are the ones its
  // dialect is served by alone (ROUTE_DIALECTS), and a Camunda 8 engine has none.
  it.each([
    ["fullscreen", FULLSCREEN],
    ["inline", INLINE],
  ])(
    "alone on a server without boards, it opens at once with no section and no way back (%s)",
    (_mode, host) => {
      renderCockpit({ engines: [ON_NO_BOARD], boards: [], host })
      expect(gate()).toBeTruthy()
      const head = document.querySelector<HTMLElement>("[data-slot='cockpit-head']")!
      expect(within(head).queryByRole("navigation")).toBeNull()
      for (const section of ["Overview", "Incidents", "Jobs"]) {
        expect(within(head).queryByRole("button", { name: section }), section).toBeNull()
      }
      expect(within(gate()!).queryByRole("button")).toBeNull()
    },
  )

  it.each([
    [
      ON_BOARDS,
      "orders-c8 läuft auf Camunda 8",
      "Pulse zeigt sie hier auf Boards: Öffne eines, das sie nennt.",
    ],
    [
      ON_NO_BOARD,
      "orders-c8 läuft auf Camunda 8",
      "Pulse zeigt sie hier nur auf Boards, und noch kein Board nennt sie. Bitte die Person, die diesen Pulse-Server betreibt, eines anzulegen.",
    ],
  ])("speaks German on a German host: %#", (engine, title, description) => {
    renderCockpit({ engines: [C7, engine], engineId: "orders-c8", locale: "de" })
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy()
    expect(screen.getByText(description)).toBeTruthy()
    const trail = screen.getByRole("navigation", { name: "Navigationspfad" })
    expect(within(trail).getByRole("button", { name: "Alle Engines" })).toBeTruthy()
    expect(within(gate()!).queryByRole("button", { name: "Alle Engines" })).toBeNull()
    if (engine.webAppUrl) {
      expect(screen.getByText("Du kannst sie auch in Operate öffnen.")).toBeTruthy()
      expect(screen.getByRole("link", { name: /^In Operate öffnen/ })).toBeTruthy()
      expect(screen.getByRole("list", { name: "Boards, die orders-c8 nennen" })).toBeTruthy()
    }
  })
})

describe("an engine the server reads on boards only, on the landing", () => {
  it.each([
    [ON_BOARDS, "Camunda 8, on boards"],
    [ON_NO_BOARD, "Camunda 8, on no board yet"],
  ])("its row reads nothing and shows no verdict: %#", async (engine, status) => {
    const { readsOf } = renderCockpit({ engines: [C7, engine] })
    const row = await landingRow(new RegExp(`^orders-c8\\s*,\\s*${status}$`))
    expect(row.dataset.status).toBe("boardsOnly")
    // The Camunda 7 engine's row reads its health and shows its verdict; this one has none.
    const c7 = await landingRow(/^prod-a\s*,/)
    await waitFor(() => expect(c7.querySelector("[data-part='verdict']")).not.toBeNull())
    expect(row.querySelector("[data-part='verdict']")).toBeNull()
    expect(readsOf("orders-c8")).toEqual([])
  })

  it("its row speaks German on a German host", async () => {
    renderCockpit({ engines: [C7, ON_NO_BOARD], locale: "de" })
    expect(await landingRow(/^orders-c8\s*,\s*Camunda 8, noch auf keinem Board$/)).toBeTruthy()
  })

  it("the model hears it among the engines no other view reads", async () => {
    const { contexts } = renderCockpit({ engines: [C7, ON_BOARDS] })
    await waitFor(() => expect(contexts.at(-1)).toContain('boardsOnlyEngines=["orders-c8"]'))
  })
})

describe("an engine the server reads on boards only, in the cross-engine view", () => {
  it("is left out of its reads and sums, and named in one line", async () => {
    const second = { ...C7, id: "prod-b" }
    const billing = { ...ON_NO_BOARD, id: "billing-c8" }
    const { readsOf, contexts } = renderCockpit({ engines: [C7, second, ON_BOARDS, billing] })
    fireEvent.click(await screen.findByRole("button", { name: "Cross-engine overview" }))
    expect(screen.getByText("2 engines · prod-a, prod-b")).toBeTruthy()
    const line = document.querySelector<HTMLElement>("[data-slot='fleet-boards-only']")
    expect(line?.textContent).toBe(
      "Camunda 8 on boards only, not in this overview: orders-c8, billing-c8",
    )
    // Each id is a whole of its own, so the line wraps between ids, never at an id's hyphen.
    const ids = [...line!.querySelectorAll("[data-part='engine-id']")]
    expect(ids.map((id) => id.textContent)).toEqual(["orders-c8,", "billing-c8"])
    await waitFor(() => expect(readsOf("prod-b").length).toBeGreaterThan(0))
    expect(readsOf("orders-c8")).toEqual([])
    expect(readsOf("billing-c8")).toEqual([])
    await waitFor(() => expect(contexts.at(-1)).toContain('engine=["prod-a","prod-b"]'))
  })

  it("names them in German on a German host", async () => {
    renderCockpit({ engines: [C7, { ...C7, id: "prod-b" }, ON_BOARDS], locale: "de" })
    fireEvent.click(await screen.findByRole("button", { name: "Engine-übergreifende Übersicht" }))
    expect(document.querySelector("[data-slot='fleet-boards-only']")?.textContent).toBe(
      "Camunda 8 nur auf Boards, nicht in dieser Übersicht: orders-c8",
    )
  })

  it("is not offered beside one engine it would read alone", async () => {
    renderCockpit({ engines: [C7, ON_BOARDS] })
    await screen.findByRole("region", { name: "Engines" })
    expect(screen.queryByRole("button", { name: "Cross-engine overview" })).toBeNull()
  })
})
