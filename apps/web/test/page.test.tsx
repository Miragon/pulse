// @vitest-environment happy-dom
import { act, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useEffect, useState } from "react"
import {
  useHostLocation,
  useViewHost,
  type ViewComponent,
} from "@miragon/pulse-widget-shell/widgets"
import { PageNotices } from "../src/notices.js"
import {
  bodyOf,
  callsOf,
  ENGINE_SCREEN_FEED,
  engineList,
  engineScreen,
  settled,
  start,
  stopPage,
  viewResult,
} from "./page.test-support.js"

/** The page as a browser starts it: its route, its session, its frame and the view in it. */

afterEach(stopPage)

/** The engine list of a server with two engines, each read through the engine screen's feed. */
const twoEngines = ({
  name,
  arguments: args,
}: {
  name: string
  arguments?: { engine?: unknown }
}) =>
  Response.json(
    name === "engine_list_engines"
      ? engineList({
          engines: [
            { id: "prod", dialect: "c7" },
            { id: "test", dialect: "c8" },
          ],
        })
      : name === ENGINE_SCREEN_FEED
        ? engineScreen(args?.engine)
        : { result: viewResult },
  )

/** The arguments of the page's first call of the view tool. */
const viewArgs = (fetch: Parameters<typeof callsOf>[0]): unknown =>
  callsOf(fetch, "engine_open_cockpit")[0]

describe("a page with a session", () => {
  it("shows its navigation, who is signed in and the view its address names, called with the CSRF token", async () => {
    const env = await start("/app/engines/prod/jobs")
    const banner = screen.getByRole("banner")
    expect(within(banner).getAllByText("Pulse").length).toBeGreaterThan(0)
    expect(within(banner).getByRole("navigation", { name: "Pulse" })).toBeTruthy()
    // The Komet is the app level's (the cockpit's landing), never the frame of every page.
    expect(banner.querySelector("[data-brand-mark]")).toBeNull()
    expect(within(banner).getByText("Signed in as Alice Adams")).toBeTruthy()
    expect(within(banner).getByRole("button", { name: "Sign out" })).toBeTruthy()
    expect(screen.getByTestId("view").textContent).toBe("Hi")
    const call = env.fetch.mock.calls.find(
      ([path, init]) =>
        path === "/app/api/call" &&
        (JSON.parse(bodyOf(init)) as { name: string }).name === "engine_open_cockpit",
    )?.[1]
    expect(JSON.parse(bodyOf(call))).toEqual({
      name: "engine_open_cockpit",
      arguments: { view: "jobs", engine: "prod" },
    })
    expect(new Headers(call?.headers).get("x-pulse-csrf")).toBe("csrf-1")
  })

  // The cockpit keeps its head over a route that cannot read its engine; a refusal stays the frame's.
  it("hands the view the cockpit's data for a start that failed for its engine", async () => {
    const Data: ViewComponent<object> = ({ data }) => (
      <p data-testid="data">{JSON.stringify(data)}</p>
    )
    const failing = (text: string) => () =>
      Response.json({ result: { isError: true, content: [{ type: "text", text }] } })
    const views = { views: { engine_open_cockpit: Data as ViewComponent } }
    await start(
      "/app/engines/down/jobs",
      { call: failing("[503 ProcessEngineException] Engine is shutting down (engine down)") },
      views,
    )
    expect(JSON.parse(screen.getByTestId("data").textContent ?? "")).toEqual({
      engineId: "down",
      engines: [],
      start: null,
      startView: { section: "jobs" },
    })
    await stopPage()
    await start(
      "/app/engines/c8/jobs",
      { call: failing('[ENGINE_DIALECT_NOT_SERVED] Engine "c8" is a Camunda 8 engine') },
      views,
    )
    expect(screen.queryByTestId("data")).toBeNull()
    expect(screen.getByRole("link", { name: "Go to the start page" })).toBeTruthy()
  })

  it("opens the start page on /app, every engine read through its engine screen and no view called", async () => {
    const env = await start("/app", { call: twoEngines })
    expect(screen.getByRole("heading", { level: 1, name: "All engines" })).toBeTruthy()
    expect(document.title).toBe("All engines · Pulse")
    expect(callsOf(env.fetch, ENGINE_SCREEN_FEED)).toEqual([{ engine: "prod" }, { engine: "test" }])
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([])
    expect(env.browser.writes).toEqual([])
  })

  it("gives /app to the engine of a server with one engine and no board, its processes the page's screen", async () => {
    const env = await start("/app")
    expect(env.browser.writes).toEqual([
      { entry: "replace", url: "/app/engines/prod", state: null },
    ])
    expect(callsOf(env.fetch, ENGINE_SCREEN_FEED)).toEqual([{ engine: "prod" }])
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([])
    // No move of the reader's: the focus stays where the page starts, the skip link the first stop.
    const heading = await screen.findByRole("heading", { level: 1, name: "prod" })
    expect(document.activeElement).not.toBe(heading)
    expect(document.activeElement).toBe(document.body)
    expect(screen.getAllByRole("link")[0]?.textContent).toBe("Skip to content")
  })

  it("opens a board's page on the cockpit's board view, the document titled by the board", async () => {
    const env = await start("/app/boards/invoices")
    expect(screen.getByTestId("view").textContent).toBe("Hi")
    expect(viewArgs(env.fetch)).toEqual({ view: "board", board: "invoices" })
    expect(document.title).toBe("Board invoices · Pulse")
  })

  it("says the session ended when a call finds it gone, and signs in back to the page", async () => {
    const env = await start("/app/engines/prod/jobs?failed=true", {
      call: () => Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
    })
    expect(screen.getByRole("status").textContent).toContain("Your session has ended")
    // The page's one way out keeps its words at every width: no icon it could collapse to.
    const signIn = screen.getByRole("button", { name: "Sign in again" })
    expect(signIn.querySelector("svg")).toBeNull()
    fireEvent.click(signIn)
    expect(env.assign).toHaveBeenCalledWith(
      "/app/auth/login?return=%2Fapp%2Fengines%2Fprod%2Fjobs%3Ffailed%3Dtrue",
    )
  })

  it("signs out once, saying so while it runs, and goes where the server names", async () => {
    let answer: (response: Response) => void = () => undefined
    const env = await start("/app", {
      logout: () => new Promise<Response>((resolve) => (answer = resolve)),
    })
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    const busy = screen.getByRole("button", { name: "Signing out…" })
    expect(busy.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(busy)
    await act(async () => answer(Response.json({ location: "https://idp.example/logout" })))
    await settled()
    expect(env.fetch.mock.calls.filter(([path]) => path === "/app/auth/logout")).toHaveLength(1)
    expect(env.assign).toHaveBeenCalledWith("https://idp.example/logout")
  })

  it("stays and says so where the sign-out did not go through", async () => {
    const env = await start("/app", { logout: () => Response.json({}, { status: 500 }) })
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    await settled()
    expect(screen.getByRole("alert").textContent).toContain("Sign-out didn't go through")
    expect(
      screen.getByRole("button", { name: "Sign out" }).getAttribute("aria-disabled"),
    ).toBeNull()
    expect(env.assign).not.toHaveBeenCalled()
  })

  it("speaks the page's language", async () => {
    document.documentElement.lang = "de"
    await start("/app")
    expect(screen.getByText("Angemeldet als Alice Adams")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeTruthy()
  })

  it("mounts into the document's #root without a container", async () => {
    await start("/app/boards/invoices", {}, { inRoot: true })
    expect(document.getElementById("root")?.textContent).toContain("Hi")
  })
})

describe("a page without a session", () => {
  it("says the session ended and signs in back to the page, calling no tool", async () => {
    const env = await start("/app/engines/prod/instances/pi-1?tab=history", {
      session: () => Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
    })
    expect(screen.getByRole("heading", { name: "Your session has ended" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
      `/app/auth/login?return=${encodeURIComponent("/app/engines/prod/instances/pi-1?tab=history")}`,
    )
    expect(env.fetch.mock.calls.map(([path]) => path)).toEqual(["/app/api/session"])
  })

  it("offers to try again where the session could not be read", async () => {
    const env = await start("/app", { session: () => new Response("busy", { status: 502 }) })
    expect(screen.getByRole("heading", { name: "Pulse doesn't answer" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(env.reload).toHaveBeenCalledOnce()
  })
})

describe("the signed-out page", () => {
  it("says why per reason and starts a sign-in back to /app, reading no session", async () => {
    const env = await start("/app/signed-out?reason=expired")
    expect(screen.getByRole("heading", { name: "Your sign-in took too long" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
      "/app/auth/login",
    )
    expect(env.fetch).not.toHaveBeenCalled()
  })

  it("names the sign-out after one, and offers to try again while the provider is away", async () => {
    await start("/app/signed-out")
    expect(screen.getByRole("heading", { name: "You signed out" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy()
    await stopPage()
    await start("/app/signed-out?reason=unavailable")
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/app/auth/login",
    )
  })

  it("speaks German where the page does", async () => {
    document.documentElement.lang = "de"
    await start("/app/signed-out?reason=audience")
    expect(
      screen.getByRole("heading", { name: "Anmeldung gilt nicht für diesen Server" }),
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "Erneut anmelden" })).toBeTruthy()
  })
})

describe("PageNotices", () => {
  it("tells its listeners of a new notice once, until they leave", () => {
    const notices = new PageNotices()
    const listener = vi.fn()
    const leave = notices.subscribe(listener)
    notices.show("ended")
    notices.show("ended")
    expect([notices.current(), listener.mock.calls.length]).toEqual(["ended", 1])
    leave()
    notices.show("sign-out-failed")
    expect([notices.current(), listener.mock.calls.length]).toEqual(["sign-out-failed", 1])
  })
})

/**
 * A view that moves as the cockpit does: it reports its place, goes on to another with a push and
 * goes where Back leads; it shows where it is and what the page's address put it at.
 */
const Mover: ViewComponent<object> = () => {
  const location = useHostLocation()
  const { callTool } = useViewHost()
  const [at, setAt] = useState<string>(location?.start ? "fleet" : "jobs")
  useEffect(() => {
    location?.report({ args: { view: at, engine: "prod" }, memo: { at } }, "replace")
    return location?.subscribe((place) => {
      if (place.args.view === "nowhere") return false
      setAt(String(place.args.view))
      return true
    })
  }, [location, at])
  return (
    <>
      <h1>{at}</h1>
      <button
        type="button"
        onClick={() => {
          location?.report(
            { args: { view: "incidents", engine: "prod" }, memo: { at: "incidents" } },
            "push",
          )
          setAt("incidents")
          void callTool("engine_list_engines", {}).catch(() => undefined)
        }}
      >
        Go
      </button>
    </>
  )
}
const MOVER = { views: { engine_open_cockpit: Mover as ViewComponent } }

/** A view that shows where the page's address put it beyond its start. */
const Start: ViewComponent<object> = () => (
  <p data-testid="start">{JSON.stringify(useHostLocation()?.start ?? null)}</p>
)
const START = { views: { engine_open_cockpit: Start as ViewComponent } }

/** The landing's start as the cockpit tool answers it, every configured engine in its data. */
const landingNaming = (engine: string) => () =>
  Response.json({
    result: {
      content: [{ type: "text", text: "{}" }],
      structuredContent: { engineId: null, engines: [{ id: engine }], start: null },
    },
  })

describe("the page's address follows the view (N1)", () => {
  it("names each place the view reports, a move as a new entry of the browser's history", async () => {
    const { browser } = await start("/app/engines/prod/jobs", {}, MOVER)
    expect(browser.writes[0]).toEqual({
      entry: "replace",
      url: "/app/engines/prod/jobs",
      state: { at: "jobs" },
    })
    await act(async () => screen.getByRole("button", { name: "Go" }).click())
    expect(browser.writes.find((write) => write.entry === "push")).toEqual({
      entry: "push",
      url: "/app/engines/prod/incidents",
      state: { at: "incidents" },
    })
    expect(browser.location.pathname).toBe("/app/engines/prod/incidents")
  })

  it("leads the view back on Back, and starts it anew at an entry it does not go to", async () => {
    const env = await start("/app/engines/prod/jobs", {}, MOVER)
    await act(async () => screen.getByRole("button", { name: "Go" }).click())
    await env.browser.back("/app/engines/prod/jobs", { at: "jobs" })
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("jobs")
    expect(callsOf(env.fetch, "engine_open_cockpit")).toHaveLength(1)
    await env.browser.back("/app/cockpit?view=nowhere&engine=prod")
    // The page navigates itself: the view starts anew at the entry, the page stays loaded.
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([
      { view: "jobs", engine: "prod" },
      { view: "nowhere", engine: "prod" },
    ])
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("jobs")
    expect(env.reload).not.toHaveBeenCalled()
  })

  it("gives the cross-engine overview's old address to the start page, before it reads its session", async () => {
    const env = await start("/app/fleet", { call: twoEngines }, MOVER)
    expect(env.browser.writes[0]).toEqual({ entry: "replace", url: "/app", state: null })
    expect(screen.getByRole("heading", { level: 1, name: "All engines" })).toBeTruthy()
    expect(viewArgs(env.fetch)).toBeUndefined()
  })

  it("starts an engine's own address on the landing, the view told the engine", async () => {
    // An engine the cockpit shows without sections has this address too; a server of Camunda 8
    // clusters alone takes no `engine`, so the page never hands the tool one here.
    const env = await start("/app/engines/orders-c8", { call: landingNaming("orders-c8") }, START)
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([{ view: "landing" }])
    expect(JSON.parse(screen.getByTestId("start").textContent ?? "")).toEqual({
      args: { view: "overview", engine: "orders-c8" },
    })
  })

  it.each([
    ["en", "Engine no-such isn't on this server", "Go to the start page"],
    ["de", "Die Engine no-such gibt es auf diesem Server nicht", "Zur Startseite"],
  ])(
    "refuses an engine its address names that the server does not configure (%s)",
    async (lang, title, link) => {
      document.documentElement.lang = lang
      const env = await start("/app/engines/no-such", { call: landingNaming("prod") }, START)
      const alert = screen.getByRole("alert")
      expect(within(alert).getByRole("heading", { level: 1 }).textContent).toBe(title)
      expect(within(alert).getByRole("link", { name: link }).getAttribute("href")).toBe("/app")
      expect(within(alert).queryByRole("button")).toBeNull()
      expect(document.title).toBe(`${title} · Pulse`)
      // The view never opens to fall back from it: its address stays, a reload says the same.
      expect(screen.queryByTestId("start")).toBeNull()
      expect(env.browser.writes).toEqual([])
      expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([{ view: "landing" }])
    },
  )

  it("leaves a page without the view its address names to the view frame's own state", async () => {
    const env = await start("/app/engines/no-such", {}, { views: {} })
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("can't show this view")
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([])
  })

  it("lets go of Back and Forward with the page", async () => {
    const env = await start("/app/engines/prod/jobs", {}, MOVER)
    expect(env.browser.listeners.size).toBe(1)
    await stopPage()
    expect(env.browser.listeners.size).toBe(0)
  })

  it("signs in back to where the reader moved, once the session ended", async () => {
    const env = await start(
      "/app/engines/prod/jobs",
      {
        call: ({ name }) =>
          name === "engine_open_cockpit"
            ? Response.json({ result: { content: [], structuredContent: {} } })
            : Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
      },
      MOVER,
    )
    await act(async () => screen.getByRole("button", { name: "Go" }).click())
    await settled()
    fireEvent.click(await screen.findByRole("button", { name: "Sign in again" }))
    expect(env.assign).toHaveBeenCalledWith(
      `/app/auth/login?return=${encodeURIComponent("/app/engines/prod/incidents")}`,
    )
  })
})

describe("an old address", () => {
  it("gives way to the view's own in its entry, before the page reads its session", async () => {
    const env = await start("/app/cockpit?view=jobs&engine=prod&failedOnly=true")
    expect(env.browser.writes[0]).toEqual({
      entry: "replace",
      url: "/app/engines/prod/jobs?failed=true",
      state: null,
    })
    expect(viewArgs(env.fetch)).toEqual({ view: "jobs", engine: "prod", failedOnly: true })
  })

  it("is replaced by the view's own where the session ended, so the sign-in comes back there", async () => {
    await start("/app/cockpit?view=instance-detail&engine=prod&processInstanceId=pi-1", {
      session: () => Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
    })
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
      `/app/auth/login?return=${encodeURIComponent("/app/engines/prod/instances/pi-1")}`,
    )
  })

  it("of an engine the server does not configure leads to its own address, refused there", async () => {
    const env = await start("/app/cockpit?engine=no-such", { call: landingNaming("prod") }, START)
    expect(env.browser.writes).toEqual([
      { entry: "replace", url: "/app/engines/no-such", state: null },
    ])
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Engine no-such isn't on this server",
    )
  })

  it("stays where no address names its view whole, and the tool says why", async () => {
    const env = await start("/app/cockpit?view=jobs&engine=prod&utm_source=mail")
    expect(env.browser.writes).toEqual([])
    expect(viewArgs(env.fetch)).toEqual({ view: "jobs", engine: "prod", utm_source: "mail" })
  })
})

/** The navigation's entry to the start page, on the wide layout's side. */
const startEntry = () => within(screen.getByRole("banner")).getByRole("link", { name: "Start" })

describe("the navigation's way to the start page", () => {
  it("goes there in the page, a new entry, the document titled by the route it leads to", async () => {
    const env = await start("/app/boards/invoices", { call: twoEngines })
    expect(document.title).toBe("Board invoices · Pulse")
    const home = startEntry()
    expect(home.getAttribute("href")).toBe("/app")
    await act(async () => fireEvent.click(home))
    await settled()
    expect(env.browser.writes.at(-1)).toEqual({ entry: "push", url: "/app", state: null })
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([
      { view: "board", board: "invoices" },
    ])
    expect(document.title).toBe("All engines · Pulse")
    expect(env.assign).not.toHaveBeenCalled()
    expect(env.reload).not.toHaveBeenCalled()
  })

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])(
    "leaves a click with %o to the browser: a new tab, a new window, a download",
    async (modifier) => {
      const env = await start("/app/boards/invoices")
      const home = startEntry()
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifier })
      await act(async () => home.dispatchEvent(click))
      expect(env.browser.writes).toEqual([])
      expect(callsOf(env.fetch, "engine_open_cockpit")).toHaveLength(1)
    },
  )
})

describe("the page's frame leads past its navigation (A5)", () => {
  it("offers a skip link first, which focuses the content's heading and keeps the address", async () => {
    const env = await start("/app/engines/prod/jobs", {}, MOVER)
    const banner = screen.getByRole("banner")
    const skip = within(banner).getByRole("link", { name: "Skip to content" })
    expect(within(banner).getAllByRole("link")[0]).toBe(skip)
    expect(skip.className).toContain("sr-only")
    expect(skip.className).toContain("focus:not-sr-only")
    fireEvent.click(skip)
    const heading = screen.getByRole("heading", { level: 1 })
    expect(document.activeElement).toBe(heading)
    expect(heading.getAttribute("tabindex")).toBe("-1")
    expect(env.browser.location.pathname).toBe("/app/engines/prod/jobs")
    // A second skip keeps the heading as it is.
    fireEvent.click(skip)
    expect(document.activeElement).toBe(heading)
  })

  it("focuses the content itself where it has no heading, and nothing where there is none", async () => {
    await start("/app/engines/prod/jobs")
    const skip = screen.getByRole("link", { name: "Skip to content" })
    fireEvent.click(skip)
    const content = document.getElementById("content")!
    expect(document.activeElement).toBe(content)
    expect(content.getAttribute("tabindex")).toBe("-1")
    content.removeAttribute("id")
    skip.focus()
    fireEvent.click(skip)
    expect(document.activeElement).toBe(skip)
  })
})
