import { describe, expect, it, vi } from "vitest"
import type { ViewPlace } from "@miragon/pulse-widget-shell/widgets"
import { pageAddress, type AddressEnv } from "../src/address.js"

/** A browser's location and history as the page's address uses them. */
function browserAt(url: string) {
  const location = { pathname: "", search: "" }
  let state: unknown = null
  const moveTo = (to: string, data: unknown) => {
    const next = new URL(to, "http://localhost")
    location.pathname = next.pathname
    location.search = next.search
    state = data
  }
  moveTo(url, null)
  let listener: (() => void) | undefined
  const unsubscribe = vi.fn()
  const push = vi.fn((data: unknown, _unused: string, to: string) => moveTo(to, data))
  const replace = vi.fn((data: unknown, _unused: string, to: string) => moveTo(to, data))
  const env: AddressEnv = {
    location,
    history: {
      get state() {
        return state
      },
      pushState: push,
      replaceState: replace,
    },
    onPopState: (next) => {
      listener = next
      return unsubscribe
    },
    reload: vi.fn(),
  }
  const back = (to: string, data: unknown = null) => {
    moveTo(to, data)
    listener?.()
  }
  return { env, location, back, unsubscribe, push, replace }
}

describe("the page's address follows the view (N1)", () => {
  it("writes each place the view reports as the address the page opens it at", () => {
    const { env, location, push, replace } = browserAt("/app/cockpit?engine=prod-a")
    const { location: address } = pageAddress(env)
    const memo = { trail: ["Overview"] }
    address.report({ args: { view: "overview", engine: "prod-a" }, memo }, "replace")
    expect(replace).toHaveBeenCalledWith(memo, "", "/app/cockpit?view=overview&engine=prod-a")
    address.report(
      { args: { view: "process-detail", engine: "prod-a", processDefinitionKey: "invoice" } },
      "push",
    )
    expect(push).toHaveBeenCalledWith(
      null,
      "",
      "/app/cockpit?view=process-detail&engine=prod-a&processDefinitionKey=invoice",
    )
    address.report({ args: { view: "board", board: "ops" } }, "push")
    address.report({ args: { view: "landing" } }, "push")
    address.report({ args: { view: "fleet" } }, "push")
    expect(push.mock.calls.map((call) => call[2])).toEqual([
      "/app/cockpit?view=process-detail&engine=prod-a&processDefinitionKey=invoice",
      "/app/boards/ops",
      "/app",
      "/app/fleet",
    ])
    expect(`${location.pathname}${location.search}`).toBe("/app/fleet")
  })

  it("adds no second entry of the address the reader is on", () => {
    const { env, push, replace } = browserAt("/app")
    const { location: address } = pageAddress(env)
    address.report({ args: { view: "landing" }, memo: { a: 1 } }, "push")
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith({ a: 1 }, "", "/app")
  })

  it("leads the view to the entry's place on Back, with the memo the entry kept", () => {
    const { env, back } = browserAt("/app/cockpit?view=jobs&engine=prod-a")
    const { location: address } = pageAddress(env)
    const seen: ViewPlace[] = []
    address.subscribe((place) => {
      seen.push(place)
      return true
    })
    back("/app/cockpit?view=jobs&engine=prod-b&failedOnly=true", { trail: 1 })
    back("/app/fleet")
    back("/app/boards/ops")
    expect(seen).toEqual([
      { args: { view: "jobs", engine: "prod-b", failedOnly: true }, memo: { trail: 1 } },
      { args: { view: "fleet" }, memo: null },
      { args: { view: "board", board: "ops" }, memo: null },
    ])
    expect(env.reload).not.toHaveBeenCalled()
  })

  it("loads an entry anew that no view goes to itself, or that is no view's", () => {
    const { env, back } = browserAt("/app")
    const { location: address } = pageAddress(env)
    back("/app/cockpit?view=nowhere")
    expect(env.reload).toHaveBeenCalledTimes(1)
    const stop = address.subscribe(() => false)
    back("/app/cockpit?view=jobs")
    expect(env.reload).toHaveBeenCalledTimes(2)
    stop()
    address.subscribe(() => true)
    back("/app/signed-out")
    expect(env.reload).toHaveBeenCalledTimes(3)
  })

  it("names where the address put the view beyond its arguments, and stops with the page", () => {
    const { env, unsubscribe } = browserAt("/app/fleet")
    const { location: address, stop } = pageAddress(env, { view: "fleet" })
    expect(address.start).toEqual({ args: { view: "fleet" } })
    expect(pageAddress(env).location.start).toBeUndefined()
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
