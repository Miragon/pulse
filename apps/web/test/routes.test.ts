import { describe, expect, it } from "vitest"
import { SIGNED_OUT_REASONS } from "@miragon/pulse-widget-shell/widgets"
import { COCKPIT_VIEW, routeOf, signInUrl, urlOf } from "../src/routes.js"

const at = (url: string) => {
  const { pathname, search } = new URL(url, "http://localhost")
  return routeOf({ pathname, search })
}

const PRODUCT = { kind: "product" } as const

describe("routeOf", () => {
  it("opens the cockpit's landing on /app, the engines and the boards, titled Pulse", () => {
    const landing = { kind: "view", view: COCKPIT_VIEW, args: { view: "landing" }, title: PRODUCT }
    expect(at("/app")).toEqual(landing)
    expect(at("/app?view=jobs")).toEqual(landing)
  })

  it("opens the cockpit at the start the query of /app/cockpit names, one argument per parameter", () => {
    expect(at("/app/cockpit?view=process-detail&engine=prod&processDefinitionKey=invoice")).toEqual(
      {
        kind: "view",
        view: COCKPIT_VIEW,
        args: { view: "process-detail", engine: "prod", processDefinitionKey: "invoice" },
        title: PRODUCT,
      },
    )
    expect(at("/app/cockpit")).toEqual({
      kind: "view",
      view: COCKPIT_VIEW,
      args: {},
      title: PRODUCT,
    })
  })

  it("starts an engine the query names alone on the landing, the engine the cockpit's place", () => {
    // The place the cockpit writes for an engine without sections (Camunda 8 on boards only, a
    // refused profile). The tool takes no `engine` on a server of Camunda 8 clusters alone, so the
    // page calls it with the landing's arguments, which every server takes, as /app/fleet does.
    expect(at("/app/cockpit?engine=orders-c8")).toEqual({
      kind: "view",
      view: COCKPIT_VIEW,
      args: { view: "landing" },
      title: PRODUCT,
      place: { engine: "orders-c8" },
    })
    expect(at("/app/cockpit?engine=prod")).toMatchObject({
      args: { view: "landing" },
      place: { engine: "prod" },
    })
  })

  it("leaves every other query of the cockpit to the tool, an engine beside more included", () => {
    expect(at("/app/cockpit?view=overview&engine=prod")).not.toHaveProperty("place")
    expect(at("/app/cockpit")).not.toHaveProperty("place")
    // A parameter beside the engine reaches the tool, which refuses one it does not take.
    expect(at("/app/cockpit?engine=prod&utm_source=mail")).toEqual({
      kind: "view",
      view: COCKPIT_VIEW,
      args: { engine: "prod", utm_source: "mail" },
      title: PRODUCT,
    })
  })

  it("opens the cross-engine overview's page on the landing's start, its place the overview", () => {
    expect(at("/app/fleet?view=jobs")).toEqual({
      kind: "view",
      view: COCKPIT_VIEW,
      args: { view: "landing" },
      title: PRODUCT,
      place: { view: "fleet" },
    })
    expect(at("/app/fleet/x")).not.toHaveProperty("place")
  })

  it("opens a board's page on the cockpit's board view by its id, titled by it, the query unread", () => {
    expect(at("/app/boards/invoices?view=jobs")).toEqual({
      kind: "view",
      view: COCKPIT_VIEW,
      args: { view: "board", board: "invoices" },
      title: { kind: "board", board: "invoices" },
    })
    expect(at("/app/boards/Orders.v2")).toMatchObject({ args: { board: "Orders.v2" } })
  })

  it("reads a board's id as its text, a broken escape as sent, for the tool to refuse it", () => {
    expect(at("/app/boards/a%20b")).toMatchObject({ args: { view: "board", board: "a b" } })
    const broken = { pathname: "/app/boards/%E0%A4%A", search: "" }
    expect(routeOf(broken)).toMatchObject({ args: { view: "board", board: "%E0%A4%A" } })
  })

  it("opens the landing on a path below /app/boards that names no one board", () => {
    for (const pathname of ["/app/boards/", "/app/boards/a/b", "/app/boards"]) {
      expect(routeOf({ pathname, search: "" }), pathname).toMatchObject({
        args: { view: "landing" },
      })
    }
  })

  it("passes a parameter the cockpit does not take on, for the tool to refuse it", () => {
    expect(at("/app/cockpit?utm_source=mail")).toMatchObject({ args: { utm_source: "mail" } })
  })

  it("reads the cockpit's flag as true or false, and any other value as the text it is", () => {
    const args = (query: string) => {
      const route = at(`/app/cockpit?${query}`)
      return route.kind === "view" ? route.args : undefined
    }
    expect(args("view=jobs&failedOnly=true")).toEqual({ view: "jobs", failedOnly: true })
    expect(args("view=jobs&failedOnly=false")).toEqual({ view: "jobs", failedOnly: false })
    expect(args("view=jobs&failedOnly=yes")).toEqual({ view: "jobs", failedOnly: "yes" })
    expect(args("view=jobs&engine=true")).toEqual({ view: "jobs", engine: "true" })
  })

  it("keeps a parameter named like an object's own key as a plain argument", () => {
    const route = at("/app/cockpit?__proto__=x&constructor=y")
    expect(route.kind === "view" && Object.getPrototypeOf(route.args)).toBe(Object.prototype)
    expect(route.kind === "view" && Object.entries(route.args)).toEqual([
      ["__proto__", "x"],
      ["constructor", "y"],
    ])
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

describe("urlOf", () => {
  /** The place a route opens: where the address puts the view, its arguments else. */
  const placeAt = (url: string) => {
    const route = at(url)
    return route.kind === "view" ? (route.place ?? route.args) : undefined
  }

  it.each<Record<string, unknown>>([
    { view: "landing" },
    { view: "fleet" },
    { view: "board", board: "invoices" },
    { view: "board", board: "a b/ü" },
    { view: "overview", engine: "prod-a" },
    { engine: "c8" },
    { view: "jobs", engine: "prod a", processDefinitionKey: "invoice", failedOnly: true },
    { view: "jobs", engine: "prod", failedOnly: false },
    { view: "process-detail", engine: "prod", processDefinitionKey: "invoice", focus: "incidents" },
    { view: "cluster-detail", engine: "prod", activityId: "A&B", incidentType: "failedJob" },
  ])("%o opens where it names", (place) => {
    expect(placeAt(urlOf(place))).toEqual(place)
  })

  it("names the pages by their paths, any other place by the cockpit's query", () => {
    expect(urlOf({ view: "landing" })).toBe("/app")
    expect(urlOf({ view: "fleet" })).toBe("/app/fleet")
    expect(urlOf({ view: "board", board: "ops" })).toBe("/app/boards/ops")
    expect(urlOf({ view: "overview", engine: "prod" })).toBe(
      "/app/cockpit?view=overview&engine=prod",
    )
    expect(urlOf({})).toBe("/app/cockpit")
    // A value no address carries is left out, never "[object Object]".
    expect(urlOf({ view: "jobs", engine: "prod", extra: { a: 1 }, gone: undefined })).toBe(
      "/app/cockpit?view=jobs&engine=prod",
    )
  })
})

describe("signInUrl", () => {
  it("starts a sign-in that comes back to /app without a page to return to", () => {
    expect(signInUrl()).toBe("/app/auth/login")
    expect(signInUrl("/app")).toBe("/app/auth/login")
  })

  it("names the page and its query to come back to", () => {
    expect(signInUrl("/app/cockpit?view=jobs&engine=prod")).toBe(
      "/app/auth/login?return=%2Fapp%2Fcockpit%3Fview%3Djobs%26engine%3Dprod",
    )
  })
})
