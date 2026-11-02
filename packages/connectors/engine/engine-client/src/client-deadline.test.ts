import http from "node:http"
import type { AddressInfo } from "node:net"
import { setFlagsFromString } from "node:v8"
import { runInNewContext } from "node:vm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createEngineClient, withCallerSignal, type Client } from "./client.js"
import { EngineRequestError } from "./engine-error.js"

/**
 * Guard for the engine-call deadline and caller cancellation (#325): the
 * REAL client against a REAL local HTTP server that hangs, stalls or answers
 * late. The model-facing error texts themselves are pinned in
 * `engine-error.test.ts`.
 */

// A real garbage collection, for the cases where only a GC exposes a broken
// abort chain (undici follows a Request's signal through a WeakRef).
setFlagsFromString("--expose-gc")
const gc = runInNewContext("gc") as () => void

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Lets the in-flight call settle on the engine, then collects garbage a few times. */
async function collectGarbageInFlight() {
  await sleep(30)
  for (let i = 0; i < 3; i++) {
    gc()
    await sleep(5)
  }
}

const getProcessInstance = (o: { client: Client; path: { id: string } }) =>
  o.client.get({ url: "/process-instance/{id}", path: o.path })
const startProcessInstanceByKey = (o: {
  client: Client
  path: { key: string }
  body: Record<string, unknown>
}) => o.client.post({ url: "/process-definition/key/{key}/start", path: o.path, body: o.body })

/** Requests the fake engine has seen — for the body and interceptor checks. */
const seen: Array<{ method?: string; path: string; headers: http.IncomingHttpHeaders }> = []

type Route = (res: http.ServerResponse, body: string) => void

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

const never: Route = () => {} // never answers — the deadline must end the call

const routeTable: Record<string, Route> = {
  "/process-instance/hang": never,
  "/process-definition/key/hang/start": never,
  // Headers, then a body that never completes.
  "/process-instance/stall-error": (res) => {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.write("{")
  },
  "/process-instance/stall-ok": (res) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.write('{"id":')
  },
  // Answers after the caller's signal fired: a write must still land.
  "/process-definition/key/slow/start": (res, body) => {
    setTimeout(() => json(res, 200, { id: "pi-1", echo: JSON.parse(body) as unknown }), 80)
  },
  "/process-definition/key/echo/start": (res, body) =>
    json(res, 200, { id: "pi-1", echo: JSON.parse(body) as unknown }),
}

// Matched by comparison against the fixed table, never looked up by the
// request path (no dispatch through inherited properties like "/constructor").
const routes = Object.entries(routeTable)
const routeFor = (path: string): Route | undefined => routes.find(([p]) => p === path)?.[1]

const engine = http.createServer((req, res) => {
  let body = ""
  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    const path = (req.url ?? "").replace(/^\/engine-rest/, "").replace(/\?.*$/, "")
    seen.push({ method: req.method, path, headers: req.headers })
    const route = routeFor(path) ?? ((r: http.ServerResponse) => json(r, 200, { id: "ok" }))
    route(res, body)
  })
})

let baseUrl = ""

beforeAll(async () => {
  await new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(engine.address() as AddressInfo).port}/engine-rest`
})

afterAll(async () => {
  engine.closeAllConnections()
  await new Promise<void>((resolve) => engine.close(() => resolve()))
})

function client(timeoutMs?: number) {
  return createEngineClient({ baseUrl, engineId: "prod-a", timeoutMs })
}

/** The rejection of `call`, asserted to be an EngineRequestError. */
async function failure(call: Promise<unknown>): Promise<EngineRequestError> {
  const error = await call.then(
    () => {
      throw new Error("expected the engine call to fail")
    },
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(EngineRequestError)
  return error as EngineRequestError
}

describe("the per-request deadline", () => {
  it("ends a call to a hung engine", async () => {
    const started = Date.now()
    const e = await failure(getProcessInstance({ client: client(50), path: { id: "hang" } }))
    expect(Date.now() - started).toBeLessThan(2000)
    expect(e.message).toBe("engine prod-a did not respond within 50 ms (timeout)")
    expect(e.kind).toBe("timeout")
  })

  it("warns that a timed-out WRITE may still have been applied", async () => {
    const e = await failure(
      startProcessInstanceByKey({ client: client(50), path: { key: "hang" }, body: {} }),
    )
    expect(e.message).toBe(
      "engine prod-a did not respond within 50 ms (timeout) — the POST may still have been applied; check the current state before retrying",
    )
  })

  // Abort first: these arrive WITH a response — the status must not win.
  it("wins over an error response whose BODY stalls", async () => {
    const e = await failure(
      getProcessInstance({ client: client(100), path: { id: "stall-error" } }),
    )
    expect(e.message).toBe("engine prod-a did not respond within 100 ms (timeout)")
  })

  it("also ends a 200 whose body stalls", async () => {
    const e = await failure(getProcessInstance({ client: client(100), path: { id: "stall-ok" } }))
    expect(e.message).toBe("engine prod-a did not respond within 100 ms (timeout)")
  })

  it("keeps request bodies intact", async () => {
    const started = (await startProcessInstanceByKey({
      client: client(),
      path: { key: "echo" },
      body: { businessKey: "order-7" },
    })) as unknown as { echo: { businessKey: string } }
    expect(started.echo).toEqual({ businessKey: "order-7" })
    expect(seen.filter((r) => r.path.includes("/key/echo/start")).at(-1)?.method).toBe("POST")
  })
})

describe("caller cancellation", () => {
  it("aborts a read when the caller's signal fires", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    const e = await failure(
      getProcessInstance({
        client: withCallerSignal(client(), controller.signal),
        path: { id: "hang" },
      }),
    )
    expect(e.message).toBe("request to engine prod-a was cancelled by the caller")
    expect(e.kind).toBe("cancelled")
  })

  it("still aborts the read after a garbage collection while it is in flight", async () => {
    const controller = new AbortController()
    const started = Date.now()
    const pending = failure(
      getProcessInstance({
        client: withCallerSignal(client(3000), controller.signal),
        path: { id: "hang" },
      }),
    )
    await collectGarbageInFlight()
    controller.abort()
    const e = await pending
    expect(e.message).toBe("request to engine prod-a was cancelled by the caller")
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it("an already-aborted signal fails fast without reaching the engine", async () => {
    const before = seen.length
    const e = await failure(
      getProcessInstance({
        client: withCallerSignal(client(), AbortSignal.abort()),
        path: { id: "ok" },
      }),
    )
    expect(e.kind).toBe("cancelled")
    expect(seen.length).toBe(before)
  })

  it("never aborts a write once started — the caller's signal only binds reads", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    const started = (await startProcessInstanceByKey({
      client: withCallerSignal(client(), controller.signal),
      path: { key: "slow" },
      body: { businessKey: "order-8" },
    })) as unknown as { id: string }
    expect(controller.signal.aborted).toBe(true)
    expect(started.id).toBe("pi-1")
  })

  it("returns the client unchanged without a signal", () => {
    const c = client()
    expect(withCallerSignal(c, undefined)).toBe(c)
  })
})

describe("a consumer's request interceptor that returns a NEW Request", () => {
  /** The common hey-api shape: copy the headers, add one, re-wrap the request. */
  function withTenantHeader(c: Client) {
    c.interceptors.request.use((request) => {
      const headers = new Headers(request.headers)
      headers.set("X-Tenant", "t-1")
      return new Request(request, { headers })
    })
    return c
  }

  it("cannot detach the deadline — nor make it read as a caller cancellation", async () => {
    const started = Date.now()
    const pending = failure(
      getProcessInstance({ client: withTenantHeader(client(200)), path: { id: "hang" } }),
    )
    await collectGarbageInFlight()
    const e = await pending
    expect(e.message).toBe("engine prod-a did not respond within 200 ms (timeout)")
    expect(e.kind).toBe("timeout")
    expect(Date.now() - started).toBeLessThan(2000)
    const last = seen.filter((r) => r.path === "/process-instance/hang").at(-1)
    expect(last?.headers["x-tenant"]).toBe("t-1")
  })

  it("keeps the caller's cancellation of a read", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    const e = await failure(
      getProcessInstance({
        client: withCallerSignal(withTenantHeader(client()), controller.signal),
        path: { id: "hang" },
      }),
    )
    expect(e.message).toBe("request to engine prod-a was cancelled by the caller")
  })
})
