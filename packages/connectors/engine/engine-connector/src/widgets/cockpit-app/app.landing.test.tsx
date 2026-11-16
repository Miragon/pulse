// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData } from "../../view-models.js"
import {
  activeEngine,
  boot,
  ENGINES,
  type EngineList,
  onLanding,
  renderCockpitOn,
  trailLabels,
} from "./app.test-support.js"

// One retry-free client per test; the test reloads the engine list through it.
let queryClient = createTestQueryClient()

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

const renderCockpit = (bootstrap: CockpitAppData, list: EngineList) =>
  renderCockpitOn(queryClient, bootstrap, list)

const SOLO = [{ id: "solo", environment: "default" }]

/** The boards of ENGINE_BOARDS_DIR, as the engine list names them. */
const INVOICES = { id: "invoices", title: "Invoices", engines: ["solo"] }

const trail = () => screen.getByRole("navigation", { name: "Breadcrumb" })

/**
 * With boards, the chooser shows with one engine too: it lists the boards, and the trail's first
 * crumb leads there. Without them a single engine opens as before.
 */
describe("CockpitApp with the server's boards", () => {
  it("one engine with a board: the trail leads to the chooser, which lists both and opens the board", async () => {
    const { modelContexts } = renderCockpit(boot("solo", SOLO), {
      engines: SOLO,
      boards: [INVOICES],
    })
    await waitFor(() => expect(trailLabels()).toEqual(["All engines", "Overview"]))
    fireEvent.click(within(trail()).getByRole("button", { name: "All engines" }))
    expect(onLanding()).toBe(true)
    const engines = screen.getByRole("region", { name: "Engines" })
    expect(within(engines).getByRole("button", { name: /^solo\b/ })).toBeTruthy()
    await waitFor(() => expect(modelContexts.at(-1)).toContain('boards=["invoices"]'))
    const boards = screen.getByRole("region", { name: "Boards" })
    fireEvent.click(within(boards).getByRole("button", { name: /^Invoices\s*,\s*1 engine: solo$/ }))
    // No seed: the board reads its feed.
    expect(await screen.findByRole("heading", { level: 1, name: "Invoices" })).toBeTruthy()
    expect(trailLabels()).toEqual(["All engines", "Invoices"])
  })

  it("one engine with only a refused board file: the chooser shows it with its problem count", async () => {
    const { modelContexts } = renderCockpit(boot("solo", SOLO), {
      engines: SOLO,
      refusedBoards: [{ id: "broken", problems: 2 }],
    })
    fireEvent.click(await screen.findByRole("button", { name: "All engines" }))
    const boards = screen.getByRole("region", { name: "Boards" })
    expect(within(boards).queryByRole("button")).toBeNull()
    expect(within(boards).getByText("file refused: 2 problems")).toBeTruthy()
    await waitFor(() => expect(modelContexts.at(-1)).toContain('refusedBoards=["broken"]'))
  })

  it("one engine without boards: no root crumb, the chooser never shows", async () => {
    renderCockpit(boot("solo", SOLO), { engines: SOLO })
    expect(await screen.findByRole("heading", { name: "solo · Overview" })).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull()
    expect(onLanding()).toBe(false)
  })

  it("several engines: the chooser lists the boards under the engines", async () => {
    renderCockpit(boot(null, ENGINES), { engines: ENGINES, boards: [INVOICES] })
    const boards = await screen.findByRole("region", { name: "Boards" })
    expect(within(boards).getByRole("button", { name: /^Invoices\b/ })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Engines" })).toBeTruthy()
  })

  it("the open engine leaves the list, one remains beside the server's boards: back to the chooser", async () => {
    const list: EngineList = { engines: ENGINES, boards: [INVOICES] }
    renderCockpit(boot("prod-a", ENGINES), list)
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))

    list.engines = [ENGINES[1]]
    await queryClient.invalidateQueries({ queryKey: ["engine:engines"] })

    await waitFor(() => expect(onLanding()).toBe(true))
    expect(screen.getByText(/prod-a is no longer configured on this server/)).toBeTruthy()
  })

  it("the cross-engine view is open and one engine remains beside the server's boards: back to the chooser", async () => {
    const list: EngineList = { engines: ENGINES, boards: [INVOICES] }
    renderCockpit(boot(null, ENGINES), list)
    fireEvent.click(await screen.findByRole("button", { name: "Cross-engine overview" }))
    expect(
      await screen.findByRole("heading", { level: 1, name: "Cross-engine overview" }),
    ).toBeTruthy()

    list.engines = [ENGINES[1]]
    await queryClient.invalidateQueries({ queryKey: ["engine:engines"] })

    // The fleet needs two engines; the chooser stays for the boards, the engine opens from there.
    await waitFor(() => expect(onLanding()).toBe(true))
    expect(screen.queryByRole("heading", { level: 1, name: "Cross-engine overview" })).toBeNull()
    expect(activeEngine()).toBeNull()
    expect(screen.getByRole("region", { name: "Boards" })).toBeTruthy()
  })
})
