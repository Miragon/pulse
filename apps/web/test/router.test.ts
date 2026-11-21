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

/** The engine screen of `engine` with its list's `filter`, every process by default. */
const screenOf = (engine: string, filter: Record<string, unknown> = { scope: "all" }) => ({
  kind: "engine",
  engine,
  filter,
})

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
    back("/app/engines/prod-a/incidents")
    const next = router.state().shown
    expect(next.generation).toBe(first.generation + 1)
    expect(next.start.args).toEqual({ view: "incidents", engine: "prod-a" })
    stop()
    // With no view on the page, the same start again is a start of its own.
    back("/app/engines/prod-a/incidents")
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

describe("the page's own screen (an engine's processes)", () => {
  it("shows it at the engine's own address, the cockpit's start its fallback", () => {
    const { router } = routerAt("/app/engines/prod-a")
    const { route, shown } = router.state()
    expect(route.screen).toEqual(screenOf("prod-a"))
    expect(shown.screen).toEqual(screenOf("prod-a"))
    expect(shown.start.place).toEqual({ view: "overview", engine: "prod-a" })
    expect(routerAt("/app/engines/prod-a/jobs").router.state().shown.screen).toBeUndefined()
  })

  it("claims the overview of an engine, never an engine named alone or another place", () => {
    const { claims } = routerAt("/app").router.state().shown.location
    expect(claims?.({ view: "overview", engine: "prod-a" })).toBe(true)
    expect(claims?.({ engine: "orders-c8" })).toBe(false)
    expect(claims?.({ view: "jobs", engine: "prod-a" })).toBe(false)
    expect(claims?.({ view: "landing" })).toBe(false)
  })

  it("takes over where the view reports a place it claims, the focus moving after a drill", () => {
    const { router, push, here } = routerAt("/app/engines/prod-a/jobs")
    const first = router.state()
    first.shown.location.report({ args: { view: "overview", engine: "prod-a" } }, "push")
    const next = router.state()
    expect(push).toHaveBeenLastCalledWith(null, "", "/app/engines/prod-a")
    expect(here()).toBe("/app/engines/prod-a")
    expect(next.shown.screen).toEqual(screenOf("prod-a"))
    expect(next.shown.generation).toBe(first.shown.generation + 1)
    expect(next.moves).toBe(first.moves + 1)
    // The landing of a server with one engine opens it: its first place names the entry anew.
    const single = routerAt("/app").router
    const before = single.state()
    before.shown.location.report({ args: { view: "overview", engine: "solo" } }, "replace")
    expect(single.state().shown.screen).toEqual(screenOf("solo"))
    expect(single.state().moves).toBe(before.moves)
  })

  it("starts it anew on Back, never asking the view, and the view anew where the page leaves it", () => {
    const { router, back } = routerAt("/app/engines/prod-a/jobs")
    const first = router.state().shown
    const seen: ViewPlace[] = []
    const stop = first.location.subscribe((place) => {
      seen.push(place)
      return true
    })
    back("/app/engines/prod-a")
    expect(seen).toEqual([])
    expect(router.state().shown.screen).toEqual(screenOf("prod-a"))
    expect(router.state().shown.generation).toBe(first.generation + 1)
    // The view left the page with the screen's start.
    stop()
    router.navigate("/app/engines/prod-a/incidents")
    expect(router.state().shown.screen).toBeUndefined()
    expect(router.state().shown.generation).toBe(first.generation + 2)
  })

  it("names the entry anew with the screen's filter: the screen stays, the focus with it", () => {
    const { router, replace, push, here } = routerAt("/app/engines/prod-a")
    const first = router.state()
    const listener = vi.fn()
    router.subscribe(listener)
    router.refine("/app/engines/prod-a?scope=incident&q=order")
    const next = router.state()
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenLastCalledWith(null, "", "/app/engines/prod-a?scope=incident&q=order")
    expect(here()).toBe("/app/engines/prod-a?scope=incident&q=order")
    expect(next.route.screen).toEqual(
      screenOf("prod-a", { scope: "withIncident", search: "order" }),
    )
    expect(next.shown.screen).toEqual(next.route.screen)
    expect(next.shown.generation).toBe(first.shown.generation)
    expect(next.shown.location).toBe(first.shown.location)
    expect(next.moves).toBe(first.moves)
    expect(listener).toHaveBeenCalledOnce()
  })

  it("keeps the screen between two of its entries, each with its filter, the focus moving", () => {
    const { router, back, push } = routerAt("/app/engines/prod-a?scope=incident")
    const first = router.state()
    // The navigation's entry of the engine's processes: a new entry, the list unfiltered.
    router.navigate("/app/engines/prod-a")
    expect(push).toHaveBeenLastCalledWith(null, "", "/app/engines/prod-a")
    expect(router.state().shown.screen).toEqual(screenOf("prod-a"))
    expect(router.state().shown.generation).toBe(first.shown.generation)
    expect(router.state().moves).toBe(first.moves + 1)
    back("/app/engines/prod-a?scope=incident")
    expect(router.state().shown.screen).toEqual(screenOf("prod-a", { scope: "withIncident" }))
    expect(router.state().shown.generation).toBe(first.shown.generation)
    // Another engine's screen is a screen of its own.
    router.navigate("/app/engines/prod-b?scope=incident")
    expect(router.state().shown.screen).toEqual(screenOf("prod-b", { scope: "withIncident" }))
    expect(router.state().shown.generation).toBe(first.shown.generation + 1)
  })

  it("starts the screen anew where the view the page shows left its place, or never had it", () => {
    // The cockpit's one state of a refused profile at the screen's address, then the landing.
    const fallback = routerAt("/app/engines/legacy")
    const before = fallback.router.state().shown
    before.location.report({ args: { view: "landing" } }, "push")
    fallback.router.navigate("/app/engines/legacy")
    expect(fallback.router.state().shown.generation).toBe(before.generation + 1)
    // The landing's cockpit opened an engine without sections, named alone: no screen it shows.
    const landing = routerAt("/app")
    const start = landing.router.state().shown
    start.location.report({ args: { engine: "legacy" } }, "push")
    expect(landing.router.state().route.screen).toEqual(screenOf("legacy"))
    landing.router.navigate("/app/engines/legacy?scope=incident")
    expect(landing.router.state().shown.generation).toBe(start.generation + 1)
    expect(landing.router.state().shown.screen).toEqual(
      screenOf("legacy", { scope: "withIncident" }),
    )
  })
})

describe("the page's instance screen (an instance, an incident under it)", () => {
  const instance = (more: Record<string, unknown> = {}) => ({
    kind: "instance",
    engine: "prod-a",
    instance: "pi-1",
    ...more,
  })

  it("claims an instance's view, its history and an incident, never one whose id is no segment", () => {
    const { claims } = routerAt("/app").router.state().shown.location
    expect(claims?.({ view: "instance-detail", engine: "prod-a", processInstanceId: "pi-1" })).toBe(
      true,
    )
    expect(claims?.({ view: "history", engine: "prod-a", processInstanceId: "pi-1" })).toBe(true)
    expect(claims?.({ view: "incident-detail", engine: "prod-a", incidentId: "inc-1" })).toBe(true)
    expect(claims?.({ view: "instance-detail", engine: "prod-a", processInstanceId: ".." })).toBe(
      false,
    )
    expect(claims?.({ view: "process-instances", engine: "prod-a" })).toBe(false)
  })

  it("shows it at an instance's address, its tab and an incident in focus from the address", () => {
    expect(routerAt("/app/engines/prod-a/instances/pi-1").router.state().shown.screen).toEqual(
      instance(),
    )
    expect(
      routerAt("/app/engines/prod-a/instances/pi-1?tab=waiting").router.state().shown.screen,
    ).toEqual(instance({ tab: "waiting" }))
    expect(
      routerAt("/app/engines/prod-a/instances/pi-1/incidents/inc-1").router.state().shown.screen,
    ).toEqual(instance({ incident: "inc-1" }))
  })

  it("takes over the cockpit's drill to an instance, the focus moving to its heading", () => {
    const { router, push, here } = routerAt("/app/engines/prod-a/instances")
    const first = router.state()
    first.shown.location.report(
      { args: { view: "instance-detail", engine: "prod-a", processInstanceId: "pi-1" } },
      "push",
    )
    expect(push).toHaveBeenLastCalledWith(null, "", "/app/engines/prod-a/instances/pi-1")
    expect(here()).toBe("/app/engines/prod-a/instances/pi-1")
    expect(router.state().shown.screen).toEqual(instance())
    expect(router.state().moves).toBe(first.moves + 1)
  })

  it("names the entry anew with a tab, the screen staying; an incident of it is a subject of its own", () => {
    const { router, replace, push } = routerAt("/app/engines/prod-a/instances/pi-1")
    const first = router.state()
    router.refine("/app/engines/prod-a/instances/pi-1?tab=variables")
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenLastCalledWith(
      null,
      "",
      "/app/engines/prod-a/instances/pi-1?tab=variables",
    )
    expect(router.state().shown.screen).toEqual(instance({ tab: "variables" }))
    expect(router.state().shown.generation).toBe(first.shown.generation)
    expect(router.state().moves).toBe(first.moves)
    router.navigate("/app/engines/prod-a/instances/pi-1/incidents/inc-1")
    expect(router.state().shown.screen).toEqual(instance({ incident: "inc-1" }))
    expect(router.state().shown.generation).toBe(first.shown.generation + 1)
    expect(router.state().moves).toBe(first.moves + 1)
    router.navigate("/app/engines/prod-a/instances/pi-2")
    expect(router.state().shown.screen).toEqual(instance({ instance: "pi-2" }))
    expect(router.state().shown.generation).toBe(first.shown.generation + 2)
  })

  it("leads an incident the cockpit names alone to the page, which finds its instance", () => {
    const { router } = routerAt("/app/engines/prod-a/incidents")
    router
      .state()
      .shown.location.report(
        { args: { view: "incident-detail", engine: "prod-a", incidentId: "inc-9" } },
        "push",
      )
    expect(router.state().shown.screen).toEqual({
      kind: "incident",
      engine: "prod-a",
      incident: "inc-9",
    })
    // The same incident again keeps its screen, which finds its instance once.
    const shown = router.state().shown
    router.navigate("/app/cockpit?view=incident-detail&engine=prod-a&incidentId=inc-9", "replace")
    expect(router.state().shown.generation).toBe(shown.generation)
  })
})

describe("the page's process screen", () => {
  const process = (more: Record<string, unknown> = {}) => ({
    kind: "process",
    engine: "prod-a",
    process: "invoice",
    filter: { scope: "running" },
    ...more,
  })

  it("claims a process's view and the list of its instances, so the cockpit's drill shows it", () => {
    const { router, push } = routerAt("/app/engines/prod-a/instances")
    const { claims } = router.state().shown.location
    expect(claims?.({ view: "process-detail", engine: "prod-a", processDefinitionKey: "a" })).toBe(
      true,
    )
    expect(claims?.({ view: "process-instances", engine: "prod-a" })).toBe(false)
    const first = router.state()
    first.shown.location.report(
      { args: { view: "process-instances", engine: "prod-a", processDefinitionKey: "invoice" } },
      "push",
    )
    expect(push).toHaveBeenLastCalledWith(null, "", "/app/engines/prod-a/instances?process=invoice")
    expect(router.state().shown.screen).toEqual(process())
    expect(router.state().moves).toBe(first.moves + 1)
  })

  it("names the entry anew with a filter, the screen staying; another version a new entry of the same screen", () => {
    const { router, replace, push, back } = routerAt("/app/engines/prod-a/processes/invoice")
    const first = router.state()
    router.refine("/app/engines/prod-a/processes/invoice?scope=all&element=Task_A")
    expect(replace).toHaveBeenLastCalledWith(
      null,
      "",
      "/app/engines/prod-a/processes/invoice?scope=all&element=Task_A",
    )
    expect(router.state().shown.screen).toEqual(
      process({ filter: { scope: "all", elementId: "Task_A" } }),
    )
    expect(router.state().shown.generation).toBe(first.shown.generation)
    expect(router.state().moves).toBe(first.moves)
    // The older versions' notice: a new entry, the screen kept, the focus to its heading.
    router.navigate("/app/engines/prod-a/processes/invoice?version=1")
    expect(push).toHaveBeenLastCalledWith(
      null,
      "",
      "/app/engines/prod-a/processes/invoice?version=1",
    )
    expect(router.state().shown.screen).toEqual(process({ version: 1 }))
    expect(router.state().shown.generation).toBe(first.shown.generation)
    expect(router.state().moves).toBe(first.moves + 1)
    // A pick in the picker: a new entry, the screen and the focus where they are.
    router.refine("/app/engines/prod-a/processes/invoice?version=3", "push")
    expect(push).toHaveBeenLastCalledWith(
      null,
      "",
      "/app/engines/prod-a/processes/invoice?version=3",
    )
    expect(router.state().shown.screen).toEqual(process({ version: 3 }))
    expect(router.state().shown.generation).toBe(first.shown.generation)
    expect(router.state().moves).toBe(first.moves + 1)
    // The same address again names the entry the reader is on.
    router.refine("/app/engines/prod-a/processes/invoice?version=3", "push")
    expect(push).toHaveBeenCalledTimes(2)
    // Back to the latest version: the screen kept, with the filter its entry kept.
    back("/app/engines/prod-a/processes/invoice?scope=all&element=Task_A")
    expect(router.state().shown.screen).toEqual(
      process({ filter: { scope: "all", elementId: "Task_A" } }),
    )
    expect(router.state().shown.generation).toBe(first.shown.generation)
    expect(router.state().moves).toBe(first.moves + 2)
  })
})

describe("the page's search across engines", () => {
  it("shows it at its address and claims nothing of the cockpit's", () => {
    const { router } = routerAt("/app/search?q=ORD-1")
    const { route, shown } = router.state()
    expect(route.screen).toEqual({ kind: "search", text: "ORD-1" })
    expect(shown.screen).toEqual({ kind: "search", text: "ORD-1" })
    expect(shown.location.claims?.({ view: "search", q: "ORD-1" })).toBe(false)
  })

  it("starts another search anew in a new entry, the focus moving; the same one stays", () => {
    const { router, push, here } = routerAt("/app/search?q=ORD-1")
    const first = router.state()
    router.navigate("/app/search?q=ORD-1")
    expect(push).not.toHaveBeenCalled()
    expect(router.state().shown.generation).toBe(first.shown.generation)
    router.navigate("/app/search?q=ORD-2")
    expect(push).toHaveBeenCalledWith(null, "", "/app/search?q=ORD-2")
    expect(here()).toBe("/app/search?q=ORD-2")
    expect(router.state().shown.generation).toBe(first.shown.generation + 1)
    expect(router.state().moves).toBe(first.moves + 2)
  })

  it("gives the search's entry to the one instance found, so Back leads to where it started", () => {
    const { router, push, replace, here } = routerAt("/app/engines/prod-a")
    router.navigate("/app/search?q=ORD-1")
    router.navigate("/app/engines/prod-a/instances/pi-1", "replace")
    expect(push.mock.calls.map((call) => call[2])).toEqual(["/app/search?q=ORD-1"])
    expect(replace.mock.calls.map((call) => call[2])).toContain(
      "/app/engines/prod-a/instances/pi-1",
    )
    expect(here()).toBe("/app/engines/prod-a/instances/pi-1")
    expect(router.state().route.screen).toEqual({
      kind: "instance",
      engine: "prod-a",
      instance: "pi-1",
    })
  })

  it("marks the entry it is on seen, keeping its address and the state beside, and knows the mark on a return", () => {
    const { router, replace, here, back } = routerAt("/app/search?q=ORD-1")
    expect(router.seen()).toBe(false)

    router.markSeen()
    expect(router.seen()).toBe(true)
    expect(replace).toHaveBeenLastCalledWith({ "pulse:seen": true }, "", "/app/search?q=ORD-1")
    expect(here()).toBe("/app/search?q=ORD-1")

    router.navigate("/app/search?q=ORD-2")
    expect(router.seen()).toBe(false)
    back("/app/search?q=ORD-1", { memo: 1, "pulse:seen": true })
    expect(router.seen()).toBe(true)
    router.markSeen()
    expect(replace).toHaveBeenLastCalledWith(
      { memo: 1, "pulse:seen": true },
      "",
      "/app/search?q=ORD-1",
    )
    back("/app/search?q=ORD-3", { "pulse:seen": "no" })
    expect(router.seen()).toBe(false)
  })
})
