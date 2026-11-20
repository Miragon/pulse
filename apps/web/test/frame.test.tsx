// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LocaleProvider } from "@miragon/pulse-ui"
import {
  useHostChrome,
  useHostLocation,
  useToolQuery,
  type ViewComponent,
} from "@miragon/pulse-widget-shell/widgets"
import { PAGE_MENU } from "../src/frame/drawer.js"
import {
  bodyOf,
  callsOf,
  ENGINE_SCREEN_FEED,
  engineList,
  engineScreen,
  settled,
  start,
  stopPage,
} from "./page.test-support.js"

/**
 * The frame of a page with a session (src/frame): the side navigation from the one read of the
 * engine list, the drawer under 64rem behind the menu every view bar shows first, the focus on the
 * new view's heading at each of the page's moves.
 */

afterEach(stopPage)

/** The engine list of a server with environments, a Camunda 8 engine, a refused profile, a board. */
const LIST = {
  engines: [
    { id: "prod-a", environment: "prod", dialect: "c7" },
    { id: "prod-b", environment: "prod", dialect: "c7" },
    { id: "c8-dev", environment: "dev", dialect: "c8" },
  ],
  refused: [{ id: "legacy", environment: "dev", reason: "auth.tokenEnv names no variable." }],
  boards: [{ id: "leasing", title: "Leasing operations", engines: ["prod-a"] }],
}

/**
 * A view as the cockpit is on a page with chrome: its bar with the page's menu first, its heading
 * where it is (the address's place beyond its start, else its arguments), its read of the engine
 * list the cockpit's own, under the same key.
 */
const Placed: ViewComponent<{ args: Record<string, unknown> }> = ({ data }) => {
  const chrome = useHostChrome()
  const start = useHostLocation()?.start?.args
  useToolQuery(["engine:engines"], "engine_list_engines", {})
  const { view, engine } = start ?? data.args
  return (
    <main>
      <div data-slot="view-bar">
        {chrome?.menu}
        <h1>{`${String(view)} ${String(engine)}`}</h1>
      </div>
    </main>
  )
}
const PLACED = { views: { engine_open_cockpit: Placed as ViewComponent } }

/** Every engine and refused profile of `LIST`, as the cockpit's start data names them. */
const CONFIGURED = [...LIST.engines, ...LIST.refused].map(({ id }) => ({ id }))

/**
 * The server: the view tool answers with its arguments and the configured engines (an engine's
 * own address starts the landing, whose data must name the engine), the engine list with `list`,
 * the engine screen's feed with the kit world's screen under the engine's name.
 */
function server(list: unknown = LIST) {
  return {
    call: ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) =>
      name === "engine_list_engines"
        ? Response.json(engineList(list))
        : name === ENGINE_SCREEN_FEED
          ? Response.json(engineScreen(args?.engine))
          : Response.json({
              result: {
                content: [{ type: "text", text: "{}" }],
                structuredContent: { args, engines: CONFIGURED },
              },
            }),
  }
}

/** The banner on the wide layout's side, which the skip link and the navigation open. */
const side = () => document.querySelector<HTMLElement>("[data-slot=page-side]")!
/** The navigation on the wide layout's side (the drawer holds its own copy). */
const navigation = () => within(side()).getByRole("navigation", { name: "Pulse" })
const links = () =>
  within(navigation())
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")])
const current = () =>
  within(navigation())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent)

describe("the page's navigation", () => {
  it("lists the start page, the engines by environment with the open one's sections, the boards", async () => {
    await start("/app/engines/prod-a/incidents", server(), PLACED)
    expect(links()).toEqual([
      ["Start", "/app"],
      ["Cross-engine overview", "/app/fleet"],
      ["prod-a", "/app/engines/prod-a"],
      ["Processes", "/app/engines/prod-a"],
      ["Incidents", "/app/engines/prod-a/incidents"],
      ["Jobs", "/app/engines/prod-a/jobs"],
      ["prod-b", "/app/engines/prod-b"],
      ["c8-dev, boards only", "/app/engines/c8-dev"],
      ["legacy, refused", "/app/engines/legacy"],
      ["Leasing operations", "/app/boards/leasing"],
    ])
    expect(current()).toEqual(["Incidents"])
    const engines = within(navigation()).getByRole("group", { name: "Engines" })
    expect(within(engines).getByRole("group", { name: "prod" })).toBeTruthy()
    expect(within(engines).getByRole("group", { name: "dev" })).toBeTruthy()
    expect(within(navigation()).getByRole("group", { name: "Boards" })).toBeTruthy()
    // The refused profile's mark is the warning's.
    const legacy = within(navigation()).getByRole("link", { name: /^legacy/ })
    expect(legacy.querySelector("svg")?.getAttribute("class")).toContain("text-warning")
  })

  it("carries no counts: one read of the engine list for the page and its view, none per engine", async () => {
    const env = await start("/app/engines/prod-a/incidents", server(), PLACED)
    await settled()
    expect(callsOf(env.fetch, "engine_list_engines")).toHaveLength(1)
    const tools = env.fetch.mock.calls
      .filter(([path]) => path === "/app/api/call")
      .map(([, init]) => (JSON.parse(bodyOf(init)) as { name: string }).name)
    expect([...new Set(tools)].sort()).toEqual(["engine_list_engines", "engine_open_cockpit"])
    expect(navigation().textContent).not.toMatch(/\b\d+\b/)
  })

  it("shares its one read of the engine list with the engine screen, which reads its engine alone", async () => {
    const env = await start("/app/engines/prod-a", server(), PLACED)
    await settled()
    expect(callsOf(env.fetch, "engine_list_engines")).toHaveLength(1)
    expect(callsOf(env.fetch, ENGINE_SCREEN_FEED)).toEqual([{ engine: "prod-a" }])
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([])
    expect(current()).toEqual(["Processes"])
  })

  it("lists the engines in one list where the server names no environment, the fleet only for two", async () => {
    const list = {
      engines: [
        { id: "solo", environment: "default", dialect: "c7" },
        { id: "orders", environment: "default", dialect: "c8" },
      ],
      refused: [{ id: "gone", reason: "no url" }],
    }
    await start("/app", server(list), PLACED)
    const engines = within(navigation()).getByRole("group", { name: "Engines" })
    expect(within(engines).queryAllByRole("group")).toEqual([])
    expect(
      within(engines)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["solo", "orders, boards only", "gone, refused"])
    // A Camunda 7 engine and a refused profile: two the cross-engine view reads whole.
    expect(within(navigation()).getByRole("link", { name: "Cross-engine overview" })).toBeTruthy()
    expect(current()).toEqual(["Start"])
    expect(within(navigation()).queryByRole("group", { name: "Boards" })).toBeNull()
  })

  it("offers no cross-engine view for one engine read whole, and an empty list nothing", async () => {
    await start(
      "/app",
      server({
        engines: [
          { id: "solo", environment: "default", dialect: "c7" },
          { id: "orders", environment: "default", dialect: "c8" },
        ],
      }),
      PLACED,
    )
    expect(within(navigation()).queryByRole("link", { name: "Cross-engine overview" })).toBeNull()
    await stopPage()
    await start("/app", server({}), PLACED)
    expect(links()).toEqual([["Start", "/app"]])
    expect(within(navigation()).queryByRole("group", { name: "Engines" })).toBeNull()
  })

  it("marks an engine without sections its own page while it is open, a board while it shows", async () => {
    await start("/app/engines/c8-dev", server(), PLACED)
    expect(current()).toEqual(["c8-dev, boards only"])
    expect(within(navigation()).queryByRole("link", { name: "Processes" })).toBeNull()
    await stopPage()
    await start("/app/boards/leasing", server(), PLACED)
    expect(current()).toEqual(["Leasing operations"])
    await stopPage()
    await start("/app/fleet", server(), PLACED)
    expect(current()).toEqual(["Cross-engine overview"])
  })

  it("says quietly where the engine list could not be read, and leaves an ended session to the notice", async () => {
    const refused = "Input validation error: Invalid arguments for tool engine_list_engines"
    const listAnswer = (answer: () => Response) => ({
      call: ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) =>
        name === "engine_list_engines" ? answer() : server().call({ name, arguments: args }),
    })
    await start(
      "/app",
      listAnswer(() =>
        Response.json({ result: { isError: true, content: [{ type: "text", text: refused }] } }),
      ),
      PLACED,
    )
    const line = "The engines couldn't be loaded. Reload the page."
    expect(await within(side()).findByText(line)).toBeTruthy()
    expect(links()).toEqual([["Start", "/app"]])
    await stopPage()
    await start(
      "/app",
      listAnswer(() =>
        Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
      ),
      PLACED,
    )
    expect(await screen.findByText("Your session has ended")).toBeTruthy()
    expect(within(side()).queryByText(line)).toBeNull()
  })

  it("speaks German where the page does", async () => {
    document.documentElement.lang = "de"
    await start("/app/engines/prod-a", server(), PLACED)
    expect(links().map(([name]) => name)).toEqual([
      "Start",
      "Engine-übergreifende Übersicht",
      "prod-a",
      "Prozesse",
      "Incidents",
      "Jobs",
      "prod-b",
      "c8-dev, nur Boards",
      "legacy, abgelehnt",
      "Leasing operations",
    ])
  })
})

describe("the page's moves through its navigation", () => {
  it("follows an entry in the page, a new entry of the history, the current one and the focus moving with it", async () => {
    const env = await start("/app/engines/prod-a/incidents", server(), PLACED)
    await act(async () => fireEvent.click(within(navigation()).getByRole("link", { name: "Jobs" })))
    await settled()
    expect(env.browser.writes.at(-1)).toMatchObject({
      entry: "push",
      url: "/app/engines/prod-a/jobs",
    })
    expect(current()).toEqual(["Jobs"])
    const heading = await screen.findByRole("heading", { level: 1, name: "jobs prod-a" })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    // Back: the entry it left, the current one and the focus with it, in the page.
    await env.browser.back("/app/engines/prod-a/incidents")
    expect(current()).toEqual(["Incidents"])
    const back = await screen.findByRole("heading", { level: 1, name: "incidents prod-a" })
    await waitFor(() => expect(document.activeElement).toBe(back))
    expect(env.reload).not.toHaveBeenCalled()
  })

  it("takes no focus at the page's first view", async () => {
    await start("/app/engines/prod-a/incidents", server(), PLACED)
    expect(document.activeElement).toBe(document.body)
  })
})

describe("the engine screen's filter in the page's address", () => {
  /** The rows of the engine screen's table, by the process each names. */
  const shownRows = () =>
    Array.from(
      screen.getByRole("table", { name: "Processes" }).querySelectorAll("tbody > tr"),
      (row) => row.getAttribute("aria-label"),
    )

  it("shows the filter its address names, and names the entry anew at each pick, the focus kept", async () => {
    const env = await start("/app/engines/prod-a?q=order", server(), PLACED)
    await screen.findByRole("table", { name: "Processes" })
    expect(shownRows()).toEqual(["Process Order fulfillment", "Process Dispatch order"])
    expect(env.browser.writes).toEqual([])
    const scope = screen.getByRole("radio", { name: /^With incident/ })
    scope.focus()
    await act(async () => fireEvent.click(scope))
    await settled()
    expect(env.browser.writes).toEqual([
      { entry: "replace", url: "/app/engines/prod-a?scope=incident&q=order", state: null },
    ])
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /^With incident/ }))
    expect(current()).toEqual(["Processes"])
    expect(callsOf(env.fetch, ENGINE_SCREEN_FEED)).toHaveLength(1)
  })

  it("keeps it on Back from a process the screen opened", async () => {
    const env = await start("/app/engines/prod-a?scope=incident&q=order", server(), PLACED)
    const row = await screen.findByRole("row", { name: "Process Order fulfillment" })
    await act(async () => fireEvent.click(within(row).getByText("v2")))
    await settled()
    expect(env.browser.writes.at(-1)).toMatchObject({
      entry: "push",
      url: "/app/engines/prod-a/processes/pulse-order",
    })
    expect(
      await screen.findByRole("heading", { level: 1, name: "process-detail prod-a" }),
    ).toBeTruthy()
    await env.browser.back("/app/engines/prod-a?scope=incident&q=order")
    await screen.findByRole("table", { name: "Processes" })
    expect(shownRows()).toEqual(["Process Order fulfillment", "Process Dispatch order"])
    expect(screen.getByRole("radio", { name: /^With incident/ }).getAttribute("aria-checked")).toBe(
      "true",
    )
    expect(
      screen.getByRole<HTMLInputElement>("searchbox", {
        name: "Search by name or BPMN process ID",
      }).value,
    ).toBe("order")
  })
})

describe("the page's name of a place it shows itself", () => {
  /** A view that says how the page names an engine's processes and its jobs, for its trail. */
  const Naming: ViewComponent = () => {
    const location = useHostLocation()
    const names = [
      location?.nameOf?.({ view: "overview", engine: "prod-a" }),
      location?.nameOf?.({ view: "jobs", engine: "prod-a" }) ?? "its own",
    ]
    return (
      <main>
        <h1>{names.join(", ")}</h1>
      </main>
    )
  }
  const NAMING = { views: { engine_open_cockpit: Naming } }

  it.each([
    ["en", "Processes, its own"],
    ["de", "Prozesse, its own"],
  ])("is its navigation's word, a view's own elsewhere (%s)", async (lang, names) => {
    document.documentElement.lang = lang
    await start("/app/engines/prod-a/jobs", server(), NAMING)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(names)
  })
})

describe("the drawer under 64rem", () => {
  /** The view bar's menu button: the first element of its bar. */
  const barMenu = () => {
    const bar = screen
      .getByRole("heading", { level: 1 })
      .closest<HTMLElement>("[data-slot=view-bar]")!
    return within(bar).getByRole("button", { name: "Menu" })
  }

  it("puts the menu first in the view's bar, and a row of its own for a view without one", async () => {
    await start("/app/engines/prod-a", server(), PLACED)
    const menu = barMenu()
    // The engine screen's bar (the kit's ViewBar) holds the menu first, before its title.
    const bar = menu.closest<HTMLElement>("[data-slot=view-bar]")!
    expect(within(bar).getAllByRole("button")[0]).toBe(menu)
    expect(menu.compareDocumentPosition(within(bar).getByRole("heading", { level: 1 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(menu.className).toContain("lg:hidden")
    expect(menu.getAttribute("aria-haspopup")).toBe("dialog")
    expect(menu.getAttribute("aria-expanded")).toBe("false")
    // The page's own row, which a stylesheet hides where the view shows its bar (and from 64rem on).
    const row = document.querySelector("[data-slot=page-menu-row]")
    expect(row?.className).toEqual(
      expect.stringContaining("group-has-[[data-slot=view-bar]]/content:hidden"),
    )
    expect(row?.className).toEqual(expect.stringContaining("lg:hidden"))
    expect(within(row as HTMLElement).getByRole("button", { name: "Menu" })).toBeTruthy()
  })

  it("opens the navigation, the account and the sign-out in a drawer; Escape gives the focus back", async () => {
    await start("/app/engines/prod-a", server(), PLACED)
    const menu = barMenu()
    menu.focus()
    await act(async () => fireEvent.click(menu))
    const drawer = screen.getByRole("dialog", { name: "Pulse" })
    expect(menu.getAttribute("aria-expanded")).toBe("true")
    expect(drawer.getAttribute("data-side")).toBe("left")
    expect(within(drawer).getByRole("navigation", { name: "Pulse" })).toBeTruthy()
    expect(within(drawer).getByText("Signed in as Alice Adams")).toBeTruthy()
    expect(within(drawer).getByRole("button", { name: "Sign out" })).toBeTruthy()
    expect(within(drawer).getByRole("button", { name: "Close menu" })).toBeTruthy()
    await act(async () => fireEvent.keyDown(drawer, { key: "Escape" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(menu))
  })

  it("closes as an entry moves the page on, the focus on the new view's heading, never the menu", async () => {
    const env = await start("/app/engines/prod-a", server(), PLACED)
    await act(async () => fireEvent.click(barMenu()))
    const drawer = screen.getByRole("dialog", { name: "Pulse" })
    await act(async () => fireEvent.click(within(drawer).getByRole("link", { name: "Jobs" })))
    await settled()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(env.browser.location.pathname).toBe("/app/engines/prod-a/jobs")
    const heading = await screen.findByRole("heading", { level: 1, name: "jobs prod-a" })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it("closes where its sign-out did not go through, the notice shown and the focus on the menu", async () => {
    const failing = { ...server(), logout: () => Response.json({}, { status: 500 }) }
    const env = await start("/app/engines/prod-a", failing, PLACED)
    const menu = barMenu()
    // Each time: a notice already shown changes nothing the drawer could follow.
    for (const attempt of [1, 2]) {
      menu.focus()
      await act(async () => fireEvent.click(menu))
      const drawer = screen.getByRole("dialog", { name: "Pulse" })
      await act(async () =>
        fireEvent.click(within(drawer).getByRole("button", { name: "Sign out" })),
      )
      await settled()
      await waitFor(() => expect(screen.queryByRole("dialog"), `attempt ${attempt}`).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(menu))
      const content = document.getElementById("content")!
      expect(within(content).getByRole("alert").textContent).toContain("Sign-out didn't go through")
    }
    expect(env.assign).not.toHaveBeenCalled()
  })

  it("a menu outside the page's drawer opens nothing", () => {
    render(<LocaleProvider locale="en">{PAGE_MENU}</LocaleProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Menu" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("the page's notice", () => {
  it("says it once, above the view's bar", async () => {
    await start(
      "/app/engines/prod-a/incidents",
      {
        call: ({ name }) =>
          name === "engine_open_cockpit"
            ? server().call({ name, arguments: { view: "incidents", engine: "prod-a" } })
            : Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
      },
      PLACED,
    )
    const content = document.getElementById("content")!
    const notice = within(content).getByRole("status")
    expect(notice.textContent).toContain("Your session has ended")
    const bar = within(content)
      .getByRole("heading", { level: 1 })
      .closest<HTMLElement>("[data-slot=view-bar]")!
    expect(notice.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
