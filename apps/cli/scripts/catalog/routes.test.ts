import { describe, expect, it } from "vitest"
import type { Catalog } from "../../src/catalog/types.js"
import { buildCatalog } from "./build-catalog.js"
import { readSpec, readRoutes } from "./files.js"
import { SPEC_URL } from "./render.js"
import { type CatalogRoutes, parseRoutes, routeFor } from "./routes.js"

let cachedCatalog: Catalog | undefined

/**
 * The catalog built from the spec. Built lazily inside the first test that needs it, never at
 * load time, so a generator failure fails that test instead of the whole file.
 */
function realCatalog(): Catalog {
  cachedCatalog ??= buildCatalog(readSpec(), SPEC_URL, readRoutes())
  return cachedCatalog
}

function baseOperations() {
  return realCatalog().operations.filter((operation) => operation.preset === undefined)
}

function effectOf(operationId: string) {
  const operation = baseOperations().find((candidate) => candidate.operationId === operationId)
  if (operation === undefined) throw new Error(`unknown operation ${operationId}`)
  return operation.effect
}

const ROUTES: CatalogRoutes = {
  getJob: { method: "GET", path: "/job/{id}", effect: "read", engineScoped: true },
}

describe("parseRoutes", () => {
  it("reads a table of routes", () => {
    expect(parseRoutes(JSON.stringify(ROUTES))).toEqual(ROUTES)
  })

  it.each(["[]", "null", "3"])("refuses %s as a table", (text) => {
    expect(() => parseRoutes(text)).toThrow(new Error("The route table is no JSON object"))
  })

  it.each([
    ["a method that is no text", { method: 1 }],
    ["a path that is no text", { path: null }],
    ["an effect the catalog does not know", { effect: "destroy" }],
    ["an engine scope that is no boolean", { engineScoped: "yes" }],
  ])("refuses a route with %s", (_, change) => {
    const text = JSON.stringify({ getJob: { ...ROUTES.getJob, ...change } })
    expect(() => parseRoutes(text)).toThrow(new Error("The route of getJob is unreadable"))
  })

  it("refuses a route that is no object", () => {
    expect(() => parseRoutes(JSON.stringify({ getJob: [] }))).toThrow(
      new Error("The route of getJob is unreadable"),
    )
  })
})

describe("routeFor", () => {
  const stale = (method: string, path: string, id: string) =>
    new Error(
      `${method} ${path} (${id}) is not in c7-core's route table: run ` +
        "`pnpm --fail-if-no-match --filter @miragon/pulse-c7-core generate`",
    )

  it("finds the route of an operation by its id, method and path", () => {
    expect(routeFor(ROUTES, "getJob", "GET", "/job/{id}")).toBe(ROUTES.getJob)
  })

  it("fails for an operation the table lacks, an inherited name included", () => {
    expect(() => routeFor(ROUTES, "getTask", "GET", "/task/{id}")).toThrow(
      stale("GET", "/task/{id}", "getTask"),
    )
    expect(() => routeFor(ROUTES, "constructor", "GET", "/x")).toThrow(
      stale("GET", "/x", "constructor"),
    )
  })

  it("fails for an operation the table has under another method or path", () => {
    expect(() => routeFor(ROUTES, "getJob", "POST", "/job/{id}")).toThrow(
      stale("POST", "/job/{id}", "getJob"),
    )
    expect(() => routeFor(ROUTES, "getJob", "GET", "/job")).toThrow(stale("GET", "/job", "getJob"))
  })
})

describe("effects in the generated catalog", () => {
  it("are the route table's, as is the engine scope", () => {
    const routes = readRoutes()
    for (const operation of realCatalog().operations) {
      expect(routes[operation.operationId]).toMatchObject({
        method: operation.method,
        path: operation.path,
        effect: operation.effect,
        engineScoped: operation.engineScoped,
      })
    }
  })

  it("classifies every GET operation as read", () => {
    const gets = baseOperations().filter((operation) => operation.method === "GET")
    expect(gets.length).toBeGreaterThan(100)
    expect(gets.filter((operation) => operation.effect !== "read")).toEqual([])
  })

  it.each([
    "queryProcessInstances",
    "queryProcessInstancesCount",
    "queryTasks",
    "queryTasksCount",
    "queryHistoricProcessInstances",
    "evaluateDecisionByKey",
    "postExecuteFilterList",
    "generateMigrationPlan",
  ])("classifies the query/count POST %s as read", (operationId) => {
    expect(effectOf(operationId)).toBe("read")
  })

  it.each([
    ["deleteProcessInstance", "delete"],
    ["deleteDeployment", "delete"],
    ["resolveIncident", "delete"],
    ["startProcessInstanceByKey", "write"],
    ["createDeployment", "write"],
    ["fetchAndLock", "write"],
    ["deliverMessage", "write"],
    ["evaluateCondition", "write"],
    ["deleteIdentityLink", "delete"],
    ["deleteProcessInstancesAsyncOperation", "bulk"],
    ["setRetriesByProcess", "bulk"],
    ["updateSuspensionStateAsyncOperation", "bulk"],
  ] as const)("classifies %s as %s", (operationId, effect) => {
    expect(effectOf(operationId)).toBe(effect)
  })

  it("has the expected number of operations per effect", () => {
    const counts = Object.fromEntries(
      (["read", "write", "delete", "bulk"] as const).map((effect) => [
        effect,
        realCatalog().operations.filter((operation) => operation.effect === effect).length,
      ]),
    )
    expect(counts).toEqual({ read: 235, write: 100, delete: 29, bulk: 32 })
  })

  it("marks only /engine and /version as not engine scoped", () => {
    const unscoped = baseOperations().filter((operation) => !operation.engineScoped)
    expect(unscoped.map((operation) => operation.path).sort()).toEqual(["/engine", "/version"])
  })

  it("classifies every command named delete as delete or bulk", () => {
    const deletes = realCatalog().operations.filter((operation) =>
      operation.name.startsWith("delete"),
    )
    expect(deletes.length).toBeGreaterThan(20)
    expect(deletes.filter((operation) => !["delete", "bulk"].includes(operation.effect))).toEqual(
      [],
    )
  })
})
