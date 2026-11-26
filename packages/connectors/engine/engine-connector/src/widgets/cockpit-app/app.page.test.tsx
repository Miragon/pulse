// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData } from "../../view-models.js"
import {
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_HEALTH_DATA,
  ENGINE_JOBS_DATA,
  ENGINE_LIST_ENGINES,
} from "../../tool-names.js"
import { BOARD } from "../board/board.test-support.js"
import {
  activeEngine,
  boot,
  BOARDS_ONLY_TITLE,
  ENGINES,
  type EngineList,
  fakeAddress,
  FULLSCREEN,
  headSection,
  healthOf,
  INLINE,
  JOBS_DATA,
  ON_BOARDS,
  onLanding,
  overviewOf,
  type PageHost,
  PROCESS,
  REFUSED,
  REFUSED_TITLE,
  renderCockpitOn,
  rowLabels,
  trailLabels,
  trailRow,
} from "./app.test-support.js"

/**
 * The cockpit on a page outside a chat (the web app): its bar leads to the start page, so the
 * chooser's crumb is the bar's product, and its address follows where the cockpit is (N1, N4).
 */

let queryClient = createTestQueryClient()
afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

const RENDER = { timeout: 15_000 }

function renderPage(
  bootstrap?: CockpitAppData,
  list?: EngineList,
  page: PageHost = { startPage: "/app" },
) {
  return renderCockpitOn(queryClient, bootstrap, list, FULLSCREEN, page)
}

describe("the cockpit's trail on a page (N4, A6)", RENDER, () => {
  it("a head section shows no trail: its tab names it, the bar's product leads home", async () => {
    renderPage(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA))
    await waitFor(() => expect(headSection("Jobs").getAttribute("aria-current")).toBe("page"))
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull()
    expect(trailRow()).toBeNull()
  })

  it("a drill shows it on its row, which gives way to the head in a narrow cockpit", async () => {
    renderPage(boot("prod-a", ENGINES, PROCESS))
    await waitFor(() => expect(trailRow()).not.toBeNull())
    expect(trailRow()?.className).toContain("@max-[40rem]:hidden")
    const trails = screen.getAllByRole("navigation", { name: "Breadcrumb" })
    // The head's copy stands in for the tabs under 40rem only; both read the same.
    expect(trails).toHaveLength(2)
    expect(trails[0].parentElement?.className).toContain("@max-[40rem]:flex")
    const tabs = screen.getByRole("navigation", { name: "Cockpit sections" })
    expect(tabs.className).toContain("@max-[40rem]:hidden")
    expect(rowLabels()).toEqual(["All engines", "Overview", "invoice"])
  })

  it("a board shows no trail, and its target the board, then the view (N10)", async () => {
    const list = {
      engines: ENGINES,
      boards: [{ id: "invoices", title: "Invoices", engines: ["prod-a"] }],
    }
    renderPage(boot(null, ENGINES, { section: "board", board: "invoices" }, BOARD), list)
    expect(await screen.findByRole("heading", { level: 1, name: "Invoices" })).toBeTruthy()
    // An app-level view on a page: no trail repeats the bar's way home.
    expect(trailRow()).toBeNull()
    const instances = screen.getByRole("region", { name: "Instances" })
    fireEvent.keyDown(within(instances).getAllByRole("row", { name: /^Instance / })[0], {
      key: "Enter",
    })
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    expect(trailRow()).not.toBeNull()
    expect(rowLabels()).toEqual(["Invoices", "INV-0042"])
  })

  it("the cross-engine overview shows no trail either", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Cross-engine overview" }))
    expect(
      await screen.findByRole("heading", { level: 1, name: "Cross-engine overview" }),
    ).toBeTruthy()
    expect(trailRow()).toBeNull()
  })

  it("the landing leaves the product's signature to the page's bar", async () => {
    renderPage()
    await waitFor(() => expect(onLanding()).toBe(true))
    expect(document.querySelector("[data-brand-signature]")).toBeNull()
    expect(document.querySelectorAll("[data-brand-mark='komet']")).toHaveLength(1)
  })
})

describe("the cockpit in a chat keeps its trail", RENDER, () => {
  it("inline, a board's target names its board in the head, the way back to it", async () => {
    const list = {
      engines: ENGINES,
      boards: [{ id: "invoices", title: "Invoices", engines: ["prod-a"] }],
    }
    renderCockpitOn(
      queryClient,
      boot(null, ENGINES, { section: "board", board: "invoices" }, BOARD),
      list,
      INLINE,
    )
    const instances = await screen.findByRole("region", { name: "Instances" })
    fireEvent.keyDown(within(instances).getAllByRole("row", { name: /^Instance / })[0], {
      key: "Enter",
    })
    await waitFor(() => expect(trailLabels()).toEqual(["Invoices", "INV-0042"]))
    expect(screen.queryByRole("navigation", { name: "Cockpit sections" })).toBeNull()
  })

  it("in fullscreen on a head section, the one way back to the chooser there", async () => {
    renderCockpitOn(queryClient, boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA))
    await waitFor(() => expect(trailLabels()).toEqual(["All engines", "Jobs"]))
    expect(trailRow()?.className).not.toContain("@max-[40rem]:hidden")
  })

  it("its landing keeps the product's signature", async () => {
    renderCockpitOn(queryClient)
    await waitFor(() => expect(onLanding()).toBe(true))
    expect(document.querySelector("[data-brand-signature]")?.textContent).toBe("Pulse")
  })
})

describe("the page's address follows the cockpit (N1)", RENDER, () => {
  it("names the place it opened on, then adds an entry per move", async () => {
    const address = fakeAddress()
    renderPage(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA), undefined, {
      startPage: "/app",
      location: address.location,
    })
    await waitFor(() => expect(address.reports).toHaveLength(1))
    expect(address.reports[0]).toMatchObject({
      place: { args: { view: "jobs", engine: "prod-a" } },
      entry: "replace",
    })
    fireEvent.click(headSection("Incidents"))
    await waitFor(() => expect(address.reports).toHaveLength(2))
    expect(address.reports[1]).toMatchObject({
      place: { args: { view: "incidents", engine: "prod-a" } },
      entry: "push",
    })
  })

  it("Back leads to the entry's place as the cockpit left it", async () => {
    const address = fakeAddress()
    renderPage(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA), undefined, {
      startPage: "/app",
      location: address.location,
    })
    await waitFor(() => expect(address.reports).toHaveLength(1))
    const first = address.reports[0].place
    fireEvent.click(headSection("Incidents"))
    await waitFor(() => expect(headSection("Incidents").getAttribute("aria-current")).toBe("page"))
    expect(address.back(first)).toBe(true)
    await waitFor(() => expect(headSection("Jobs").getAttribute("aria-current")).toBe("page"))
    expect(address.reports.at(-1)?.entry).toBe("replace")
    // A place it does not have: the page loads the entry anew.
    expect(address.back({ args: { view: "nowhere", engine: "prod-a" } })).toBe(false)
  })

  it("names the new engine after a switch, its section kept (N7)", async () => {
    const address = fakeAddress()
    renderPage(boot("prod-a", ENGINES, { section: "incidents" }), undefined, {
      startPage: "/app",
      location: address.location,
    })
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    fireEvent.change(screen.getByLabelText("Selected engine"), { target: { value: "prod-b" } })
    await waitFor(() =>
      expect(address.reports.at(-1)).toMatchObject({
        place: { args: { view: "incidents", engine: "prod-b" } },
        entry: "push",
      }),
    )
  })

  it("names the chooser and a board it opens, as the web app's pages read them", async () => {
    const address = fakeAddress()
    const list = { engines: ENGINES, boards: [{ id: "ops", title: "Ops", engines: ["prod-a"] }] }
    renderPage(boot(null, ENGINES), list, { startPage: "/app", location: address.location })
    await waitFor(() => expect(address.reports[0]?.place.args).toEqual({ view: "landing" }))
    const boards = await screen.findByRole("region", { name: "Boards" })
    fireEvent.click(within(boards).getByRole("button", { name: /^Ops\b/ }))
    await waitFor(() =>
      expect(address.reports.at(-1)).toMatchObject({
        place: { args: { view: "board", board: "ops" } },
        entry: "push",
      }),
    )
  })

  it("opens the cross-engine overview where the page's address starts there", async () => {
    const address = fakeAddress({ args: { view: "fleet" } })
    renderPage(
      boot(null, ENGINES, { section: "landing" }, { boards: [], refusedBoards: [] }),
      undefined,
      {
        startPage: "/app",
        location: address.location,
      },
    )
    expect(
      await screen.findByRole("heading", { level: 1, name: "Cross-engine overview" }),
    ).toBeTruthy()
    await waitFor(() =>
      expect(address.reports[0]).toMatchObject({
        place: { args: { view: "fleet" } },
        entry: "replace",
      }),
    )
  })

  it("opens an engine its address names alone, one shown on boards only, over the picker", async () => {
    // The web app starts such an address on the landing (`engine: null`), which a server of
    // Camunda 8 clusters alone takes too; the address leads on to the engine's one state.
    const engines = [...ENGINES, ON_BOARDS]
    const address = fakeAddress({ args: { engine: "orders-c8" } })
    renderPage(boot(null, engines), { engines }, { startPage: "/app", location: address.location })
    expect(await screen.findByRole("heading", { level: 1, name: BOARDS_ONLY_TITLE })).toBeTruthy()
    await waitFor(() => expect(address.reports.length).toBeGreaterThan(0))
    // A reload or a copied link shows the same: the address keeps naming the engine.
    expect(address.reports[0]).toMatchObject({
      place: { args: { engine: "orders-c8" } },
      entry: "replace",
    })
    expect(address.reports.map(({ place }) => place.args)).not.toContainEqual({ view: "landing" })
  })

  it("keeps the start's data where its address names the engine the tool opened", async () => {
    // The landing's start opens the one engine of a server without boards: no read to do again.
    const start = {
      health: healthOf({ engine: "prod-a" }),
      definitions: overviewOf({ engine: "prod-a" }, { "prod-a": ["invoice"] }),
    }
    const address = fakeAddress({ args: { engine: "prod-a" } })
    const { reads } = renderPage(
      boot("prod-a", ENGINES, { section: "overview" }, start),
      undefined,
      {
        startPage: "/app",
        location: address.location,
      },
    )
    await waitFor(() =>
      expect(address.reports[0]?.place.args).toEqual({ view: "overview", engine: "prod-a" }),
    )
    expect(await screen.findByRole("row", { name: /^Process invoice/ })).toBeTruthy()
    // The seed shows: neither of the overview's feeds is read again.
    expect(reads(ENGINE_COCKPIT_OVERVIEW_DATA)).toEqual([])
    expect(reads(ENGINE_HEALTH_DATA)).toEqual([])
  })

  it("leaves a place the page claims to the page: reports it, renders and reads nothing there", async () => {
    // The web app shows an engine's processes itself: the cockpit's overview is the page's there.
    const claimsOverview = (args: Readonly<Record<string, unknown>>) => args.view === "overview"
    const address = fakeAddress(undefined, claimsOverview)
    const { reads } = renderPage(
      boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA),
      undefined,
      {
        startPage: "/app",
        location: address.location,
      },
    )
    await waitFor(() => expect(address.reports).toHaveLength(1))
    fireEvent.click(headSection("Overview"))
    await waitFor(() =>
      expect(address.reports.at(-1)).toMatchObject({
        place: { args: { view: "overview", engine: "prod-a" } },
        entry: "push",
      }),
    )
    expect(screen.queryByRole("navigation", { name: "Cockpit sections" })).toBeNull()
    expect(reads(ENGINE_COCKPIT_OVERVIEW_DATA)).toEqual([])
    // Back to a claimed place is the page's to show; to another one the cockpit's.
    expect(address.back({ args: { view: "overview", engine: "prod-a" } })).toBe(false)
    expect(address.back({ args: { view: "jobs", engine: "prod-a" } })).toBe(true)
    await waitFor(() => expect(headSection("Jobs").getAttribute("aria-current")).toBe("page"))
  })

  it("claims nothing where the page shows no place itself: an engine without sections is named alone", async () => {
    const engines = [...ENGINES, ON_BOARDS]
    const address = fakeAddress({ args: { view: "overview", engine: "orders-c8" } }, () => false)
    renderPage(boot(null, engines), { engines }, { startPage: "/app", location: address.location })
    expect(await screen.findByRole("heading", { level: 1, name: BOARDS_ONLY_TITLE })).toBeTruthy()
    await waitFor(() => expect(address.reports[0]?.place.args).toEqual({ engine: "orders-c8" }))
  })

  it("names a Camunda 8 engine's place whole where the page shows it itself, and leaves it to the page", async () => {
    // The web app's screens show a Camunda 8 engine's processes, which no route of the cockpit reads.
    const engines = [...ENGINES, ON_BOARDS]
    const address = fakeAddress(
      { args: { view: "overview", engine: "orders-c8" } },
      (args) => args.view === "overview",
    )
    const { reads } = renderPage(
      boot(null, engines),
      { engines },
      {
        startPage: "/app",
        location: address.location,
      },
    )
    await waitFor(() =>
      expect(address.reports[0]?.place.args).toEqual({ view: "overview", engine: "orders-c8" }),
    )
    expect(screen.queryByRole("heading", { level: 1, name: BOARDS_ONLY_TITLE })).toBeNull()
    expect(reads(ENGINE_COCKPIT_OVERVIEW_DATA)).toEqual([])
    expect(reads(ENGINE_HEALTH_DATA)).toEqual([])
  })

  it("names a refused profile alone even where the page claims its overview", async () => {
    const engines = [...ENGINES, REFUSED]
    const address = fakeAddress(
      { args: { view: "overview", engine: "locked" } },
      (args) => args.view === "overview",
    )
    renderPage(boot(null, engines), { engines }, { startPage: "/app", location: address.location })
    expect(await screen.findByRole("heading", { name: REFUSED_TITLE })).toBeTruthy()
    await waitFor(() => expect(address.reports[0]?.place.args).toEqual({ engine: "locked" }))
  })

  it("on the landing a Camunda 8 engine keeps the chat's words, and opens the screen of a page that shows it", async () => {
    const engines = [...ENGINES, ON_BOARDS]
    const address = fakeAddress(undefined, (args) => args.view === "overview")
    renderPage(boot(null, engines), { engines }, { startPage: "/app", location: address.location })
    const row = await screen.findByRole("button", { name: /^orders-c8\b/ })
    expect(row.textContent).toContain("Camunda 8, on no board yet")
    expect(row.getAttribute("data-status")).toBe("boardsOnly")
    fireEvent.click(row)
    await waitFor(() =>
      expect(address.reports.at(-1)).toMatchObject({
        place: { args: { view: "overview", engine: "orders-c8" } },
        entry: "push",
      }),
    )
    expect(screen.queryByRole("heading", { level: 1, name: BOARDS_ONLY_TITLE })).toBeNull()
  })

  it("moves on screen alone in a chat, which has no address", async () => {
    const { reads } = renderCockpitOn(
      queryClient,
      boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA),
    )
    await waitFor(() => expect(reads(ENGINE_LIST_ENGINES)).toHaveLength(1))
    fireEvent.click(headSection("Incidents"))
    await waitFor(() => expect(headSection("Incidents").getAttribute("aria-current")).toBe("page"))
  })
})

describe("a navigation moves focus to the new view's heading (A5)", RENDER, () => {
  it("the heading, focusable from script, with no live region repeating it", async () => {
    renderCockpitOn(queryClient, boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA))
    await waitFor(() => expect(headSection("Jobs").getAttribute("aria-current")).toBe("page"))
    fireEvent.click(headSection("Incidents"))
    const heading = await screen.findByRole("heading", { level: 1, name: "prod-a · Incidents" })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(heading.getAttribute("tabindex")).toBe("-1")
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("hands focus to the loaded view's heading when the route's loading guard gives way", async () => {
    let release: () => void = () => undefined
    const list: EngineList = { engines: ENGINES }
    renderCockpitOn(queryClient, boot("prod-a", ENGINES, { section: "overview" }), list)
    await waitFor(() => expect(headSection("Overview").getAttribute("aria-current")).toBe("page"))
    // The jobs feed answers after the route's first render: its guard draws the heading first.
    list.hold = new Promise((resolve) => {
      release = resolve
    })
    fireEvent.click(headSection("Jobs"))
    const guard = await screen.findByRole("heading", { level: 1, name: "prod-a · Jobs" })
    await waitFor(() => expect(document.activeElement).toBe(guard))
    act(() => release())
    expect(await screen.findByText("No jobs in this selection.")).toBeTruthy()
    const loaded = screen.getByRole("heading", { level: 1, name: "prod-a · Jobs" })
    expect(loaded).not.toBe(guard)
    await waitFor(() => expect(document.activeElement).toBe(loaded))
  })
})

describe("the cockpit's Refresh (A4)", RENDER, () => {
  it("keeps its focus while it reads, ignores a second click, and marks the route busy", async () => {
    let release: () => void = () => undefined
    const list: EngineList = { engines: ENGINES }
    const { reads } = renderCockpitOn(
      queryClient,
      boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA),
      list,
    )
    expect(await screen.findByText("No jobs in this selection.")).toBeTruthy()
    // Hold the next jobs read until the test lets it answer.
    list.hold = new Promise((resolve) => {
      release = resolve
    })
    const refresh = screen.getByRole("button", { name: "Refresh" })
    refresh.focus()
    fireEvent.click(refresh)
    const busy = await screen.findByRole("button", { name: "Refreshing…" })
    expect(busy.getAttribute("aria-disabled")).toBe("true")
    expect(busy.hasAttribute("disabled")).toBe(false)
    expect(document.activeElement).toBe(busy)
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull()
    const before = reads(ENGINE_JOBS_DATA).length
    fireEvent.click(busy)
    expect(reads(ENGINE_JOBS_DATA).length).toBe(before)
    act(() => release())
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy())
    expect(document.querySelector("[aria-busy='true']")).toBeNull()
  })
})
