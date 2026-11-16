// @vitest-environment happy-dom
import { act, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ViewComponent, ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { PageNotices } from "../src/notices.js"
import { startPage, type PageEnv } from "../src/start.js"

/**
 * The page as a browser starts it: its route, its session, its frame and the view in it, over a
 * fake of the server's routes under /app.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SESSION = { name: "Alice Adams", csrf: "csrf-1", expiresAt: 0 }

/** The view the page shows: the start its tool answered with. */
const Greeting: ViewComponent<{ greeting: string }> = ({ data }) => (
  <p data-testid="view">{data.greeting}</p>
)
const VIEWS: ViewMap = { engine_open_cockpit: Greeting as ViewComponent }

const viewResult = {
  content: [{ type: "text", text: "{}" }],
  structuredContent: { greeting: "Hi" },
}

interface Server {
  session?: () => Response
  call?: (body: { name: string; arguments?: Record<string, unknown> }) => Response
  logout?: () => Response | Promise<Response>
}

/** The path a request names. */
const pathOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url

/** The text of a request's body. */
const bodyOf = (init: RequestInit | undefined): string =>
  typeof init?.body === "string" ? init.body : ""

/** The server's routes the page reaches, each answered as `server` says. */
function fakeFetch(server: Server) {
  return vi.fn<typeof fetch>((input, init) => {
    const path = pathOf(input)
    if (path === "/app/api/session")
      return Promise.resolve(server.session?.() ?? Response.json(SESSION))
    if (path === "/app/api/call") {
      const body = JSON.parse(bodyOf(init)) as { name: string }
      return Promise.resolve(server.call?.(body) ?? Response.json({ result: viewResult }))
    }
    if (path === "/app/auth/logout") {
      return Promise.resolve(server.logout?.() ?? Response.json({ location: "/app/signed-out" }))
    }
    return Promise.reject(new Error(`No route ${path}`))
  })
}

let unmount: (() => void) | undefined

/** Starts the page at `url` over `server`, in a container unless `inRoot`; its hands recorded. */
async function start(url: string, server: Server = {}, { inRoot = false } = {}) {
  const { pathname, search, origin } = new URL(url, "http://localhost")
  const fetch = fakeFetch(server)
  const assign = vi.fn<(url: string) => void>()
  const reload = vi.fn<() => void>()
  const env: PageEnv = {
    views: VIEWS,
    location: { pathname, search, origin },
    fetch,
    assign,
    reload,
  }
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    unmount = await startPage(inRoot ? env : { ...env, container })
  })
  await settled()
  return { fetch, assign, reload }
}

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

afterEach(async () => {
  await act(async () => unmount?.())
  unmount = undefined
  document.body.innerHTML = ""
  document.documentElement.lang = ""
  document.documentElement.removeAttribute("class")
})

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

  it("says the session ended when a call finds it gone, and signs in back to the page", async () => {
    const env = await start("/app/cockpit?view=jobs", {
      call: () => Response.json({ code: "signed_out", message: "No session." }, { status: 401 }),
    })
    expect(screen.getByRole("status").textContent).toContain("Your session has ended")
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }))
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
    await act(async () => unmount?.())
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
