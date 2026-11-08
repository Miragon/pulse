import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { rawRequest } from "./composed-server.test-support.js"
import type { RefusedRequest } from "./http-edge.js"
import {
  createBodyLimitedListener,
  type BodyLimitedListenerOptions,
  type FetchTarget,
} from "./node-listener.js"

/** The listener on its own, on real sockets: `req.url` is the only place a raw target exists. */

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

const appOf = () => ({ fetch: vi.fn(async () => new Response("reached")) })

async function serve(target: FetchTarget, extra: Partial<BodyLimitedListenerOptions> = {}) {
  const refused: RefusedRequest[] = []
  const listener = createBodyLimitedListener(target, {
    maxBodyBytes: 64,
    onRefused: (request) => refused.push(request),
    ...extra,
  })
  const server = http.createServer(listener)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return { listener, refused, port: (server.address() as AddressInfo).port }
}

describe("createBodyLimitedListener: the target as sent", () => {
  it.each([
    "/./mcp",
    "/x/../mcp",
    "/%2e/mcp",
    "//mcp",
    "/mcp/",
    "/\\mcp",
    "/mcp#f",
    "http://h/mcp",
  ])("answers %s itself, with nothing reaching the app", async (target) => {
    const app = appOf()
    const { port, refused } = await serve(app)
    const res = await rawRequest(port, { target })
    expect(res.status).toBe(404)
    expect(res.body).toContain("not in its normal form")
    expect(app.fetch).not.toHaveBeenCalled()
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ method: "GET", target, status: 404 })
    expect(refused[0].message).toContain("Not found")
  })

  it("closes the connection, whatever the client asked, and stays out of a cache", async () => {
    const { port } = await serve(appOf())
    for (const request of [{ target: "/./mcp" }, { target: "/x", host: "h/mcp?" }]) {
      const { head } = await rawRequest(port, { ...request, connection: "keep-alive" })
      expect(head).toMatch(/^connection: close$/im)
      expect(head).toMatch(/^cache-control: no-store$/im)
    }
  })

  it("hands a normal target on, its query intact", async () => {
    const app: FetchTarget = {
      fetch: async (request) => new Response(new URL(request.url).search),
    }
    const { port, refused } = await serve(app)
    const res = await rawRequest(port, { target: "/mcp?x=/../y" })
    expect(res.status).toBe(200)
    expect(res.body).toContain("?x=/../y")
    expect(refused).toEqual([])
  })

  it("answers before the body: an open upload over the cap reads no byte of it", async () => {
    const app = appOf()
    const refusedBeforeBody = vi.fn(() => false)
    const { listener, port } = await serve(app, { refusedBeforeBody })
    const res = await rawRequest(port, {
      method: "POST",
      target: "/./mcp",
      body: { length: 5000, sent: "x".repeat(10) },
    })
    expect(res.status).toBe(404)
    expect(listener.heldBodyBytes).toBe(0)
    expect(refusedBeforeBody).not.toHaveBeenCalled()
    expect(app.fetch).not.toHaveBeenCalled()
  })

  it("settles a refused request, so a drain does not wait for it", async () => {
    const { listener, port } = await serve(appOf())
    await rawRequest(port, { target: "/./mcp" })
    await listener.idle()
    expect(listener.inFlight).toBe(0)
  })

  it("sends a HEAD no body", async () => {
    const { port } = await serve(appOf())
    const res = await rawRequest(port, { method: "HEAD", target: "/./mcp" })
    expect(res.status).toBe(404)
    expect(res.body).toBe("")
  })

  it("answers the same without an onRefused", async () => {
    const { port } = await serve(appOf(), { onRefused: undefined })
    expect((await rawRequest(port, { target: "/./mcp" })).status).toBe(404)
  })

  it("reads the Host only for a normal target: the path decides first", async () => {
    const { port } = await serve(appOf())
    expect((await rawRequest(port, { target: "/./mcp", host: "h/mcp?" })).status).toBe(404)
  })

  it.each([
    "h/mcp?",
    "h/mcp#",
    "h\\mcp?",
    "h\\y",
    "",
    "a b",
    "%",
    "[",
    "h:abc",
    "user:pw@h",
    "\x85",
  ])("refuses Host %j, which the bridge would join into the path or fail on", async (host) => {
    const app = appOf()
    const { port, refused } = await serve(app)
    const res = await rawRequest(port, { target: "/x", host })
    expect(res.status).toBe(400)
    expect(app.fetch).not.toHaveBeenCalled()
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ method: "GET", target: "/x", status: 400 })
    expect(refused[0].message).toContain("Host")
  })

  it("takes a request without a Host, which only HTTP/1.0 may send", async () => {
    const app: FetchTarget = { fetch: async (request) => new Response(new URL(request.url).host) }
    const { port } = await serve(app)
    const res = await rawRequest(port, { target: "/x", host: null, version: "1.0" })
    expect(res.status).toBe(200)
    expect(res.body).toContain("localhost")
  })
})

describe("createBodyLimitedListener: a method no Request can carry", () => {
  it("answers it itself, with nothing reaching the app or onError", async () => {
    const app = appOf()
    const onError = vi.fn()
    const { port, refused } = await serve(app, { onError })
    const res = await rawRequest(port, { method: "TRACE", target: "/mcp" })
    expect(res.status).toBe(405)
    expect(res.body).toContain("Method not allowed")
    expect(app.fetch).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ method: "TRACE", target: "/mcp", status: 405 })
    expect(refused[0].message).toContain("Method not allowed")
  })

  it("closes the connection, whatever the client asked, and stays out of a cache", async () => {
    const { port } = await serve(appOf())
    const { head } = await rawRequest(port, {
      method: "TRACE",
      target: "/mcp",
      connection: "keep-alive",
    })
    expect(head).toMatch(/^connection: close$/im)
    expect(head).toMatch(/^cache-control: no-store$/im)
  })

  it("asks allowedMethods for the path, without its query", async () => {
    const allowedMethods = vi.fn(() => "GET, HEAD")
    const { port } = await serve(appOf(), { allowedMethods })
    const { head } = await rawRequest(port, { method: "TRACE", target: "/health/live?x=1" })
    expect(head).toMatch(/^allow: GET, HEAD$/im)
    expect(allowedMethods).toHaveBeenCalledExactlyOnceWith("/health/live")
  })

  it("names an empty list without allowedMethods", async () => {
    const { port } = await serve(appOf())
    const { head } = await rawRequest(port, { method: "TRACE", target: "/mcp" })
    expect(head).toMatch(/^allow: *$/im)
  })

  it("leaves a method the bridge can carry to the app", async () => {
    const app = appOf()
    const { port, refused } = await serve(app)
    const res = await rawRequest(port, { method: "PROPFIND", target: "/mcp" })
    expect(res.status).toBe(200)
    expect(app.fetch).toHaveBeenCalledTimes(1)
    expect(refused).toEqual([])
  })

  it("answers before the body: an open upload over the cap reads no byte of it", async () => {
    const app = appOf()
    const refusedBeforeBody = vi.fn(() => false)
    const { listener, port } = await serve(app, { refusedBeforeBody })
    const res = await rawRequest(port, {
      method: "TRACE",
      target: "/mcp",
      body: { length: 5000, sent: "x".repeat(10) },
    })
    expect(res.status).toBe(405)
    expect(listener.heldBodyBytes).toBe(0)
    expect(refusedBeforeBody).not.toHaveBeenCalled()
    expect(app.fetch).not.toHaveBeenCalled()
  })

  it("settles the request, so a drain does not wait for it", async () => {
    const { listener, port } = await serve(appOf())
    await rawRequest(port, { method: "TRACE", target: "/mcp" })
    await listener.idle()
    expect(listener.inFlight).toBe(0)
  })

  it("reads the target and the Host first: `Allow` needs a route's path", async () => {
    const allowedMethods = vi.fn(() => "GET")
    const { port } = await serve(appOf(), { allowedMethods })
    const trace = { method: "TRACE", target: "/mcp" }
    expect((await rawRequest(port, { ...trace, target: "/./mcp" })).status).toBe(404)
    expect((await rawRequest(port, { ...trace, target: "*" })).status).toBe(404)
    expect((await rawRequest(port, { ...trace, host: "h/mcp?" })).status).toBe(400)
    expect(allowedMethods).not.toHaveBeenCalled()
  })
})
