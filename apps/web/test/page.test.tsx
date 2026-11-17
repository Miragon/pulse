// @vitest-environment happy-dom
import { act, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
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
