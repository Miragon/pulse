import { describe, expect, it, vi } from "vitest"
import type { ViewPlace } from "@miragon/pulse-widget-shell/widgets"
import { createPageRouter, type RouterEnv } from "../src/router/router.js"
import { viewRouteOf } from "../src/router/routes.js"

/** A browser's location and history as the router uses them, at `url`. */
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
  const env: RouterEnv = {
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
  /** Back or Forward to the entry at `to`, which kept `data`. */
  const back = (to: string, data: unknown = null) => {
    moveTo(to, data)
    listener?.()
  }
  const here = () => `${location.pathname}${location.search}`
  return { env, here, back, unsubscribe, push, replace }
}

/** The router of a page opened at `url`, with its browser. */
function routerAt(url: string) {
  const browser = browserAt(url)
  const router = createPageRouter(browser.env, viewRouteOf(browser.env.location))
  return { ...browser, router }
}

describe("the view's moves on the page's address", () => {
  it("writes each place the view reports as its canonical address, a drill as a new entry", () => {
    const { router, push, replace, here } = routerAt("/app/engines/prod-a")
    const { location } = router.state().shown
    const memo = { trail: ["Overview"] }
    location.report({ args: { view: "overview", engine: "prod-a" }, memo }, "replace")
    expect(replace).toHaveBeenCalledWith(memo, "", "/app/engines/prod-a")
    location.report(
      { args: { view: "process-detail", engine: "prod-a", processDefinitionKey: "invoice" } },
      "push",
    )
    location.report({ args: { view: "board", board: "ops" } }, "push")
    location.report({ args: { view: "landing" } }, "push")
    location.report({ args: { view: "fleet" } }, "push")
    expect(push.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      [null, "/app/engines/prod-a/processes/invoice"],
      [null, "/app/boards/ops"],
      [null, "/app"],
      [null, "/app/fleet"],
    ])
    expect(here()).toBe("/app/fleet")
  })

  it("follows the view's moves with its route, and keeps the view it started", () => {
    const { router } = routerAt("/app/engines/prod-a")
    const { shown } = router.state()
    const listener = vi.fn()
    const leave = router.subscribe(listener)
    shown.location.report({ args: { view: "jobs", engine: "prod-a" } }, "push")
    expect(router.state().route.place).toEqual({ view: "jobs", engine: "prod-a" })
    expect(router.state().shown).toBe(shown)
    expect(listener).toHaveBeenCalledTimes(1)
    leave()
    shown.location.report({ args: { view: "incidents", engine: "prod-a" } }, "push")
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("adds no second entry of the address the reader is on", () => {
    const { router, push, replace } = routerAt("/app")
    router.state().shown.location.report({ args: { view: "landing" }, memo: { a: 1 } }, "push")
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith({ a: 1 }, "", "/app")
  })

  it("keeps the address the reader is on for its own place: an incident under its instance", () => {
    const incident = "/app/engines/prod-a/instances/pi-1/incidents/inc-1"
    const { router, replace, push, here } = routerAt(incident)
    const { location } = router.state().shown
    const place = { view: "incident-detail", engine: "prod-a", incidentId: "inc-1" }
    location.report({ args: place, memo: { at: 1 } }, "replace")
    expect(replace).toHaveBeenCalledWith({ at: 1 }, "", incident)
    // Elsewhere the cockpit names the incident alone: its query, until the page finds the instance.
    location.report({ args: { ...place, incidentId: "inc-2" } }, "push")
    expect(push).toHaveBeenCalledWith(
      null,
      "",
      "/app/cockpit?view=incident-detail&engine=prod-a&incidentId=inc-2",
    )
    expect(here()).toBe("/app/cockpit?view=incident-detail&engine=prod-a&incidentId=inc-2")
  })

  it("tells the view where the address put it beyond its arguments", () => {
    expect(routerAt("/app/fleet").router.state().shown.location.start).toEqual({
      args: { view: "fleet" },
    })
    expect(routerAt("/app/engines/c8").router.state().shown.location.start).toEqual({
      args: { view: "overview", engine: "c8" },
    })
    expect(routerAt("/app/engines/prod-a/jobs").router.state().shown.location).not.toHaveProperty(
      "start",
    )
  })
})

describe("Back and Forward", () => {
  it("lead the view to the entry's place, with the memo the entry kept", () => {
    const { router, back, env } = routerAt("/app/engines/prod-a/jobs")
    const { shown } = router.state()
    const seen: ViewPlace[] = []
    shown.location.subscribe((place) => {
      seen.push(place)
      return true
    })
    back("/app/engines/prod-b/jobs?failed=true", { trail: 1 })
    back("/app/fleet")
    back("/app/boards/ops")
    expect(seen).toEqual([
      { args: { view: "jobs", engine: "prod-b", failedOnly: true }, memo: { trail: 1 } },
      { args: { view: "fleet" }, memo: null },
      { args: { view: "board", board: "ops" }, memo: null },
    ])
    expect(router.state().route.place).toEqual({ view: "board", board: "ops" })
    expect(router.state().shown).toBe(shown)
    expect(env.reload).not.toHaveBeenCalled()
  })

  it("start the view anew at an entry it does not go to, without loading the page", () => {
    const { router, back, env } = routerAt("/app/engines/prod-a/jobs")
    const first = router.state().shown
    const stop = first.location.subscribe(() => false)
    back("/app/engines/prod-a/processes/invoice")
    const next = router.state().shown
    expect(next.generation).toBe(first.generation + 1)
    expect(next.start.args).toEqual({
      view: "process-detail",
      engine: "prod-a",
      processDefinitionKey: "invoice",
    })
    stop()
    // With no view on the page, the same start again is a start of its own.
    back("/app/engines/prod-a/processes/invoice")
    expect(router.state().shown.generation).toBe(first.generation + 2)
    expect(env.reload).not.toHaveBeenCalled()
  })

  it("replace an entry's old address by its canonical one", () => {
    const { back, replace, here } = routerAt("/app")
    back("/app/cockpit?view=jobs&engine=prod-a", { trail: 2 })
    expect(replace).toHaveBeenLastCalledWith({ trail: 2 }, "", "/app/engines/prod-a/jobs")
    expect(here()).toBe("/app/engines/prod-a/jobs")
  })

  it("load anew an entry that names no view, and stop with the page", () => {
    const { router, back, env, unsubscribe } = routerAt("/app")
    back("/app/signed-out")
    expect(env.reload).toHaveBeenCalledOnce()
    router.stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe("a link of the page", () => {
  it("goes to its address in a new entry, where the view goes itself", () => {
    const { router, push, here } = routerAt("/app/engines/prod-a/jobs")
    const seen: ViewPlace[] = []
    router.state().shown.location.subscribe((place) => {
      seen.push(place)
      return true
    })
    router.navigate("/app")
    expect(push).toHaveBeenCalledWith(null, "", "/app")
    expect(seen).toEqual([{ args: { view: "landing" }, memo: null }])
    expect(here()).toBe("/app")
  })

  it("names the entry anew where it leads to the address the reader is on, or is told to", () => {
    const { router, push, replace } = routerAt("/app")
    router.navigate("/app")
    router.navigate("/app/fleet", "replace")
    expect(push).not.toHaveBeenCalled()
    expect(replace.mock.calls.map((call) => call[2])).toEqual(["/app", "/app/fleet"])
    expect(router.state().shown.start.place).toEqual({ view: "fleet" })
  })
})
