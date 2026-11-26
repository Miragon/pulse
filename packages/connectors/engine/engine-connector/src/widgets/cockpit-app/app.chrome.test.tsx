// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createTestQueryClient, type HostChrome } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData, CockpitEngineInfo } from "../../view-models.js"
import { ENGINE_JOBS_DATA, ENGINE_LIST_ENGINES } from "../../tool-names.js"
import { BOARD } from "../board/board.test-support.js"
import {
  boot,
  BOARDS_ONLY_TITLE,
  ENGINES,
  type EngineList,
  FULLSCREEN,
  JOBS_DATA,
  ON_BOARDS,
  PROCESS,
  REFUSED,
  REFUSED_REASON,
  REFUSED_TITLE,
  fakeAddress,
  renderCockpitOn,
  rowLabels,
  trailRow,
} from "./app.test-support.js"

/**
 * The cockpit on a page with chrome of its own (the web app's frame, `useHostChrome`): the page's
 * navigation holds the head's sections, its engine switch and the way across engines, so the
 * cockpit shows no head; every view bar shows the page's menu first, an engine's bar the
 * cockpit's Refresh first among its actions, and an app-level title is the bar's title. A chat
 * keeps its head (app.test.tsx, app.page.test.tsx).
 */

let queryClient = createTestQueryClient()
afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

const RENDER = { timeout: 15_000 }

/** The page's menu button, as the web app hands it. */
const CHROME: HostChrome = {
  menu: (
    <button type="button" aria-label="Menu">
      =
    </button>
  ),
}

function renderChromed(bootstrap?: CockpitAppData, list?: EngineList) {
  return renderCockpitOn(queryClient, bootstrap, list, FULLSCREEN, {
    startPage: "/app",
    chrome: CHROME,
  })
}

/** The view bar that holds the page's one h1. */
function titleBar(): HTMLElement {
  const bar = screen.getByRole("heading", { level: 1 }).closest<HTMLElement>("[data-slot=view-bar]")
  if (!bar) throw new Error("the h1 is no view bar's title")
  return bar
}

/** The head's parts, which the page's navigation and the route's bar take on a page with chrome. */
function expectNoHead() {
  expect(document.querySelector("[data-slot=cockpit-head]")).toBeNull()
  expect(screen.queryByRole("navigation", { name: "Cockpit sections" })).toBeNull()
  expect(screen.queryByLabelText("Selected engine")).toBeNull()
}

describe("the cockpit on a page with chrome of its own", RENDER, () => {
  it("shows no head over an engine's section: the menu first in the route's bar, then its Refresh", async () => {
    const list: EngineList = { engines: ENGINES }
    const { reads } = renderChromed(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA), list)
    expect(await screen.findByText("No jobs in this selection.")).toBeTruthy()
    expectNoHead()
    expect(screen.queryByRole("button", { name: "Cross-engine overview" })).toBeNull()
    const bar = titleBar()
    expect(within(bar).getByRole("heading", { level: 1 }).textContent).toBe("prod-a · Jobs")
    // The menu is the bar's first element, the Refresh the first of its actions.
    expect(within(bar).getAllByRole("button")[0]).toBe(
      within(bar).getByRole("button", { name: "Menu" }),
    )
    const actions = bar.querySelector<HTMLElement>("[data-slot=view-bar-actions]")!
    const refresh = within(actions).getAllByRole("button")[0]
    expect(refresh.textContent).toBe("Refresh")
    expect(refresh.getAttribute("data-variant")).toBe("toolbar")
    // One Refresh, one menu: the head's are gone.
    expect(screen.getAllByRole("button", { name: "Refresh" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Menu" })).toHaveLength(1)
    // It reads the route's feeds again, as the head's did.
    const before = reads(ENGINE_JOBS_DATA).length
    fireEvent.click(refresh)
    await waitFor(() => expect(reads(ENGINE_JOBS_DATA).length).toBeGreaterThan(before))
  })

  it("keeps a drill's trail on its row at every width, and no copy of it in a head", async () => {
    renderChromed(boot("prod-a", ENGINES, PROCESS))
    await waitFor(() => expect(trailRow()).not.toBeNull())
    expectNoHead()
    expect(trailRow()?.className).not.toContain("@max-[40rem]:hidden")
    expect(screen.getAllByRole("navigation", { name: "Breadcrumb" })).toHaveLength(1)
    expect(rowLabels()).toEqual(["All engines", "Overview", "invoice"])
  })

  it("names a crumb to a place the page shows itself by the page's word, the others its own", async () => {
    // The web app shows an engine's processes itself, under its navigation's word for them.
    const address = fakeAddress(undefined, (args) => args.view === "overview")
    const location = {
      ...address.location,
      nameOf: (args: Readonly<Record<string, unknown>>) =>
        args.view === "overview" && args.engine === "prod-a" ? "Processes" : undefined,
    }
    renderCockpitOn(queryClient, boot("prod-a", ENGINES, PROCESS), undefined, FULLSCREEN, {
      startPage: "/app",
      chrome: CHROME,
      location,
    })
    await waitFor(() => expect(trailRow()).not.toBeNull())
    expect(rowLabels()).toEqual(["All engines", "Processes", "invoice"])
  })

  it("makes the landing's title its view bar's, with its action and the menu first, no Komet", async () => {
    renderChromed()
    const bar = await waitFor(() => titleBar())
    expect(within(bar).getByRole("heading", { level: 1 }).textContent).toBe("Operations Cockpit")
    expect(within(bar).getAllByRole("button")[0].getAttribute("aria-label")).toBe("Menu")
    const fleet = within(bar).getByRole("button", { name: "Cross-engine overview" })
    expect(fleet.getAttribute("data-variant")).toBe("toolbar")
    expect(document.querySelector("[data-slot=widget-header]")).toBeNull()
    expect(document.querySelector("[data-brand-mark]")).toBeNull()
    // No head and no Refresh: the landing's rows read each engine themselves.
    expectNoHead()
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull()
  })

  it("makes the empty landing's title its view bar's, the menu first, no Komet", async () => {
    renderChromed(boot(null, []), { engines: [] })
    expect(
      await screen.findByRole("heading", { level: 2, name: "No engines configured" }),
    ).toBeTruthy()
    const bar = titleBar()
    expect(within(bar).getByRole("heading", { level: 1 }).textContent).toBe("Operations Cockpit")
    expect(within(bar).getAllByRole("button")[0].getAttribute("aria-label")).toBe("Menu")
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(document.querySelector("[data-slot=widget-header]")).toBeNull()
    expect(document.querySelector("[data-brand-mark]")).toBeNull()
    expectNoHead()
  })

  it("makes the cross-engine overview's title its view bar's, the menu first", async () => {
    renderChromed()
    const bar = await waitFor(() => titleBar())
    fireEvent.click(within(bar).getByRole("button", { name: "Cross-engine overview" }))
    await screen.findByRole("heading", { level: 1, name: "Cross-engine overview" })
    const fleet = titleBar()
    expect(within(fleet).getAllByRole("button")[0].getAttribute("aria-label")).toBe("Menu")
    expect(document.querySelector("[data-slot=widget-header]")).toBeNull()
    expect(trailRow()).toBeNull()
  })

  it("puts the menu first in a board's bar, before the board's own Refresh", async () => {
    const list = {
      engines: ENGINES,
      boards: [{ id: "invoices", title: "Invoices", engines: ["prod-a"] }],
    }
    renderChromed(boot(null, ENGINES, { section: "board", board: "invoices" }, BOARD), list)
    await screen.findByRole("heading", { level: 1, name: "Invoices" })
    const bar = titleBar()
    expect(within(bar).getAllByRole("button")[0].getAttribute("aria-label")).toBe("Menu")
    expect(within(bar).getAllByRole("button", { name: "Refresh" })).toHaveLength(1)
  })

  it.each<[string, CockpitEngineInfo, string, Omit<EngineList, "engines">]>([
    ["shown on boards only", ON_BOARDS, BOARDS_ONLY_TITLE, {}],
    [
      "whose profile is refused",
      REFUSED,
      REFUSED_TITLE,
      { refused: [{ id: "locked", reason: REFUSED_REASON }] },
    ],
  ])(
    "shows an engine %s as its one state under a bar of its own: its name, the menu, the Refresh",
    async (_, engine, title, extra) => {
      const engines = [...ENGINES, engine]
      const { reads } = renderChromed(boot(engine.id, engines), { engines, ...extra })
      // The state's title is the heading under the bar, whose title is the page's one h1.
      expect(await screen.findByRole("heading", { level: 2, name: title })).toBeTruthy()
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
      const bar = titleBar()
      expect(within(bar).getByRole("heading", { level: 1 }).textContent).toBe(engine.id)
      expect(within(bar).getAllByRole("button")[0].getAttribute("aria-label")).toBe("Menu")
      expectNoHead()
      expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull()
      // The head's Refresh is the bar's one action: it reads the engine list again.
      const actions = bar.querySelector<HTMLElement>("[data-slot=view-bar-actions]")!
      expect(
        within(actions)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(["Refresh"])
      expect(screen.getAllByRole("button", { name: "Refresh" })).toHaveLength(1)
      const before = reads(ENGINE_LIST_ENGINES).length
      fireEvent.click(within(actions).getByRole("button", { name: "Refresh" }))
      await waitFor(() => expect(reads(ENGINE_LIST_ENGINES).length).toBeGreaterThan(before))
    },
  )

  it("gives a profile the server no longer refuses its view back at the bar's Refresh", async () => {
    const engines = [...ENGINES, REFUSED]
    const list: EngineList = {
      engines: ENGINES,
      refused: [{ id: "locked", reason: REFUSED_REASON }],
    }
    renderChromed(boot("locked", engines), list)
    await screen.findByRole("heading", { level: 2, name: REFUSED_TITLE })
    // The operator fixed the profile: the list names the engine whole, its overview reads it.
    list.engines = [...ENGINES, { id: "locked", environment: "default", dialect: "c7" }]
    list.refused = []
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByRole("heading", { level: 1, name: "locked · Overview" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: REFUSED_TITLE })).toBeNull()
  })
})
