import { describe, expect, it } from "vitest"
import { type Effect, intentOf, isPlaceholder, type Route, type Routes, routeOf } from "./route.js"
import { ROUTES } from "./routes.js"

/** A route of a test table: a read of a named engine unless the fields say otherwise. */
function route(
  operationId: string,
  method: Route["method"],
  path: string,
  extra?: Partial<Route>,
): Route {
  return { operationId, method, path, effect: "read", engineScoped: true, accepts: [], ...extra }
}

/** A table of `routes`, keyed by their operation ids. */
function table(...routes: readonly Route[]): Routes {
  return Object.fromEntries(routes.map((one) => [one.operationId, one]))
}

/** The operation id `routeOf` finds in `routes`; undefined for none. */
function idOf(routes: Routes, method: string, path: string): string | undefined {
  return routeOf(routes, method, path)?.operationId
}

describe("routeOf on the route table", () => {
  it("takes a literal segment over a placeholder: /process-instance/count is no instance id", () => {
    expect(idOf(ROUTES, "GET", "/process-instance/count")).toBe("getProcessInstancesCount")
    expect(idOf(ROUTES, "GET", "/process-instance/p1")).toBe("getProcessInstance")
    expect(idOf(ROUTES, "POST", "/process-instance/count")).toBe("queryProcessInstancesCount")
  })

  it("tells a start, which writes, from an evaluation, which reads", () => {
    const start = routeOf(ROUTES, "POST", "/process-definition/key/order/start")
    expect(start?.operationId).toBe("startProcessInstanceByKey")
    expect(intentOf(start, "POST")).toBe("write")
    const evaluate = routeOf(ROUTES, "POST", "/decision-definition/key/d1/evaluate")
    expect(evaluate?.operationId).toBe("evaluateDecisionByKey")
    expect(intentOf(evaluate, "POST")).toBe("read")
  })

  it.each([
    ["queryJobs", "/job"],
    ["queryProcessInstances", "/process-instance"],
    ["queryProcessInstancesCount", "/process-instance/count"],
    ["generateMigrationPlan", "/migration/generate"],
  ])("reads the reading POST %s (%s)", (operationId, path) => {
    const found = routeOf(ROUTES, "POST", path)
    expect(found?.operationId).toBe(operationId)
    expect(intentOf(found, "POST")).toBe("read")
  })

  it("finds a route below a named engine, only where the engine serves it", () => {
    expect(idOf(ROUTES, "GET", "/engine/default/process-instance/count")).toBe(
      "getProcessInstancesCount",
    )
    expect(idOf(ROUTES, "GET", "/engine")).toBe("getProcessEngineNames")
    expect(idOf(ROUTES, "GET", "/engine/default/version")).toBeUndefined()
    expect(idOf(ROUTES, "GET", "/engine//process-instance")).toBeUndefined()
  })

  it("knows no request outside the table", () => {
    expect(routeOf(ROUTES, "POST", "/nope")).toBeUndefined()
    expect(routeOf(ROUTES, "PATCH", "/process-instance")).toBeUndefined()
    expect(routeOf(ROUTES, "GET", "/process-instance//activity-instances")).toBeUndefined()
  })
})

describe("routeOf", () => {
  const byId = route("byId", "GET", "/thing/{id}")
  const count = route("count", "GET", "/thing/count")
  const nested = route("nested", "GET", "/thing/{id}/part/{part}")
  const deepLiteral = route("deepLiteral", "GET", "/thing/{id}/part/all")

  it("takes the literal whatever the order of the table", () => {
    expect(idOf(table(byId, count), "GET", "/thing/count")).toBe("count")
    expect(idOf(table(count, byId), "GET", "/thing/count")).toBe("count")
    expect(idOf(table(nested, deepLiteral), "GET", "/thing/t1/part/all")).toBe("deepLiteral")
    expect(idOf(table(deepLiteral, nested), "GET", "/thing/t1/part/all")).toBe("deepLiteral")
    expect(idOf(table(deepLiteral, nested), "GET", "/thing/t1/part/p1")).toBe("nested")
  })

  it("decides by the leftmost segment where two templates differ", () => {
    const left = route("left", "GET", "/a/{x}/c")
    const right = route("right", "GET", "/a/b/{y}")
    expect(idOf(table(left, right), "GET", "/a/b/c")).toBe("right")
    expect(idOf(table(right, left), "GET", "/a/b/c")).toBe("right")
  })

  it("keeps the first of two templates that tie", () => {
    const first = route("first", "GET", "/a/{x}")
    const second = route("second", "GET", "/a/{y}")
    expect(idOf(table(first, second), "GET", "/a/1")).toBe("first")
  })

  it("matches every segment and no more: a placeholder takes no empty value", () => {
    expect(idOf(table(byId), "GET", "/thing")).toBeUndefined()
    expect(idOf(table(byId), "GET", "/thing/")).toBeUndefined()
    expect(idOf(table(byId), "GET", "/thing/t1/more")).toBeUndefined()
    expect(idOf(table(route("short", "GET", "/thing")), "GET", "/thing/t1")).toBeUndefined()
    expect(idOf(table(byId), "GET", "/other/t1")).toBeUndefined()
  })

  it("reads a placeholder as a name in braces and nothing else", () => {
    const open = route("open", "GET", "/{open")
    const close = route("close", "GET", "/close}")
    expect(idOf(table(open, close), "GET", "/x")).toBeUndefined()
    expect(idOf(table(open), "GET", "/{open")).toBe("open")
    expect(idOf(table(close), "GET", "/close}")).toBe("close")
    expect(isPlaceholder("{id}")).toBe(true)
    expect([isPlaceholder("{id"), isPlaceholder("id}"), isPlaceholder("id")]).toEqual([
      false,
      false,
      false,
    ])
  })

  it("matches the method in any case, and only the method", () => {
    const post = route("post", "POST", "/thing/{id}")
    expect(idOf(table(byId, post), "get", "/thing/t1")).toBe("byId")
    expect(idOf(table(byId, post), "Post", "/thing/t1")).toBe("post")
    expect(idOf(table(byId), "DELETE", "/thing/t1")).toBeUndefined()
  })

  it("knows a path only from the root", () => {
    expect(idOf(table(byId), "GET", "thing/t1")).toBeUndefined()
    expect(idOf(table(route("y", "GET", "/y")), "GET", "x/y")).toBeUndefined()
    expect(idOf(table(byId), "GET", "")).toBeUndefined()
  })

  it("strips a named engine only for an engine-scoped route", () => {
    const scoped = route("scoped", "GET", "/thing/{id}")
    const unscoped = route("unscoped", "GET", "/version", { engineScoped: false })
    const engines = route("engines", "GET", "/engine", { engineScoped: false })
    const routes = table(scoped, unscoped, engines)
    expect(idOf(routes, "GET", "/engine/default/thing/t1")).toBe("scoped")
    expect(idOf(routes, "GET", "/engine/default/version")).toBeUndefined()
    expect(idOf(routes, "GET", "/engine")).toBe("engines")
    expect(idOf(routes, "GET", "/engine/default")).toBeUndefined()
    expect(idOf(routes, "GET", "/engine//thing/t1")).toBeUndefined()
    expect(idOf(routes, "GET", "/engines/default/thing/t1")).toBeUndefined()
    expect(idOf(routes, "GET", "/engine/a/b/thing/t1")).toBeUndefined()
    expect(idOf(routes, "POST", "/engine")).toBeUndefined()
  })

  it("takes a route of the root path before one below a named engine", () => {
    const direct = route("direct", "GET", "/engine/{name}/thing/{id}", { engineScoped: false })
    const scoped = route("scoped", "GET", "/thing/{id}")
    expect(idOf(table(scoped, direct), "GET", "/engine/default/thing/t1")).toBe("direct")
  })
})

describe("intentOf", () => {
  it.each([
    ["read", "read"],
    ["write", "write"],
    ["delete", "write"],
    ["bulk", "write"],
  ] as const)("reads a route of effect %s as %s, whatever its method", (effect: Effect, intent) => {
    const known = route("known", "POST", "/x", { effect })
    expect(intentOf(known, "POST")).toBe(intent)
    expect(intentOf(known, "GET")).toBe(intent)
  })

  it("reads an unknown request only as a GET or a HEAD, in any case", () => {
    expect(["GET", "head", "Get"].map((method) => intentOf(undefined, method))).toEqual([
      "read",
      "read",
      "read",
    ])
    expect(
      ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"].map((method) => intentOf(undefined, method)),
    ).toEqual(["write", "write", "write", "write", "write"])
  })
})
