import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createCamunda7Client, type Camunda7ClientOptions, type Client } from "./client.js"
import { EngineRequestError, toEngineRequestError } from "./engine-error.js"

/**
 * Guard for the model-facing engine error text (#325). Runs the REAL
 * generated hey-api client built by `createCamunda7Client` against a REAL
 * local HTTP server that answers like an engine does — hey-api throws the
 * parsed ExceptionDto (not an Error) for every 4xx/5xx, which used to reach
 * the model as "[object Object]". Each assertion pins the exact `message`
 * widget-shell's `withToolErrors` hands to the model (`e instanceof Error ?
 * e.message : …`). The three calls below are what the generated SDK
 * functions of the same name send (`sdk.gen.ts`, not imported here: its ~460
 * thin wrappers would swamp this package's coverage ratchet); the connector's
 * `engine-errors.test.ts` drives the SDK itself through a registrar tool. The
 * deadline and caller cancellation are pinned in `client-deadline.test.ts`.
 */

const getProcessInstance = (o: { client: Client; path: { id: string } }) =>
  o.client.get({ url: "/process-instance/{id}", path: o.path })
const deleteProcessInstance = (o: { client: Client; path: { id: string } }) =>
  o.client.delete({ url: "/process-instance/{id}", path: o.path })
const startProcessInstanceByKey = (o: {
  client: Client
  path: { key: string }
  body: Record<string, unknown>
}) => o.client.post({ url: "/process-definition/key/{key}/start", path: o.path, body: o.body })

const LONG_TEXT = `upstream connect error or disconnect/reset before headers. ${"x".repeat(2000)}`

type Route = (res: http.ServerResponse, req: http.IncomingMessage) => void

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

function text(res: http.ServerResponse, status: number, body?: string) {
  res.writeHead(status, body === undefined ? {} : { "Content-Type": "text/plain" })
  res.end(body)
}

/** The request arrived (body read) — then the connection drops. */
const reset: Route = (_, req) => req.socket.destroy()

const routeTable: Record<string, Route> = {
  "/process-instance/bad-type": (res) =>
    json(res, 400, {
      type: "InvalidRequestException",
      message: 'Cannot convert value "abc" of type String to type Integer',
      code: 0,
    }),
  "/process-instance/missing": (res) =>
    json(res, 404, {
      type: "InvalidRequestException",
      message: "Process instance with id missing does not exist",
      code: 0,
    }),
  "/process-instance/locked": (res) =>
    json(res, 500, {
      type: "OptimisticLockingException",
      message: "ENGINE-03005 Execution of 'UPDATE ExecutionEntity[42]' failed.",
      code: 1,
    }),
  "/process-instance/empty": (res) => text(res, 500),
  "/process-instance/text": (res) => text(res, 502, LONG_TEXT),
  "/process-instance/proxy-json": (res) => json(res, 403, { error: "Forbidden", status: 403 }),
  // A proxy's envelope: `type` is no exception class name.
  "/process-instance/odd-type": (res) =>
    json(res, 400, { type: `Gateway\nError ${"y".repeat(300)}`, message: "boom" }),
  // Like a proxy that quotes the rejected credential back.
  "/process-instance/unauthorized": (res, req) =>
    text(res, 401, req.headers.authorization ? `denied: ${req.headers.authorization}` : ""),
  "/process-instance/reset": reset,
  "/process-definition/key/reset/start": reset,
}

// Matched by comparison against the fixed table, never looked up by the
// request path (no dispatch through inherited properties like "/constructor").
const routes = Object.entries(routeTable)
const routeFor = (path: string): Route | undefined => routes.find(([p]) => p === path)?.[1]

const engine = http.createServer((req, res) => {
  req.resume()
  req.on("end", () => {
    const path = (req.url ?? "").replace(/^\/engine-rest/, "").replace(/\?.*$/, "")
    const route = routeFor(path) ?? ((r: http.ServerResponse) => json(r, 200, { id: "ok" }))
    route(res, req)
  })
})

let baseUrl = ""
let closedPortUrl = ""

beforeAll(async () => {
  await new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(engine.address() as AddressInfo).port}/engine-rest`
  // A port that was just free and is closed again → ECONNREFUSED.
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const closedPort = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  closedPortUrl = `http://127.0.0.1:${closedPort}/engine-rest`
})

afterAll(async () => {
  engine.closeAllConnections()
  await new Promise<void>((resolve) => engine.close(() => resolve()))
})

function client(overrides: Partial<Camunda7ClientOptions> = {}) {
  return createCamunda7Client({ baseUrl, engineId: "prod-a", ...overrides })
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
  expect(error).toBeInstanceOf(Error)
  return error as EngineRequestError
}

describe("engine errors reach the model as actionable text", () => {
  it("400 ExceptionDto → status, exception type, engine message and engine id", async () => {
    const e = await failure(getProcessInstance({ client: client(), path: { id: "bad-type" } }))
    expect(e.message).toBe(
      '[400 InvalidRequestException] Cannot convert value "abc" of type String to type Integer (engine prod-a)',
    )
    expect(e).toMatchObject({
      kind: "http",
      httpStatus: 400,
      type: "InvalidRequestException",
      engineMessage: 'Cannot convert value "abc" of type String to type Integer',
      engineId: "prod-a",
    })
  })

  it("404 ExceptionDto (get + delete of an unknown id)", async () => {
    const get = await failure(getProcessInstance({ client: client(), path: { id: "missing" } }))
    expect(get.message).toBe(
      "[404 InvalidRequestException] Process instance with id missing does not exist (engine prod-a)",
    )
    const del = await failure(deleteProcessInstance({ client: client(), path: { id: "missing" } }))
    expect(del.message).toBe(get.message)
  })

  it("keeps the engine's error code as data without decorating the message with it", async () => {
    const e = await failure(getProcessInstance({ client: client(), path: { id: "locked" } }))
    expect(e.message).toBe(
      "[500 OptimisticLockingException] ENGINE-03005 Execution of 'UPDATE ExecutionEntity[42]' failed. (engine prod-a)",
    )
    expect(e.engineCode).toBe(1)
    // `status`/`code` would make widget-shell's withToolErrors prefix a second
    // "[500] " / "[1] " — the message already carries the status.
    expect(e).not.toHaveProperty("status")
    expect(e).not.toHaveProperty("code")
  })

  it("500 with an empty body → the status line instead of an empty object", async () => {
    const e = await failure(getProcessInstance({ client: client(), path: { id: "empty" } }))
    expect(e.message).toBe("[500] Internal Server Error — empty response body (engine prod-a)")
    expect(e).toMatchObject({ kind: "http", httpStatus: 500, type: undefined })
  })

  it("a text/plain body is passed through, whitespace-collapsed and truncated", async () => {
    const e = await failure(getProcessInstance({ client: client(), path: { id: "text" } }))
    expect(e.message).toMatch(
      /^\[502\] upstream connect error or disconnect\/reset before headers\. x+… \(engine prod-a\)$/,
    )
    expect(e.engineMessage.length).toBeLessThanOrEqual(501)
    expect(e.message.length).toBeLessThan(600)
  })

  it("a non-ExceptionDto JSON body (a proxy's) still yields its message", async () => {
    const e = await failure(getProcessInstance({ client: client(), path: { id: "proxy-json" } }))
    expect(e.message).toBe("[403] Forbidden (engine prod-a)")
  })

  it("drops a `type` that is no exception class name instead of echoing it", async () => {
    const e = await failure(getProcessInstance({ client: client(), path: { id: "odd-type" } }))
    expect(e.message).toBe("[400] boom (engine prod-a)")
    expect(e.type).toBeUndefined()
  })

  it("omits the engine suffix when the client has no engine id", async () => {
    const anonymous = createCamunda7Client({ baseUrl })
    const e = await failure(getProcessInstance({ client: anonymous, path: { id: "missing" } }))
    expect(e.message).toBe(
      "[404 InvalidRequestException] Process instance with id missing does not exist",
    )
    const down = createCamunda7Client({ baseUrl: closedPortUrl })
    expect((await failure(getProcessInstance({ client: down, path: { id: "x" } }))).message).toBe(
      "engine unreachable (ECONNREFUSED)",
    )
  })
})

describe("network failures", () => {
  it("ECONNREFUSED → engine <id> unreachable (<code>)", async () => {
    const e = await failure(
      getProcessInstance({ client: client({ baseUrl: closedPortUrl }), path: { id: "x" } }),
    )
    expect(e.message).toBe("engine prod-a unreachable (ECONNREFUSED)")
    expect(e).toMatchObject({ kind: "unreachable", httpStatus: undefined, engineId: "prod-a" })
  })

  it("a WRITE whose connection drops after the engine received it is not 'unreachable'", async () => {
    const e = await failure(
      startProcessInstanceByKey({ client: client(), path: { key: "reset" }, body: {} }),
    )
    expect(e.message).toBe(
      "connection to engine prod-a failed (UND_ERR_SOCKET) — the POST may still have been applied; check the current state before retrying",
    )
    expect(e).toMatchObject({ kind: "connection", engineMessage: "UND_ERR_SOCKET" })
  })

  it("a READ whose connection drops names the failure without the write caveat", async () => {
    const e = await failure(getProcessInstance({ client: client(), path: { id: "reset" } }))
    expect(e.message).toBe("connection to engine prod-a failed (UND_ERR_SOCKET)")
  })

  it("a POST query (POST /job, a read with a body) carries no write caveat; a POST write does", () => {
    const dropped = (method: string, path: string) =>
      (
        toEngineRequestError(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }), {
          request: new Request(`http://engine.invalid/engine-rest${path}`, { method }),
          engineId: "prod-a",
          timeoutMs: 1,
          timedOut: false,
        }) as EngineRequestError
      ).message
    expect(dropped("POST", "/job")).toBe("connection to engine prod-a failed (ECONNRESET)")
    expect(dropped("POST", "/job/")).toBe("connection to engine prod-a failed (ECONNRESET)")
    for (const [method, path] of [
      ["POST", "/job/retries"],
      ["POST", "/job/j-1/execute"],
      ["PUT", "/job"],
      ["DELETE", "/job"],
    ]) {
      expect(dropped(method, path), `${method} ${path}`).toMatch(
        new RegExp(`— the ${method} may still have been applied`),
      )
    }
  })

  it("only connect-phase failures — the engine cannot have seen the request — read 'unreachable'", () => {
    const post = new Request("http://engine.invalid/x", { method: "POST" })
    const map = (code?: string) =>
      toEngineRequestError(new TypeError("fetch failed", { cause: code ? { code } : {} }), {
        request: post,
        engineId: "prod-a",
        timeoutMs: 1,
        timedOut: false,
      }) as EngineRequestError
    const connectPhase = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]
    for (const code of [...connectPhase, "UND_ERR_CONNECT_TIMEOUT"]) {
      expect(map(code).message).toBe(`engine prod-a unreachable (${code})`)
    }
    for (const code of ["ECONNRESET", "EPIPE", "ETIMEDOUT", undefined]) {
      expect(map(code)).toMatchObject({ kind: "connection" })
      expect(map(code).message).toMatch(/— the POST may still have been applied/)
    }
    expect(map(undefined).message).toMatch(/^connection to engine prod-a failed \(network error\)/)
  })
})

describe("401 hints per auth type", () => {
  const unauthorized = (options: Partial<Camunda7ClientOptions>) =>
    failure(getProcessInstance({ client: client(options), path: { id: "unauthorized" } }))

  it("passthrough without a caller token", async () => {
    const e = await unauthorized({ authType: "passthrough", tokenProvider: () => undefined })
    expect(e.message).toBe(
      "[401] Unauthorized — empty response body (engine prod-a). The MCP request carried no bearer token to pass through.",
    )
  })

  // The fake engine quotes the rejected Authorization header back, like some
  // proxies do — the credential must be masked, not handed to the model.
  it("passthrough with a forwarded token", async () => {
    const e = await unauthorized({ authType: "passthrough", tokenProvider: () => "tok-123" })
    expect(e.message).toBe(
      "[401] denied: Bearer *** (engine prod-a). The engine rejected the forwarded bearer token.",
    )
    expect(e.engineMessage).toBe("denied: Bearer ***")
  })

  it("static basic credentials", async () => {
    const e = await unauthorized({ authType: "basic", username: "demo", password: "s3cret" })
    expect(e.message).toBe(
      "[401] denied: Basic *** (engine prod-a). The engine rejected the configured credentials.",
    )
    expect(e.message).not.toContain(Buffer.from("demo:s3cret").toString("base64"))
  })

  it("a static bearer token, configured with a stray trailing newline", async () => {
    const e = await unauthorized({ authType: "bearer", token: "tok-456\n" })
    expect(e.message).toBe(
      "[401] denied: Bearer *** (engine prod-a). The engine rejected the configured credentials.",
    )
  })

  it("no auth configured", async () => {
    const e = await unauthorized({ authType: "none" })
    expect(e.message).toMatch(/The engine requires authentication, but none is configured\.$/)
  })
})
