import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createBodyLimitedListener,
  type BodyLimitedListenerOptions,
  type FetchTarget,
} from "./node-listener.js"

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

/** An echo target: answers with the method and the body it received. */
function echoTarget(): FetchTarget & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async (request: Request) =>
      Response.json({ method: request.method, body: await request.text() }),
    ),
  }
}

async function serve(
  target: FetchTarget,
  maxBodyBytes: number,
  extra: Omit<BodyLimitedListenerOptions, "maxBodyBytes"> = {},
) {
  const listener = createBodyLimitedListener(target, { maxBodyBytes, ...extra })
  const server = http.createServer(listener)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return { listener, port: (server.address() as AddressInfo).port }
}

interface Sent {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

/** How long an upload that is never finished may wait for its answer. */
const OPEN_UPLOAD_ANSWER_MS = 2000

/** An upload left open must be answered WHILE open, failing clearly instead of on vitest's timeout. */
function post(
  port: number,
  options: {
    chunks: Buffer[]
    end: boolean
    contentLength?: number
    headers?: http.OutgoingHttpHeaders
  },
): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const headers: http.OutgoingHttpHeaders = {
      "content-type": "application/json",
      ...options.headers,
    }
    if (options.contentLength !== undefined) headers["content-length"] = options.contentLength
    const req = http.request(
      { host: "127.0.0.1", port, method: "POST", path: "/mcp", headers, agent: false },
      (res) => {
        const received: Buffer[] = []
        res.on("data", (chunk: Buffer) => received.push(chunk))
        res.on("end", () => {
          clearTimeout(unanswered)
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(received).toString("utf8"),
          })
          req.destroy()
        })
      },
    )
    const unanswered = options.end
      ? undefined
      : setTimeout(() => {
          req.destroy()
          reject(
            new Error(
              `No answer within ${OPEN_UPLOAD_ANSWER_MS} ms while the upload was still open — ` +
                "the server waited for the body instead of refusing it",
            ),
          )
        }, OPEN_UPLOAD_ANSWER_MS)
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "ECONNRESET" && error.code !== "EPIPE") reject(error)
    })
    for (const chunk of options.chunks) req.write(chunk)
    if (options.end) req.end()
  })
}

const errorMessage = (body: string): string =>
  (JSON.parse(body) as { error: { message: string } }).error.message

describe("createBodyLimitedListener", () => {
  it("passes bodies within the cap through to the fetch target unchanged", async () => {
    const target = echoTarget()
    const { port } = await serve(target, 64)
    const res = await post(port, {
      chunks: [Buffer.from('{"a":'), Buffer.from("1}")],
      end: true,
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ method: "POST", body: '{"a":1}' })
  })

  it("accepts a body of exactly the cap", async () => {
    const target = echoTarget()
    const { port } = await serve(target, 8)
    const res = await post(port, { chunks: [Buffer.alloc(8, 0x61)], end: true })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ method: "POST", body: "aaaaaaaa" })
  })

  it("answers 413 on a declared Content-Length over the cap without reading or forwarding", async () => {
    const target = echoTarget()
    const { port } = await serve(target, 1024)
    // Answered with 16 of the 4096 declared bytes sent (`post` fails otherwise).
    const res = await post(port, { chunks: [Buffer.alloc(16)], end: false, contentLength: 4096 })
    expect(res.status).toBe(413)
    expect(res.headers.connection).toBe("close")
    expect(JSON.parse(res.body)).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Payload too large: the request body exceeds 1024 bytes (MCP_MAX_BODY_BYTES).",
      },
      id: null,
    })
    expect(target.fetch).not.toHaveBeenCalled()
  })

  it("answers 413 mid-stream for an undeclared body while the client is still sending", async () => {
    const target = echoTarget()
    const { port } = await serve(target, 1024)
    // The upload is never ended — only a mid-stream answer resolves `post`.
    const res = await post(port, { chunks: [Buffer.alloc(600), Buffer.alloc(600)], end: false })
    expect(res.status).toBe(413)
    expect(target.fetch).not.toHaveBeenCalled()
  })

  it("cuts a refused upload's connection after the discard grace", async () => {
    const { port } = await serve(echoTarget(), 16, { discardGraceMs: 20 })
    const closed = new Promise<void>((resolve) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/",
        agent: false,
        headers: { "content-length": 1_000_000 },
      })
      req.on("error", () => resolve())
      req.on("close", () => resolve())
      req.on("response", (res) => res.resume())
      // Keep uploading slowly: only the server's grace timer can end this.
      const timer = setInterval(() => req.write(Buffer.alloc(8)), 5)
      req.on("close", () => clearInterval(timer))
    })
    await expect(closed).resolves.toBeUndefined()
  })

  it("leaves GET requests (no body) to the bridge untouched", async () => {
    const target = echoTarget()
    const { port } = await serve(target, 1)
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path: "/x", agent: false }, (r) => {
          const chunks: Buffer[] = []
          r.on("data", (c: Buffer) => chunks.push(c))
          r.on("end", () =>
            resolve({ status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
          )
        })
        .on("error", reject)
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ method: "GET", body: "" })
  })

  it("tracks in-flight requests and resolves idle() once they finish", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const target: FetchTarget = {
      fetch: async () => {
        await gate
        return new Response("done")
      },
    }
    const { listener, port } = await serve(target, 1024)
    await expect(listener.idle()).resolves.toBeUndefined()

    const pending = post(port, { chunks: [Buffer.from("{}")], end: true })
    await vi.waitFor(() => expect(listener.inFlight).toBe(1))
    let idle = false
    const idlePromise = listener.idle().then(() => {
      idle = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(idle).toBe(false)

    release()
    expect((await pending).status).toBe(200)
    await idlePromise
    expect(listener.inFlight).toBe(0)
  })

  it("reports a throwing target through onError and answers a JSON-RPC 500", async () => {
    const onError = vi.fn()
    const listener = createBodyLimitedListener(
      {
        fetch: () => Promise.reject(new Error("boom")),
      },
      { maxBodyBytes: 1024, onError },
    )
    const server = http.createServer(listener)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const res = await post((server.address() as AddressInfo).port, {
      chunks: [Buffer.from("{}")],
      end: true,
    })
    expect(res.status).toBe(500)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }))
  })

  it("does not answer a client that aborted mid-upload", async () => {
    const target = echoTarget()
    const { listener, port } = await serve(target, 1024)
    await new Promise<void>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", agent: false })
      req.on("error", () => resolve())
      req.write(Buffer.alloc(10))
      setTimeout(() => {
        req.destroy()
        resolve()
      }, 20)
    })
    await vi.waitFor(() => expect(listener.inFlight).toBe(0))
    expect(listener.heldBodyBytes).toBe(0)
    expect(target.fetch).not.toHaveBeenCalled()
  })
})

/** A target that holds every request until `release()` — in-flight tool calls. */
function gatedTarget() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const target = {
    fetch: vi.fn(async (request: Request) => {
      const body = await request.text()
      await gate
      return Response.json({ body })
    }),
  }
  return { target, release }
}

describe("createBodyLimitedListener — the in-flight body budget", () => {
  it("answers 503 + Retry-After for a declared body the budget has no room for, unread", async () => {
    const { target, release } = gatedTarget()
    const { listener, port } = await serve(target, 100, { maxInFlightBodyBytes: 150 })
    const holder = post(port, { chunks: [Buffer.alloc(100, 0x61)], end: true })
    await vi.waitFor(() => expect(listener.heldBodyBytes).toBe(100))

    // 10 of the 100 declared bytes sent: refused before the rest is read.
    const res = await post(port, { chunks: [Buffer.alloc(10)], end: false, contentLength: 100 })
    expect(res.status).toBe(503)
    expect(res.headers["retry-after"]).toBe("1")
    expect(res.headers.connection).toBe("close")
    expect(errorMessage(res.body)).toBe(
      "Server busy: request bodies in flight would exceed 150 bytes — retry shortly.",
    )
    expect(target.fetch).toHaveBeenCalledTimes(1)
    expect(listener.heldBodyBytes).toBe(100)

    release()
    expect((await holder).status).toBe(200)
  })

  it("answers 503 mid-stream when an undeclared body outgrows the budget", async () => {
    const { target, release } = gatedTarget()
    const { listener, port } = await serve(target, 100, { maxInFlightBodyBytes: 150 })
    const holder = post(port, { chunks: [Buffer.alloc(100, 0x61)], end: true })
    await vi.waitFor(() => expect(listener.heldBodyBytes).toBe(100))

    const res = await post(port, { chunks: [Buffer.alloc(30), Buffer.alloc(30)], end: false })
    expect(res.status).toBe(503)
    expect(target.fetch).toHaveBeenCalledTimes(1)
    release()
    await holder
  })

  it("holds a body until its response closes, then admits the next one", async () => {
    const { target, release } = gatedTarget()
    const { listener, port } = await serve(target, 100, { maxInFlightBodyBytes: 100 })
    const holder = post(port, { chunks: [Buffer.alloc(100, 0x61)], end: true })
    await vi.waitFor(() => expect(listener.heldBodyBytes).toBe(100))
    // The bridge has the body — the share still counts while the response is open.
    await vi.waitFor(() => expect(target.fetch).toHaveBeenCalledTimes(1))
    const refused = await post(port, { chunks: [Buffer.alloc(1)], end: true })
    expect(refused.status).toBe(503)

    release()
    expect((await holder).status).toBe(200)
    await vi.waitFor(() => expect(listener.heldBodyBytes).toBe(0))
    const next = await post(port, { chunks: [Buffer.alloc(100, 0x62)], end: true })
    expect(next.status).toBe(200)
    expect(JSON.parse(next.body)).toEqual({ body: "b".repeat(100) })
  })

  it("defaults the budget to four cap-sized bodies", async () => {
    const { target, release } = gatedTarget()
    const { listener, port } = await serve(target, 10)
    const holders = Array.from({ length: 4 }, () =>
      post(port, { chunks: [Buffer.alloc(10, 0x61)], end: true }),
    )
    await vi.waitFor(() => expect(listener.heldBodyBytes).toBe(40))
    expect((await post(port, { chunks: [Buffer.alloc(1)], end: true })).status).toBe(503)
    release()
    for (const holder of holders) expect((await holder).status).toBe(200)
  })
})

describe("createBodyLimitedListener — requests refused before their body", () => {
  /** Echoes what the bridge handed on: the body and its framing/type headers. */
  function headerEcho(): FetchTarget & { fetch: ReturnType<typeof vi.fn> } {
    return {
      fetch: vi.fn(async (request: Request) =>
        Response.json({
          body: await request.text(),
          contentType: request.headers.get("content-type"),
          contentLength: request.headers.get("content-length"),
          host: request.headers.get("host"),
        }),
      ),
    }
  }

  const refuseForeignHost = (req: http.IncomingMessage) => req.headers.host === "attacker.example"

  it("discards the body unread and hands the app the request without one", async () => {
    const target = headerEcho()
    const { listener, port } = await serve(target, 64, { refusedBeforeBody: refuseForeignHost })
    // Over the cap AND never finished: answered anyway, by the app, bodiless.
    const res = await post(port, {
      chunks: [Buffer.alloc(1000, 0x61)],
      end: false,
      contentLength: 5000,
      headers: { host: "attacker.example" },
    })
    expect(res.status).toBe(200)
    expect(res.headers.connection).toBe("close")
    expect(JSON.parse(res.body)).toEqual({
      body: "",
      contentType: null,
      contentLength: null,
      host: "attacker.example",
    })
    expect(listener.heldBodyBytes).toBe(0)
  })

  it("reads, caps and forwards every other request as before", async () => {
    const target = headerEcho()
    const { port } = await serve(target, 64, { refusedBeforeBody: refuseForeignHost })
    const res = await post(port, { chunks: [Buffer.from('{"a":1}')], end: true })
    expect(JSON.parse(res.body)).toMatchObject({
      body: '{"a":1}',
      contentType: "application/json",
    })
    const capped = await post(port, { chunks: [Buffer.alloc(65)], end: false })
    expect(capped.status).toBe(413)
  })

  it("never consults the check for GET/HEAD — there is no body to spare", async () => {
    const refusedBeforeBody = vi.fn(() => true)
    const { port } = await serve(echoTarget(), 64, { refusedBeforeBody })
    await new Promise<void>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path: "/", agent: false }, (res) => {
          res.resume()
          res.on("end", resolve)
        })
        .on("error", reject)
    })
    expect(refusedBeforeBody).not.toHaveBeenCalled()
  })
})
