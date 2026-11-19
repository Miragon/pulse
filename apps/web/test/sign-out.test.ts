import { describe, expect, it, vi } from "vitest"
import { signOut } from "../src/sign-out.js"

const ORIGIN = "http://localhost"

/** The env of a sign-out over a fetch that answers `answer` (or fails), its places recorded. */
function envOf(answer: () => Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => answer())
  const assign = vi.fn<(url: string) => void>()
  return { fetch, assign, origin: ORIGIN }
}

describe("signOut", () => {
  it("posts the CSRF token to the logout route and goes where the answer names", async () => {
    const env = envOf(() =>
      Promise.resolve(Response.json({ location: "https://idp.example/logout?client_id=web" })),
    )
    expect(await signOut("token-1", env)).toBe(true)
    expect(env.fetch).toHaveBeenCalledWith("/app/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "x-pulse-csrf": "token-1" },
    })
    expect(env.assign).toHaveBeenCalledWith("https://idp.example/logout?client_id=web")
  })

  it("reads a path of the answer against the page's origin", async () => {
    const env = envOf(() => Promise.resolve(Response.json({ location: "/app/signed-out" })))
    expect(await signOut("t", env)).toBe(true)
    expect(env.assign).toHaveBeenCalledWith(`${ORIGIN}/app/signed-out`)
  })

  it("goes to the signed-out page where the server holds no session any more", async () => {
    const env = envOf(() => Promise.resolve(Response.json({}, { status: 401 })))
    expect(await signOut("t", env)).toBe(true)
    expect(env.assign).toHaveBeenCalledWith("/app/signed-out")
  })

  it.each([
    ["a refusal", () => Promise.resolve(Response.json({ message: "no" }, { status: 403 }))],
    ["a failed request", () => Promise.reject(new TypeError("fetch failed"))],
    ["an answer that is no JSON", () => Promise.resolve(new Response("<html>"))],
    ["an answer without a place", () => Promise.resolve(Response.json({ next: "/" }))],
    ["a script URL", () => Promise.resolve(Response.json({ location: "javascript:alert(1)" }))],
    ["a place that is no URL", () => Promise.resolve(Response.json({ location: "http://[" }))],
  ])("stays on the page after %s", async (_, answer) => {
    const env = envOf(answer)
    expect(await signOut("t", env)).toBe(false)
    expect(env.assign).not.toHaveBeenCalled()
  })
})
