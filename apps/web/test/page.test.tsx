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
import { bodyOf, callsOf, settled, start, stopPage } from "./page.test-support.js"

/** The page as a browser starts it: its route, its session, its frame and the view in it. */

afterEach(stopPage)

/** The arguments of the page's first call of the view tool. */
const viewArgs = (fetch: Parameters<typeof callsOf>[0]): unknown =>
  callsOf(fetch, "engine_open_cockpit")[0]

describe("a page with a session", () => {
  it("shows the bar, who is signed in and the view the query names, called with the CSRF token", async () => {
    const env = await start("/app/cockpit?view=jobs&engine=prod")
    const banner = screen.getByRole("banner")
    expect(within(banner).getByText("Pulse")).toBeTruthy()
    // The Komet is the app level's (the cockpit's landing), never the bar of every page.
    expect(banner.querySelector("[data-brand-mark]")).toBeNull()
    expect(within(banner).getByText("Signed in as Alice Adams")).toBeTruthy()
    expect(within(banner).getByRole("button", { name: "Sign out" })).toBeTruthy()
    expect(screen.getByTestId("view").textContent).toBe("Hi")
    const [, call] = env.fetch.mock.calls.find(([path]) => path === "/app/api/call") ?? []
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
      "/app/cockpit?view=jobs&engine=down",
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
      "/app/cockpit?view=jobs&engine=c8",
      { call: failing('[ENGINE_DIALECT_NOT_SERVED] Engine "c8" is a Camunda 8 engine') },
      views,
    )
    expect(screen.queryByTestId("data")).toBeNull()
    expect(screen.getByRole("link", { name: "Go to the start page" })).toBeTruthy()
  })

  it("opens the cockpit's landing on /app, the document titled Pulse", async () => {
    const env = await start("/app")
    expect(viewArgs(env.fetch)).toEqual({ view: "landing" })
    expect(document.title).toBe("Pulse")
  })

  it("opens a board's page on the cockpit's board view, the document titled by the board", async () => {
    const env = await start("/app/boards/invoices")
    expect(screen.getByTestId("view").textContent).toBe("Hi")
    expect(viewArgs(env.fetch)).toEqual({ view: "board", board: "invoices" })
    expect(document.title).toBe("Board invoices · Pulse")
  })

  it("says the session ended when a call finds it gone, and signs in back to the page", async () => {
    const env = await start("/app/cockpit?view=jobs", {
      call: () => Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
    })
    expect(screen.getByRole("status").textContent).toContain("Your session has ended")
    // The page's one way out keeps its words at every width: no icon it could collapse to.
    const signIn = screen.getByRole("button", { name: "Sign in again" })
    expect(signIn.querySelector("svg")).toBeNull()
    fireEvent.click(signIn)
    expect(env.assign).toHaveBeenCalledWith("/app/auth/login?return=%2Fapp%2Fcockpit%3Fview%3Djobs")
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
    await start("/app", {}, { inRoot: true })
    expect(document.getElementById("root")?.textContent).toContain("Hi")
  })
})

describe("a page without a session", () => {
  it("says the session ended and signs in back to the page, calling no tool", async () => {
    const env = await start("/app/cockpit?view=jobs", {
      session: () => Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
    })
    expect(screen.getByRole("heading", { name: "Your session has ended" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
      "/app/auth/login?return=%2Fapp%2Fcockpit%3Fview%3Djobs",
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

describe("the page's address follows the view (N1)", () => {
  it("names each place the view reports, a move as a new entry of the browser's history", async () => {
    const { browser } = await start("/app/cockpit?view=jobs&engine=prod", {}, MOVER)
    expect(browser.writes[0]).toEqual({
      entry: "replace",
      url: "/app/cockpit?view=jobs&engine=prod",
      state: { at: "jobs" },
    })
    await act(async () => screen.getByRole("button", { name: "Go" }).click())
    expect(browser.writes.find((write) => write.entry === "push")).toEqual({
      entry: "push",
      url: "/app/cockpit?view=incidents&engine=prod",
      state: { at: "incidents" },
    })
    expect(browser.location.search).toBe("?view=incidents&engine=prod")
  })

  it("leads the view back on Back, and loads anew an entry the view does not go to", async () => {
    const env = await start("/app/cockpit?view=jobs&engine=prod", {}, MOVER)
    await act(async () => screen.getByRole("button", { name: "Go" }).click())
    await env.browser.back("/app/cockpit?view=jobs&engine=prod", { at: "jobs" })
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("jobs")
    expect(env.reload).not.toHaveBeenCalled()
    await env.browser.back("/app/cockpit?view=nowhere&engine=prod")
    expect(env.reload).toHaveBeenCalledTimes(1)
  })

  it("starts the cross-engine overview's page on the landing, the view told where it is", async () => {
    const env = await start("/app/fleet", {}, MOVER)
    expect(viewArgs(env.fetch)).toEqual({ view: "landing" })
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("fleet")
  })

  it("starts an engine its address names alone on the landing, the view told the engine", async () => {
    // The place the cockpit writes for an engine without sections; a server of Camunda 8 clusters
    // alone takes no `engine`, so the page never hands it one.
    const Start: ViewComponent<object> = () => (
      <p data-testid="start">{JSON.stringify(useHostLocation()?.start ?? null)}</p>
    )
    const env = await start(
      "/app/cockpit?engine=orders-c8",
      {},
      {
        views: { engine_open_cockpit: Start as ViewComponent },
      },
    )
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([{ view: "landing" }])
    expect(JSON.parse(screen.getByTestId("start").textContent ?? "")).toEqual({
      args: { engine: "orders-c8" },
    })
  })

  it("lets go of Back and Forward with the page", async () => {
    const env = await start("/app/cockpit?view=jobs&engine=prod", {}, MOVER)
    expect(env.browser.listeners.size).toBe(1)
    await stopPage()
    expect(env.browser.listeners.size).toBe(0)
  })

  it("signs in back to where the reader moved, once the session ended", async () => {
    const env = await start(
      "/app/cockpit?view=jobs&engine=prod",
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
      `/app/auth/login?return=${encodeURIComponent("/app/cockpit?view=incidents&engine=prod")}`,
    )
  })
})

describe("the page's bar leads past itself (A5)", () => {
  it("offers a skip link first, which focuses the content's heading and keeps the address", async () => {
    const env = await start("/app/cockpit?view=jobs&engine=prod", {}, MOVER)
    const banner = screen.getByRole("banner")
    const skip = within(banner).getByRole("link", { name: "Skip to content" })
    expect(within(banner).getAllByRole("link")[0]).toBe(skip)
    expect(skip.className).toContain("sr-only")
    expect(skip.className).toContain("focus:not-sr-only")
    fireEvent.click(skip)
    const heading = screen.getByRole("heading", { level: 1 })
    expect(document.activeElement).toBe(heading)
    expect(heading.getAttribute("tabindex")).toBe("-1")
    expect(env.browser.location.pathname).toBe("/app/cockpit")
    // A second skip keeps the heading as it is.
    fireEvent.click(skip)
    expect(document.activeElement).toBe(heading)
  })

  it("focuses the content itself where it has no heading, and nothing where there is none", async () => {
    await start("/app/cockpit?view=jobs&engine=prod")
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
