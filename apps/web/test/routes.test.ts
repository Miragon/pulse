import { describe, expect, it } from "vitest"
import { SIGNED_OUT_REASONS } from "@miragon/pulse-widget-shell/widgets"
import {
  COCKPIT_VIEW,
  placeKey,
  routeOf,
  screenOf,
  screenUrlOf,
  signInUrl,
  urlOf,
  viewRouteOf,
  type Place,
  type ViewRoute,
} from "../src/router/routes.js"
import { cockpitProperties } from "./cockpit-tool.js"
import { onEveryClock } from "./time-zones.test-support.js"

/**
 * The page's addresses (the plan's address scheme): every place of the cockpit has its canonical
 * address, which reads back to it, and the cockpit's query of every view before it, which the page
 * reads and replaces by the view's own address.
 */

const at = (url: string) => {
  const { pathname, search } = new URL(url, "http://localhost")
  return routeOf({ pathname, search })
}

/** The view route a URL opens (a test fails where it opens the signed-out page). */
function viewAt(url: string): ViewRoute {
  const route = at(url)
  if (route.kind !== "view") throw new Error(`${url} opens no view`)
  return route
}

const E = "prod-a"

/**
 * One place of each cockpit route, each id it needs and takes, with the address that names it: the
 * landing (the page's start page), a board and every route of one engine (COCKPIT_ROUTES). The
 * cross-engine overview has no address of its own: the start page replaced it.
 */
const PLACES: readonly (readonly [Place, string])[] = [
  [{ view: "landing" }, "/app"],
  [{ view: "board", board: "invoices" }, "/app/boards/invoices"],
  [{ view: "overview", engine: E }, "/app/engines/prod-a"],
  [{ view: "incidents", engine: E }, "/app/engines/prod-a/incidents"],
  [
    { view: "cluster-detail", engine: E, activityId: "chargeCard", incidentType: "failedJob" },
    "/app/engines/prod-a/incidents/cause?activity=chargeCard&type=failedJob",
  ],
  [
    {
      view: "cluster-detail",
      engine: E,
      activityId: "chargeCard",
      incidentType: "failedJob",
      messageSignature: "Card declined: <n>",
    },
    "/app/engines/prod-a/incidents/cause?activity=chargeCard&type=failedJob&signature=Card+declined%3A+%3Cn%3E",
  ],
  [
    { view: "process-detail", engine: E, processDefinitionKey: "invoice" },
    "/app/engines/prod-a/processes/invoice",
  ],
  [
    { view: "process-detail", engine: E, processDefinitionKey: "invoice", focus: "incidents" },
    "/app/engines/prod-a/processes/invoice?scope=incident",
  ],
  // A process in a tenant (F17b): the cockpit's drill names it, the address carries it.
  [
    { view: "process-detail", engine: E, processDefinitionKey: "invoice", tenantId: "north" },
    "/app/engines/prod-a/processes/invoice?tenant=north",
  ],
  [{ view: "process-instances", engine: E }, "/app/engines/prod-a/instances"],
  [
    { view: "process-instances", engine: E, processDefinitionKey: "invoice" },
    "/app/engines/prod-a/instances?process=invoice",
  ],
  [
    { view: "instance-detail", engine: E, processInstanceId: "pi-1" },
    "/app/engines/prod-a/instances/pi-1",
  ],
  [
    { view: "history", engine: E, processInstanceId: "pi-1" },
    "/app/engines/prod-a/instances/pi-1?tab=history",
  ],
  // The cockpit names an incident without its instance: the cockpit's query until the page finds it.
  [
    { view: "incident-detail", engine: E, incidentId: "inc-1" },
    "/app/cockpit?view=incident-detail&engine=prod-a&incidentId=inc-1",
  ],
  [{ view: "jobs", engine: E }, "/app/engines/prod-a/jobs"],
  [
    { view: "jobs", engine: E, processDefinitionKey: "invoice", failedOnly: true },
    "/app/engines/prod-a/jobs?process=invoice&failed=true",
  ],
]

/**
 * The address the page keeps for `place`, which `urlOf` names at `url`: its own, but for the list of
 * a process's instances, which the page shows as the process screen at the process's own address,
 * the old one replaced in its entry.
 */
function keptUrl(place: Place, url: string): string {
  const screen = screenOf(place)
  return place.view === "process-instances" && screen !== undefined ? screenUrlOf(screen) : url
}

/** The ids of a place, the texts an address must carry as they are. */
const IDS = new Set([
  "engine",
  "board",
  "processDefinitionKey",
  "processInstanceId",
  "incidentId",
  "activityId",
  "incidentType",
  "messageSignature",
])

/** `place` with each id replaced by what `idOf` makes of it. */
const withIds = (place: Place, idOf: (id: string) => string): Place =>
  Object.fromEntries(
    Object.entries(place).map(([key, value]) => [
      key,
      IDS.has(key) && typeof value === "string" ? idOf(value) : value,
    ]),
  )

describe("every place of the cockpit at its address and back", () => {
  it.each(PLACES)("%o is %s, which opens it again as it is", (place, url) => {
    expect(urlOf(place)).toBe(url)
    const route = viewAt(url)
    expect(route.place).toEqual(place)
    // A canonical address is the one the page keeps: nothing replaces it, but the process screen's.
    expect(route.url).toBe(keptUrl(place, url))
  })

  it.each(PLACES)("%o round-trips with ids no path takes as they are", (place) => {
    const encoded = withIds(place, (id) => `${id} a/ü?#%&=+.`)
    const url = urlOf(encoded)
    expect(viewAt(url).place).toEqual(encoded)
    expect(viewAt(url).url).toBe(keptUrl(encoded, url))
  })

  it.each(PLACES)("%o round-trips with ids of dots, which no path takes at all", (place) => {
    for (const dots of [".", ".."]) {
      const dotted = withIds(place, () => dots)
      expect(viewAt(urlOf(dotted)).place).toEqual(dotted)
    }
  })

  it("escapes an id in a segment of its own, and keeps one of dots in the cockpit's query", () => {
    expect(urlOf({ view: "jobs", engine: "a/b c" })).toBe("/app/engines/a%2Fb%20c/jobs")
    expect(urlOf({ view: "jobs", engine: "." })).toBe("/app/cockpit?view=jobs&engine=.")
    expect(urlOf({ view: "board", board: ".." })).toBe("/app/cockpit?view=board&board=..")
    expect(urlOf({ view: "instance-detail", engine: E, processInstanceId: "" })).toBe(
      "/app/cockpit?view=instance-detail&engine=prod-a&processInstanceId=",
    )
  })

  it("covers every view and every id of the cockpit tool, so a new route needs an address", () => {
    const properties = cockpitProperties()
    const views = new Set(PLACES.map(([place]) => place.view))
    expect([...views].sort()).toEqual([...(properties.view?.enum ?? [])].sort())
    const named = new Set(PLACES.flatMap(([place]) => Object.keys(place)))
    expect(Object.keys(properties).filter((key) => !named.has(key))).toEqual([])
  })

  it("names an engine without sections by the engine's own address, its overview", () => {
    // The place the cockpit writes for an engine it shows as its one state (Camunda 8 on boards
    // only, a refused profile): it opens that state from the engine's overview too.
    expect(urlOf({ engine: "c8" })).toBe("/app/engines/c8")
    expect(viewAt("/app/engines/c8").place).toEqual({ view: "overview", engine: "c8" })
    expect(placeKey({ engine: "c8" })).not.toBe(placeKey(viewAt("/app/engines/c8").place))
  })

  it("leaves what a place leaves unset out of its address, a default flag too", () => {
    expect(urlOf({})).toBe("/app")
    expect(urlOf({ view: "jobs", engine: E, failedOnly: false })).toBe("/app/engines/prod-a/jobs")
    expect(urlOf({ view: "jobs", engine: E, processDefinitionKey: undefined })).toBe(
      "/app/engines/prod-a/jobs",
    )
  })

  it("keeps a place no address names whole in the cockpit's query, for the tool to refuse", () => {
    expect(urlOf({ view: "jobs", engine: E, failedOnly: "yes" })).toBe(
      "/app/cockpit?view=jobs&engine=prod-a&failedOnly=yes",
    )
    expect(urlOf({ view: "jobs", engine: E, processDefinitionKey: 7 })).toBe(
      "/app/cockpit?view=jobs&engine=prod-a&processDefinitionKey=7",
    )
    expect(
      urlOf({ view: "process-detail", engine: E, processDefinitionKey: "a", focus: "jobs" }),
    ).toBe("/app/cockpit?view=process-detail&engine=prod-a&processDefinitionKey=a&focus=jobs")
    expect(urlOf({ view: "landing", engine: E })).toBe("/app/cockpit?view=landing&engine=prod-a")
    expect(urlOf({ view: "nowhere" })).toBe("/app/cockpit?view=nowhere")
    // A value no address carries is left out, never "[object Object]".
    expect(urlOf({ view: "jobs", engine: "prod", extra: { a: 1 } })).toBe(
      "/app/cockpit?view=jobs&engine=prod",
    )
    expect(urlOf({ extra: { a: 1 } })).toBe("/app/cockpit")
  })
})

describe("the start of each place", () => {
  const LANDING = { view: COCKPIT_VIEW, args: { view: "landing" } }

  it("opens the page's start page on /app, the cockpit's landing its start, titled Pulse", () => {
    expect(viewAt("/app")).toEqual({
      kind: "view",
      place: { view: "landing" },
      url: "/app",
      start: LANDING,
      screen: { kind: "start" },
      title: { kind: "product" },
    })
  })

  it("starts an engine's own address on the landing", () => {
    // An engine's own address may name one without sections, and the tool takes no `engine` on a
    // server of Camunda 8 clusters alone.
    expect(viewAt("/app/engines/c8").start).toEqual({
      ...LANDING,
      place: { view: "overview", engine: "c8" },
    })
    expect(viewAt("/app/cockpit?engine=c8").start).toEqual({ ...LANDING, place: { engine: "c8" } })
  })

  it("starts every other place at its arguments, the tool's own", () => {
    for (const [place, url] of PLACES.slice(3)) {
      expect(viewAt(url).start, url).toEqual({ view: COCKPIT_VIEW, args: place })
    }
  })

  it("titles a board's page by its id until the view titles it, any other page Pulse", () => {
    expect(viewAt("/app/boards/invoices").title).toEqual({ kind: "board", board: "invoices" })
    expect(viewAt("/app/cockpit?view=board&board=..").title).toEqual({
      kind: "board",
      board: "..",
    })
    expect(viewAt("/app/engines/prod-a/jobs").title).toEqual({ kind: "product" })
  })
})

describe("reading an address", () => {
  it("opens an incident under its instance by the incident's id, the address as it is", () => {
    const url = "/app/engines/prod-a/instances/pi%201/incidents/inc-1"
    const route = viewAt(url)
    expect(route.place).toEqual({ view: "incident-detail", engine: E, incidentId: "inc-1" })
    expect(route.url).toBe(url)
    expect(route.start).toEqual({ view: COCKPIT_VIEW, args: route.place })
    // An instance of dots is no segment (a browser resolves one before the page sees its path):
    // the incident keeps the cockpit's query.
    const pathname = "/app/engines/prod-a/instances/%2E/incidents/inc-1"
    expect(routeOf({ pathname, search: "" })).toMatchObject({
      url: "/app/cockpit?view=incident-detail&engine=prod-a&incidentId=inc-1",
    })
  })

  it("reads a parameter it knows and drops the rest from the address it keeps", () => {
    const route = viewAt("/app/engines/prod-a/jobs?failed=yes&utm_source=mail&process=invoice")
    expect(route.place).toEqual({ view: "jobs", engine: E, processDefinitionKey: "invoice" })
    expect(route.url).toBe("/app/engines/prod-a/jobs?process=invoice")
    expect(viewAt("/app/engines/prod-a/processes/a?scope=all").place).toEqual({
      view: "process-detail",
      engine: E,
      processDefinitionKey: "a",
    })
    expect(viewAt("/app/engines/prod-a/instances/pi-1?tab=variables").place).toEqual({
      view: "instance-detail",
      engine: E,
      processInstanceId: "pi-1",
    })
    expect(viewAt("/app?view=jobs").url).toBe("/app")
  })

  it("names the parameters in the address's own order", () => {
    expect(viewAt("/app/engines/prod-a/jobs?failed=true&process=a").url).toBe(
      "/app/engines/prod-a/jobs?process=a&failed=true",
    )
  })

  it("reads a segment as its text, a broken escape as sent, and writes it escaped", () => {
    expect(viewAt("/app/boards/a%20b").place).toEqual({ view: "board", board: "a b" })
    const broken = viewAt("/app/boards/%E0%A4%A")
    expect(broken.place).toEqual({ view: "board", board: "%E0%A4%A" })
    expect(broken.url).toBe("/app/boards/%25E0%25A4%25A")
    expect(routeOf({ pathname: "/app/engines/%2E/jobs", search: "" })).toMatchObject({
      url: "/app/cockpit?view=jobs&engine=.",
    })
  })

  it("opens the landing on a path the server serves no page at", () => {
    for (const path of ["/app/boards/", "/app/boards/a/b", "/app/engines//jobs", "/app/nothing"]) {
      const route = viewAt(path)
      expect(route.place, path).toEqual({ view: "landing" })
      expect(route.url, path).toBe("/app")
    }
  })

  it("shows the signed-out page with its reason, a sign-out's where it names none or another", () => {
    for (const reason of SIGNED_OUT_REASONS) {
      expect(at(`/app/signed-out?reason=${reason}`)).toEqual({ kind: "signed-out", reason })
    }
    expect(at("/app/signed-out")).toEqual({ kind: "signed-out", reason: "signed_out" })
    expect(at("/app/signed-out?reason=toString")).toEqual({
      kind: "signed-out",
      reason: "signed_out",
    })
  })
})

describe("the cockpit's query, the address before the page's own", () => {
  it("reads every place the old page named and replaces it by its canonical address", () => {
    for (const [place, url] of PLACES.slice(2)) {
      const old = `/app/cockpit?${new URLSearchParams(
        Object.entries(place).map(([key, value]) => [key, String(value)]),
      ).toString()}`
      const route = viewAt(old)
      expect(route.place, old).toEqual(place)
      expect(route.url, old).toBe(keptUrl(place, url))
    }
  })

  it("names an engine named alone by the engine's address, and starts it on the landing", () => {
    const route = viewAt("/app/cockpit?engine=orders-c8")
    expect(route.place).toEqual({ engine: "orders-c8" })
    expect(route.url).toBe("/app/engines/orders-c8")
  })

  it("opens the landing for a query that names nothing", () => {
    expect(viewAt("/app/cockpit")).toMatchObject({
      place: {},
      url: "/app",
      start: { view: COCKPIT_VIEW, args: { view: "landing" } },
    })
  })

  it("passes a parameter the cockpit does not take on, for the tool to refuse it", () => {
    const route = viewAt("/app/cockpit?engine=prod&utm_source=mail")
    expect(route.url).toBe("/app/cockpit?engine=prod&utm_source=mail")
    expect(route.start).toEqual({
      view: COCKPIT_VIEW,
      args: { engine: "prod", utm_source: "mail" },
    })
  })

  it("reads the cockpit's flag as true or false, and any other value as the text it is", () => {
    const place = (query: string) => viewAt(`/app/cockpit?${query}`).place
    expect(place("view=jobs&failedOnly=true")).toEqual({ view: "jobs", failedOnly: true })
    expect(place("view=jobs&failedOnly=false")).toEqual({ view: "jobs", failedOnly: false })
    expect(place("view=jobs&failedOnly=yes")).toEqual({ view: "jobs", failedOnly: "yes" })
    expect(place("view=jobs&engine=true")).toEqual({ view: "jobs", engine: "true" })
  })

  it("keeps a parameter named like an object's own key as a plain argument", () => {
    const route = viewAt("/app/cockpit?__proto__=x&constructor=y")
    expect(Object.getPrototypeOf(route.place)).toBe(Object.prototype)
    expect(Object.entries(route.place)).toEqual([
      ["__proto__", "x"],
      ["constructor", "y"],
    ])
  })
})

describe("placeKey", () => {
  it("is one text per place, whatever the order of its arguments and whether they are typed", () => {
    expect(placeKey({ view: "jobs", engine: E, failedOnly: true })).toBe(
      placeKey({ failedOnly: "true", engine: E, view: "jobs" }),
    )
    expect(placeKey({ view: "jobs", engine: E })).not.toBe(placeKey({ view: "jobs", engine: "b" }))
  })
})

describe("signInUrl", () => {
  it("starts a sign-in that comes back to /app without a page to return to", () => {
    expect(signInUrl()).toBe("/app/auth/login")
    expect(signInUrl("/app")).toBe("/app/auth/login")
  })

  it("names the page and its query to come back to", () => {
    expect(signInUrl("/app/engines/prod/jobs?failed=true")).toBe(
      "/app/auth/login?return=%2Fapp%2Fengines%2Fprod%2Fjobs%3Ffailed%3Dtrue",
    )
  })
})

describe("the start page, which replaced the cross-engine overview", () => {
  const START = {
    kind: "view",
    place: { view: "landing" },
    url: "/app",
    start: { view: COCKPIT_VIEW, args: { view: "landing" } },
    screen: { kind: "start" },
    title: { kind: "product" },
  }

  it("is the page's screen at the landing and at the cross-engine overview, its address /app", () => {
    expect(screenOf({ view: "landing" })).toEqual({ kind: "start" })
    expect(screenOf({ view: "fleet" })).toEqual({ kind: "start" })
    expect(screenUrlOf({ kind: "start" })).toBe("/app")
    expect(urlOf({ view: "fleet" })).toBe("/app")
  })

  it("reads the cross-engine overview's old address as its own, and gives way to /app", () => {
    expect(viewAt("/app/fleet")).toEqual(START)
    expect(viewAt("/app/fleet?x=1")).toEqual(START)
    expect(viewAt("/app/cockpit?view=fleet")).toEqual(START)
    expect(viewAt("/app/cockpit")).toMatchObject({ url: "/app", screen: { kind: "start" } })
  })

  it("is none where the landing or the overview carries more arguments", () => {
    expect(screenOf({ view: "landing", engine: E })).toBeUndefined()
    expect(screenOf({ view: "fleet", engine: E })).toBeUndefined()
    expect(viewAt("/app/cockpit?view=fleet&engine=prod-a")).not.toHaveProperty("screen")
  })
})

describe("the page's own screen at a place", () => {
  /** The engine screen of `engine`, its list unfiltered. */
  const unfiltered = (engine: string) => ({ kind: "engine", engine, filter: { scope: "all" } })

  it("is the engine screen at an engine's overview, its own address or the old query", () => {
    expect(screenOf({ view: "overview", engine: "prod-a" })).toEqual(unfiltered("prod-a"))
    expect(viewRouteOf({ pathname: "/app/engines/prod-a", search: "" }).screen).toEqual(
      unfiltered("prod-a"),
    )
    expect(
      viewRouteOf({ pathname: "/app/cockpit", search: "?view=overview&engine=prod-a" }).screen,
    ).toEqual(unfiltered("prod-a"))
    // The old query that names an engine alone leads to its address, so to its screen too.
    expect(viewRouteOf({ pathname: "/app/cockpit", search: "?engine=prod-a" }).screen).toEqual(
      unfiltered("prod-a"),
    )
  })

  it("carries the screen's filter in its address's query, the defaults left out, both ways", () => {
    const cases: Array<[string, unknown]> = [
      ["/app/engines/prod-a", { scope: "all" }],
      ["/app/engines/prod-a?scope=incident", { scope: "withIncident" }],
      ["/app/engines/prod-a?q=order", { scope: "all", search: "order" }],
      [
        "/app/engines/prod%20a?scope=incident&q=order+fulfillment+%26+co",
        { scope: "withIncident", search: "order fulfillment & co" },
      ],
    ]
    for (const [url, filter] of cases) {
      const { pathname, search } = new URL(url, "http://localhost")
      const route = viewRouteOf({ pathname, search })
      expect(route.screen).toMatchObject({ kind: "engine", filter })
      expect(route.url).toBe(url)
      expect(route.place).toEqual({
        view: "overview",
        engine: decodeURIComponent(pathname.split("/")[3]),
      })
      expect(screenUrlOf(route.screen!)).toBe(url)
    }
  })

  it("leaves out a scope it does not know, an empty search and spaces around one", () => {
    const read = (search: string) => viewRouteOf({ pathname: "/app/engines/prod-a", search })
    expect(read("?scope=all&q=").url).toBe("/app/engines/prod-a")
    expect(read("?scope=ended&q=%20%20").screen).toMatchObject({ filter: { scope: "all" } })
    expect(read("?q=%20label%20").url).toBe("/app/engines/prod-a?q=label")
    expect(
      screenUrlOf({ kind: "engine", engine: "prod-a", filter: { scope: "all", search: " " } }),
    ).toBe("/app/engines/prod-a")
  })

  it("is none for an engine named alone, another view, more arguments or an id of dots", () => {
    expect(screenOf({ engine: "orders-c8" })).toBeUndefined()
    expect(screenOf({ view: "incidents", engine: "prod-a" })).toBeUndefined()
    expect(screenOf({ view: "overview", engine: "prod-a", focus: "incidents" })).toBeUndefined()
    expect(screenOf({ view: "overview", engine: ".." })).toBeUndefined()
    expect(screenOf({ view: "overview" })).toBeUndefined()
    expect(viewRouteOf({ pathname: "/app/engines/prod-a/jobs", search: "" })).not.toHaveProperty(
      "screen",
    )
  })
})

describe("the page's instance screen at a place", () => {
  const route = (url: string) => {
    const { pathname, search } = new URL(url, "http://localhost")
    return viewRouteOf({ pathname, search })
  }

  it("is the instance screen at an instance's view and at its history, which is its tab", () => {
    expect(screenOf({ view: "instance-detail", engine: E, processInstanceId: "pi-1" })).toEqual({
      kind: "instance",
      engine: E,
      instance: "pi-1",
    })
    expect(screenOf({ view: "history", engine: E, processInstanceId: "pi-1" })).toEqual({
      kind: "instance",
      engine: E,
      instance: "pi-1",
      tab: "history",
    })
    expect(screenOf({ view: "incident-detail", engine: E, incidentId: "inc-1" })).toEqual({
      kind: "incident",
      engine: E,
      incident: "inc-1",
    })
    expect(screenOf({ view: "instance-detail", engine: E, processInstanceId: "." })).toBeUndefined()
    expect(screenOf({ view: "incident-detail", engine: E, incidentId: "" })).toBeUndefined()
    expect(
      screenOf({ view: "instance-detail", engine: E, processInstanceId: "pi-1", more: 1 }),
    ).toBeUndefined()
    expect(screenOf({ view: "jobs", engine: E, processInstanceId: "pi-1" })).toBeUndefined()
    expect(screenOf({ view: "jobs", engine: E, incidentId: "inc-1" })).toBeUndefined()
  })

  it("carries the tab in the address's query, a tab it does not know left out, both ways", () => {
    for (const tab of ["history", "incidents", "waiting", "variables"] as const) {
      const url = `/app/engines/prod-a/instances/pi%201?tab=${tab}`
      expect(route(url).screen).toEqual({ kind: "instance", engine: E, instance: "pi 1", tab })
      expect(route(url).url).toBe(url)
      expect(screenUrlOf({ kind: "instance", engine: E, instance: "pi 1", tab })).toBe(url)
    }
    expect(route("/app/engines/prod-a/instances/pi-1?tab=jobs").url).toBe(
      "/app/engines/prod-a/instances/pi-1",
    )
  })

  it("puts an incident in focus at its address under its instance, its tab beside it", () => {
    const url = "/app/engines/prod-a/instances/pi-1/incidents/inc%201?tab=history"
    expect(route(url).screen).toEqual({
      kind: "instance",
      engine: E,
      instance: "pi-1",
      incident: "inc 1",
      tab: "history",
    })
    expect(route(url).url).toBe(url)
    expect(screenUrlOf({ kind: "instance", engine: E, instance: "pi-1", incident: "inc 1" })).toBe(
      "/app/engines/prod-a/instances/pi-1/incidents/inc%201",
    )
    // An incident whose id can be no segment leaves the instance's own address.
    expect(screenUrlOf({ kind: "instance", engine: E, instance: "pi-1", incident: ".." })).toBe(
      "/app/engines/prod-a/instances/pi-1",
    )
  })

  it("keeps an incident the page knows by its id alone in the cockpit's query, to find its instance", () => {
    const url = "/app/cockpit?view=incident-detail&engine=prod-a&incidentId=inc-1"
    expect(route(url).screen).toEqual({ kind: "incident", engine: E, incident: "inc-1" })
    expect(route(url).url).toBe(url)
    expect(screenUrlOf({ kind: "incident", engine: E, incident: "inc-1" })).toBe(url)
  })
})

describe("the page's process screen at a place", () => {
  const route = (url: string) => {
    const { pathname, search } = new URL(url, "http://localhost")
    return viewRouteOf({ pathname, search })
  }
  const RUNNING = { scope: "running" } as const
  const carriedBothWays = (url: string, state: Record<string, unknown>) => {
    const shown = route(url)
    expect(shown.screen, url).toEqual({ kind: "process", engine: E, process: "invoice", ...state })
    expect(shown.url, url).toBe(url)
    expect(shown.place).toMatchObject({ view: "process-detail", processDefinitionKey: "invoice" })
    expect(screenUrlOf(shown.screen!)).toBe(url)
  }

  it("is the process screen at a process's view, with its incidents in focus, and at its instances", () => {
    expect(
      screenOf({ view: "process-detail", engine: E, processDefinitionKey: "invoice" }),
    ).toEqual({ kind: "process", engine: E, process: "invoice", filter: RUNNING })
    expect(
      screenOf({
        view: "process-detail",
        engine: E,
        processDefinitionKey: "invoice",
        focus: "incidents",
      }),
    ).toEqual({ kind: "process", engine: E, process: "invoice", filter: { scope: "withIncident" } })
    expect(
      screenOf({ view: "process-instances", engine: E, processDefinitionKey: "invoice" }),
    ).toEqual({ kind: "process", engine: E, process: "invoice", filter: RUNNING })
    // The engine's instances without a process stay the cockpit's, as an id of dots does.
    expect(screenOf({ view: "process-instances", engine: E })).toBeUndefined()
    expect(
      screenOf({ view: "process-detail", engine: E, processDefinitionKey: ".." }),
    ).toBeUndefined()
    expect(
      screenOf({ view: "jobs", engine: E, processDefinitionKey: "invoice", focus: "incidents" }),
    ).toBeUndefined()
    expect(
      screenOf({ view: "process-detail", engine: E, processDefinitionKey: "a", focus: "jobs" }),
    ).toBeUndefined()
    expect(screenOf({ view: "jobs", engine: E, processDefinitionKey: "invoice" })).toBeUndefined()
  })

  it("carries the version and the list's filter in the address's query, the defaults left out, both ways", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["/app/engines/prod-a/processes/invoice", { filter: RUNNING }],
      ["/app/engines/prod-a/processes/invoice?version=7", { version: 7, filter: RUNNING }],
      [
        "/app/engines/prod-a/processes/invoice?scope=incident",
        { filter: { scope: "withIncident" } },
      ],
      ["/app/engines/prod-a/processes/invoice?scope=ended", { filter: { scope: "ended" } }],
      ["/app/engines/prod-a/processes/invoice?scope=all", { filter: { scope: "all" } }],
      [
        "/app/engines/prod-a/processes/invoice?version=2&scope=all&element=Task_Review&key=ORD+1%2F2",
        {
          version: 2,
          filter: { scope: "all", elementId: "Task_Review", businessKey: "ORD 1/2" },
        },
      ],
    ]
    for (const [url, state] of cases) carriedBothWays(url, state)
  })

  onEveryClock(() => {
    it("carries variable conditions, a date among them as the instant it names here, both ways", () => {
      carriedBothWays(
        `/app/engines/prod-a/processes/invoice?var=amount%7EgreaterThan%7E100&var=dueAt%7ElessThan.date%7E${encodeURIComponent(new Date("2026-03-15T10:00").toISOString())}&var=a%257Eb%7Eequals%7Ex%7Ey`,
        {
          filter: {
            scope: "running",
            variables: [
              { name: "amount", operator: "greaterThan", value: "100" },
              { name: "dueAt", operator: "lessThan", value: "2026-03-15T10:00", as: "date" },
              { name: "a~b", operator: "equals", value: "x~y" },
            ],
          },
        },
      )
    })

    it("carries a date as the instant it names here and reads it on this browser's clock, an old wall clock replaced", () => {
      const path = "/app/engines/prod-a/processes/invoice"
      const due = (value: string) =>
        `${path}?${new URLSearchParams([["var", `due~lessThan.date~${value}`]]).toString()}`
      const dueOf = (url: string) => {
        const shown = route(url).screen
        return shown?.kind === "process" ? shown.filter.variables?.[0]?.value : undefined
      }
      const instant = new Date("2026-03-15T10:00:30").toISOString()

      // An old address's wall clock: read as it is, its entry named by the instant.
      expect(dueOf(due("2026-03-15T10:00:30"))).toBe("2026-03-15T10:00:30")
      expect(route(due("2026-03-15T10:00:30")).url).toBe(due(instant))
      // An instant with its offset: on this browser's clock, its seconds where it has some.
      expect(dueOf(due(instant))).toBe("2026-03-15T10:00:30")
      expect(dueOf(due(new Date("2026-03-15T10:00").toISOString()))).toBe("2026-03-15T10:00")
      expect(new Date(dueOf(due("2026-03-15T09:00:00+00:00")) ?? "").toISOString()).toBe(
        "2026-03-15T09:00:00.000Z",
      )
      // What names no time it can read stays as it is, for the server to refuse.
      expect(dueOf(due("2026-13-45T10:00"))).toBe("2026-13-45T10:00")
      expect(dueOf(due("2026-13-45T10:00Z"))).toBe("2026-13-45T10:00Z")
      expect(dueOf(due("soon"))).toBe("soon")
      // Another type keeps its value.
      const other = `${path}?${new URLSearchParams([["var", "at~equals~2026-03-15T10:00"]]).toString()}`
      expect(route(other).url).toBe(other)
    })
  })

  it("leaves out what it does not read: a version that is no number, a scope, an empty key, a broken condition", () => {
    const read = (search: string) => route(`/app/engines/prod-a/processes/invoice${search}`)
    expect(read("?version=0&scope=running&key=%20%20&element=").url).toBe(
      "/app/engines/prod-a/processes/invoice",
    )
    expect(read("?version=v7&scope=waiting").screen).toEqual({
      kind: "process",
      engine: E,
      process: "invoice",
      filter: RUNNING,
    })
    expect(read("?key=%20ORD-1%20").url).toBe("/app/engines/prod-a/processes/invoice?key=ORD-1")
    const conditions = [
      "amount", // no operator
      "amount~greaterThan", // no value
      "~equals~1", // no name
      "%E0%A4%A~equals~1", // a broken escape
      "amount~between~1", // an operator no list takes
      "amount~equals.money~1", // a type no condition compares as
      "amount~equals.text.more~1", // more than a type
    ]
    const search = conditions.map((text) => `var=${encodeURIComponent(text)}`).join("&")
    expect(read(`?${search}`).url).toBe("/app/engines/prod-a/processes/invoice")
  })

  it("takes at most five variable conditions, as a list does", () => {
    const search = Array.from({ length: 7 }, (_, n) => `var=v${String(n)}%7Eequals%7E1`).join("&")
    const shown = route(`/app/engines/prod-a/processes/invoice?${search}`).screen
    if (shown?.kind !== "process") throw new Error("no process screen")
    expect(shown.filter.variables).toHaveLength(5)
  })

  it("replaces the address of a process's instances, and the old one of its view, by its own", () => {
    expect(route("/app/engines/prod-a/instances?process=invoice").url).toBe(
      "/app/engines/prod-a/processes/invoice",
    )
    expect(
      route(
        "/app/cockpit?view=process-detail&engine=prod-a&processDefinitionKey=invoice&focus=incidents",
      ).url,
    ).toBe("/app/engines/prod-a/processes/invoice?scope=incident")
    // The list of a process's instances takes no screen state from its own query.
    expect(route("/app/engines/prod-a/instances?process=invoice&version=7").screen).toEqual({
      kind: "process",
      engine: E,
      process: "invoice",
      filter: RUNNING,
    })
  })

  it("keeps the cockpit's process view for an engine no segment takes, without the screen's state", () => {
    expect(
      screenUrlOf({
        kind: "process",
        engine: ".",
        process: "invoice",
        version: 7,
        filter: RUNNING,
      }),
    ).toBe("/app/cockpit?view=process-detail&engine=.&processDefinitionKey=invoice")
  })
})

describe("the page's search across engines", () => {
  it("is the search at its own address, what it searches trimmed in its query, the landing its start", () => {
    const route = viewAt("/app/search?q=%20ORD-10442%20&engine=prod-a")
    expect(route.screen).toEqual({ kind: "search", text: "ORD-10442" })
    expect(route.place).toEqual({ view: "search", q: "ORD-10442" })
    expect(route.url).toBe("/app/search?q=ORD-10442")
    expect(route.start).toEqual({ view: COCKPIT_VIEW, args: { view: "landing" } })
    expect(route.title).toEqual({ kind: "product" })
  })

  it("is the search without a text at its address without a query, and escapes what it searches", () => {
    expect(viewAt("/app/search").screen).toEqual({ kind: "search", text: "" })
    expect(viewAt("/app/search?q=%20%20").url).toBe("/app/search")
    expect(screenUrlOf({ kind: "search", text: "ORD 1&2/3" })).toBe("/app/search?q=ORD+1%262%2F3")
    expect(viewAt(screenUrlOf({ kind: "search", text: "ORD 1&2/3" })).screen).toEqual({
      kind: "search",
      text: "ORD 1&2/3",
    })
    expect(screenUrlOf({ kind: "search", text: "" })).toBe("/app/search")
  })

  it("is no place of the cockpit's, which never names or claims it", () => {
    expect(screenOf({ view: "search", q: "ORD-1" })).toBeUndefined()
  })
})
