import { describe, expect, it } from "vitest"
import { CORE_ROUTES } from "./core-routes.js"
import { CORE_OPERATIONS } from "./operations.js"
import { ROUTES } from "./routes.js"

const METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
const EFFECTS = ["read", "write", "delete", "bulk"]

describe("CORE_ROUTES", () => {
  it("holds the route of every operation c7-core sends, and no other", () => {
    expect(Object.keys(CORE_ROUTES)).toEqual(CORE_OPERATIONS)
  })

  it("holds reads only: c7-core sends no write, a plan's writes are the caller's to send", () => {
    const writes = Object.values(CORE_ROUTES).filter((route) => route.effect !== "read")
    expect(writes.map((route) => route.operationId)).toEqual([])
  })

  it("holds each route as the whole table does", () => {
    for (const [operationId, route] of Object.entries(CORE_ROUTES)) {
      expect(route).toEqual(ROUTES[operationId])
    }
  })
})

describe("ROUTES", () => {
  it("holds every operation of the spec under its own id", () => {
    expect(Object.keys(ROUTES)).toHaveLength(399)
    for (const [operationId, route] of Object.entries(ROUTES)) {
      expect(route.operationId).toBe(operationId)
      expect(METHODS).toContain(route.method)
      expect(EFFECTS).toContain(route.effect)
      expect(route.path.startsWith("/")).toBe(true)
      expect(route.accepts.every((type) => typeof type === "string")).toBe(true)
    }
  })

  it("carries method, path, effect, engine scope and the media types to accept", () => {
    expect(ROUTES.getStacktrace).toEqual({
      operationId: "getStacktrace",
      method: "GET",
      path: "/job/{id}/stacktrace",
      effect: "read",
      engineScoped: true,
      accepts: ["text/plain"],
    })
    expect(ROUTES.getRestAPIVersion?.engineScoped).toBe(false)
    expect(ROUTES.executeJob?.accepts).toEqual([])
  })
})
