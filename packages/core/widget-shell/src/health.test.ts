import { afterEach, describe, expect, it, vi } from "vitest"
import { installHealthEndpoints, type HealthOptions, type HttpRouteHost } from "./health.js"

type Handler = (ctx: unknown) => Response | Promise<Response>

function install(options?: HealthOptions) {
  const routes = new Map<string, Handler>()
  const server: HttpRouteHost = {
    get: (path, handler) => routes.set(path, handler),
  }
  installHealthEndpoints(server, options)
  const call = async (path: string) => {
    const handler = routes.get(path)
    if (!handler) throw new Error(`no route registered for ${path}`)
    const res = await handler({})
    return { status: res.status, body: await res.json(), headers: res.headers }
  }
  return { routes, call }
}

describe("installHealthEndpoints", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("registers live, ready and the bare prefix", () => {
    const { routes } = install()
    expect([...routes.keys()].sort()).toEqual(["/health", "/health/live", "/health/ready"])
  })

  it("honors a custom prefix", () => {
    const { routes } = install({ path: "/healthz" })
    expect([...routes.keys()].sort()).toEqual(["/healthz", "/healthz/live", "/healthz/ready"])
  })

  it("live answers up without running any readiness check", async () => {
    const check = vi.fn()
    const { call } = install({ readiness: { db: check } })
    const res = await call("/health/live")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: "up" })
    expect(check).not.toHaveBeenCalled()
  })

  it("marks probe responses uncacheable JSON", async () => {
    const { call } = install()
    const res = await call("/health/live")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8")
  })

  it("ready is up with no checks configured", async () => {
    const { call } = install()
    const res = await call("/health/ready")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: "up", checks: {} })
  })

  it("ready is up when every check passes (sync and async)", async () => {
    const { call } = install({ readiness: { db: async () => {}, disk: () => {} } })
    const res = await call("/health/ready")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: "up", checks: { db: "up", disk: "up" } })
  })

  it("ready is 503 naming the failing check, and logs the reason instead of exposing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { call } = install({
      label: "test-app",
      readiness: {
        db: async () => {
          throw new Error("connect ECONNREFUSED")
        },
        disk: () => {},
      },
    })
    const res = await call("/health/ready")
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: "down", checks: { db: "down", disk: "up" } })
    expect(JSON.stringify(res.body)).not.toContain("ECONNREFUSED")
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toBe('[test-app] readiness check "db" failed:')
    expect(String(warn.mock.calls[0][1])).toContain("ECONNREFUSED")
  })

  it("treats a synchronous throw like a rejection", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { call } = install({
      readiness: {
        boom: () => {
          throw new Error("sync")
        },
      },
    })
    const res = await call("/health/ready")
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: "down", checks: { boom: "down" } })
  })

  it("fails a check that exceeds the timeout instead of hanging the probe", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { call } = install({
      timeoutMs: 10,
      readiness: { hung: () => new Promise<void>(() => {}) },
    })
    const res = await call("/health/ready")
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: "down", checks: { hung: "down" } })
    expect(String(warn.mock.calls[0][1])).toContain("timed out after 10ms")
  })

  it("answers 503 draining once the host drains (without running the checks) while live stays up", async () => {
    const check = vi.fn()
    let draining = false
    const { call } = install({ readiness: { db: check }, draining: () => draining })
    expect((await call("/health/ready")).status).toBe(200)

    draining = true
    const ready = await call("/health/ready")
    expect(ready.status).toBe(503)
    expect(ready.body).toEqual({ status: "draining", checks: {} })
    expect((await call("/health")).status).toBe(503)
    expect(check).toHaveBeenCalledTimes(1)
    expect((await call("/health/live")).status).toBe(200)
  })

  it("reports draining for a probe that was in flight when the drain began", async () => {
    let draining = false
    const { call } = install({
      readiness: {
        db: () => {
          draining = true
        },
      },
      draining: () => draining,
    })
    const res = await call("/health/ready")
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: "draining", checks: { db: "up" } })
  })

  it("the bare prefix aliases readiness", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { call } = install({
      readiness: {
        db: async () => {
          throw new Error("down")
        },
      },
    })
    const res = await call("/health")
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: "down", checks: { db: "down" } })
  })
})
