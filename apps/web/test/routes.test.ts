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
 * landing, the cross-engine overview, a board and every route of one engine (COCKPIT_ROUTES).
 */
const PLACES: readonly (readonly [Place, string])[] = [
  [{ view: "landing" }, "/app"],
  [{ view: "fleet" }, "/app/fleet"],
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
    // A canonical address is the one the page keeps: nothing replaces it.
    expect(route.url).toBe(url)
  })

  it.each(PLACES)("%o round-trips with ids no path takes as they are", (place) => {
    const encoded = withIds(place, (id) => `${id} a/ü?#%&=+.`)
    const url = urlOf(encoded)
    expect(viewAt(url).place).toEqual(encoded)
    expect(viewAt(url).url).toBe(url)
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
    expect([...views].sort()).toEqual([...(properties.view?.enum ?? []), "fleet"].sort())
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

  it("opens the landing on /app, the engines and the boards, titled Pulse", () => {
    expect(viewAt("/app")).toEqual({
      kind: "view",
      place: { view: "landing" },
      url: "/app",
      start: LANDING,
      title: { kind: "product" },
    })
  })

  it("starts the cross-engine overview and an engine's own address on the landing", () => {
    // No argument of the tool names the cross-engine overview; an engine's own address may name one
    // without sections, and the tool takes no `engine` on a server of Camunda 8 clusters alone.
    expect(viewAt("/app/fleet").start).toEqual({ ...LANDING, place: { view: "fleet" } })
    expect(viewAt("/app/engines/c8").start).toEqual({
      ...LANDING,
      place: { view: "overview", engine: "c8" },
    })
    expect(viewAt("/app/cockpit?engine=c8").start).toEqual({ ...LANDING, place: { engine: "c8" } })
  })

  it("starts every other place at its arguments, the tool's own", () => {
    for (const [place, url] of PLACES.slice(4)) {
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
    for (const [place, url] of PLACES.slice(3)) {
      const old = `/app/cockpit?${new URLSearchParams(
        Object.entries(place).map(([key, value]) => [key, String(value)]),
      ).toString()}`
      const route = viewAt(old)
      expect(route.place, old).toEqual(place)
      expect(route.url, old).toBe(url)
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
      expect(route.screen?.filter).toEqual(filter)
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
    expect(read("?scope=ended&q=%20%20").screen?.filter).toEqual({ scope: "all" })
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
