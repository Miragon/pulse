// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  TestViewHost,
  createTestQueryClient,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_BOARD_DATA, ENGINE_BPMN_XML_DATA, ENGINE_LIST_ENGINES } from "../../tool-names.js"
import type { CockpitAppData, CockpitView } from "../../view-models.js"
import { BOARD, RUNNING_INSTANCE } from "../board/board.test-support.js"
import { CockpitApp } from "./app.js"

afterEach(cleanup)

const ENGINES = [
  { id: "prod-a", environment: "default" },
  { id: "prod-b", environment: "default" },
]

const BOARD_VIEW = { section: "board", board: "invoices" } as const satisfies CockpitView

/** The board as the engine list names it (ENGINE_BOARDS_DIR). */
const LISTED_BOARD = { id: "invoices", title: "Invoices", engines: ["prod-a", "down", "nowhere"] }

/** Stable: the test host memoizes on it. Fullscreen shows the head and the trail apart. */
const FULLSCREEN = { displayMode: "fullscreen" } as const

/**
 * The cockpit opened on the board by `engine_open_cockpit`: no engine resolved, the start the
 * board's data. The engines' own feeds have no fakes: a view of an engine reads and fails.
 */
function renderBoardCockpit(engines: CockpitAppData["engines"] = ENGINES) {
  const actions: HostAction[] = []
  const contexts: string[] = []
  const data: CockpitAppData = { engineId: null, engines, start: { view: BOARD_VIEW, data: BOARD } }
  render(
    <TestViewHost
      client={createTestQueryClient()}
      host={FULLSCREEN}
      onHostAction={(action) => actions.push(action)}
      onModelContext={(text) => contexts.push(text)}
      tools={{
        [ENGINE_LIST_ENGINES]: () => ({
          engines,
          environments: [],
          defaultEngineId: null,
          boards: [LISTED_BOARD],
        }),
        [ENGINE_BOARD_DATA]: () => BOARD,
        [ENGINE_BPMN_XML_DATA]: (args: Record<string, unknown>) => ({
          processDefinitionId: args.processDefinitionId,
          bpmnXml: null,
        }),
      }}
    >
      <CockpitApp data={data} />
    </TestViewHost>,
  )
  const reads = (feed: string) =>
    actions.flatMap((a) => (a.type === "callTool" && a.name === feed ? [a.args] : []))
  return { reads, contexts }
}

const boardHeading = () => screen.queryByRole("heading", { level: 1, name: "Invoices" })
const activeEngine = () =>
  screen.queryByLabelText<HTMLSelectElement>("Selected engine")?.value ?? null
const trail = () => screen.getByRole("navigation", { name: "Breadcrumb" })

/** A board is an app-level route: it reads the engines it names, no engine of the cockpit is open. */
describe("CockpitApp opens a board", () => {
  it("from its seed, without a feed call, the chooser one crumb away", async () => {
    const { reads, contexts } = renderBoardCockpit()
    expect(boardHeading()).toBeTruthy()
    // The view frame's main holds the cockpit: the board's route renders none of its own.
    expect(screen.queryByRole("main")).toBeNull()
    expect(reads(ENGINE_BOARD_DATA)).toEqual([])
    expect(activeEngine()).toBeNull()
    expect(within(trail()).getByRole("button", { name: "All engines" })).toBeTruthy()
    expect(within(trail()).getByText("Invoices").getAttribute("aria-current")).toBe("page")
    await waitFor(() => expect(contexts.at(-1)).toContain('board="invoices"'))
  })

  it("a tile opens its engine's route, and the trail's first crumb leads back to the board", async () => {
    renderBoardCockpit()
    const instances = screen.getByRole("region", { name: "Instances" })
    fireEvent.click(within(instances).getAllByRole("button", { name: /^Open instance/ })[0])
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    expect(boardHeading()).toBeNull()
    expect(within(trail()).getByRole("button", { name: "Overview" })).toBeTruthy()
    // The drill carries the name the tile gives, as the cockpit's own drills do.
    expect(within(trail()).getByText("INV-0042").getAttribute("aria-current")).toBe("page")
    expect(within(trail()).queryByText(`Instance ${RUNNING_INSTANCE.slice(0, 8)}…`)).toBeNull()
    fireEvent.click(within(trail()).getByRole("button", { name: "Invoices" }))
    expect(boardHeading()).toBeTruthy()
  })

  it("an engine opened from the board keeps the board as its first crumb when it switches section", async () => {
    renderBoardCockpit()
    const engines = screen.getByRole("group", { name: "Engines of this board" })
    fireEvent.click(within(engines).getByRole("button", { name: /prod-a/ }))
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    fireEvent.click(screen.getByRole("button", { name: "Incidents" }))
    expect(within(trail()).getByRole("button", { name: "Invoices" })).toBeTruthy()
  })

  it("with one engine the chooser shows too: it lists the board, which opens again", async () => {
    renderBoardCockpit([{ id: "prod-a", environment: "default" }])
    expect(boardHeading()).toBeTruthy()
    // The chooser shows once the engine list names the board.
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" })
    fireEvent.click(within(crumbs).getByRole("button", { name: "All engines" }))
    const boards = screen.getByRole("region", { name: "Boards" })
    expect(within(screen.getByRole("region", { name: "Engines" })).getByRole("button")).toBeTruthy()
    fireEvent.click(within(boards).getByRole("button", { name: /^Invoices\b/ }))
    expect(boardHeading()).toBeTruthy()
    expect(within(trail()).getByText("Invoices").getAttribute("aria-current")).toBe("page")
  })

  it("'All engines' leaves the board for the chooser", () => {
    renderBoardCockpit()
    fireEvent.click(screen.getByRole("button", { name: "All engines" }))
    expect(screen.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeTruthy()
  })
})
