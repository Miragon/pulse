/**
 * mcp-use 2's Node bridge buffers every non-GET body into one string and parses it (up to ~20× on
 * the heap) before the OAuth gate. So before the bridge: a guard-refused request's body is discarded
 * unread, an over-cap body gets 413, and a body past the in-flight budget gets 503 + `Retry-After`.
 * `mcp-use dev` serves through its own listener and is NOT capped.
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { toNodeHandler, type NodeIncomingMessageLike } from "mcp-use/node"
import { IN_FLIGHT_BODY_MULTIPLE, jsonRpcErrorBody } from "./http-edge.js"

/** `MCPServer` satisfies it structurally. */
export interface FetchTarget {
  fetch: (request: Request) => Promise<Response>
}

export interface BodyLimitedListenerOptions {
  maxBodyBytes: number
  maxInFlightBodyBytes?: number
  /** Requests the guard refuses whatever their body: discarded unread, answered bodiless. */
  refusedBeforeBody?: (req: IncomingMessage) => boolean
  /** Grace before the socket of a refused upload is cut (default 2000 ms). */
  discardGraceMs?: number
  /** The client still gets a JSON-RPC 500. */
  onError?: (error: Error) => void
}

export interface BodyLimitedListener {
  (req: IncomingMessage, res: ServerResponse): void
  readonly inFlight: number
  readonly heldBodyBytes: number
  idle(): Promise<void>
}

/** Grows with its body, released on close. */
interface BudgetShare {
  grow(total: number): boolean
  release(): void
}

type BodyRead =
  | { kind: "body"; chunks: Buffer[] }
  | { kind: "too-large" }
  | { kind: "busy" }
  | { kind: "aborted" }

function readCapped(req: IncomingMessage, limit: number, share: BudgetShare): Promise<BodyRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const settle = (result: BodyRead): void => {
      if (settled) return
      settled = true
      req.off("data", onData)
      resolve(result)
    }
    const stop = (kind: "too-large" | "busy"): void => {
      req.pause()
      settle({ kind })
    }
    const onData = (chunk: Buffer): void => {
      size += chunk.length
      if (size > limit) return stop("too-large")
      if (!share.grow(size)) return stop("busy")
      chunks.push(chunk)
    }
    req.on("data", onData)
    req.once("end", () => settle({ kind: "body", chunks }))
    req.once("error", () => settle({ kind: "aborted" }))
    req.once("close", () => settle(req.complete ? { kind: "body", chunks } : { kind: "aborted" }))
  })
}

function replay(
  req: IncomingMessage,
  chunks: Buffer[],
  headers: IncomingMessage["headers"] = req.headers,
): NodeIncomingMessageLike {
  return Object.assign(Readable.from(chunks), { method: req.method, url: req.url, headers })
}

/**
 * The body headers go too: mcp-use's JSON middleware runs BEFORE the guard and would answer an empty
 * `application/json` body 400 instead of letting the guard 403.
 */
function bodiless(req: IncomingMessage): NodeIncomingMessageLike {
  const headers = { ...req.headers }
  for (const name of ["content-length", "transfer-encoding", "content-type", "content-encoding"]) {
    delete headers[name]
  }
  return replay(req, [], headers)
}

interface Refusal {
  status: number
  message: string
  headers?: Record<string, string>
}

function refuse(
  req: IncomingMessage,
  res: ServerResponse,
  { status, message, headers = {} }: Refusal,
  graceMs: number,
): void {
  const body = Buffer.from(jsonRpcErrorBody(message))
  res.writeHead(status, {
    ...headers,
    "content-type": "application/json",
    "content-length": body.length,
    connection: "close",
  })
  res.end(body)
  // Drain so the client reads the answer instead of a reset; cut once the grace is up.
  req.resume()
  const timer = setTimeout(() => req.socket.destroy(), graceMs)
  timer.unref()
  req.socket.once("close", () => clearTimeout(timer))
}

export function createBodyLimitedListener(
  target: FetchTarget,
  {
    maxBodyBytes,
    maxInFlightBodyBytes = IN_FLIGHT_BODY_MULTIPLE * maxBodyBytes,
    refusedBeforeBody,
    discardGraceMs = 2000,
    onError,
  }: BodyLimitedListenerOptions,
): BodyLimitedListener {
  const bridge = toNodeHandler(
    { fetch: (request) => target.fetch(request) },
    onError ? { onerror: onError } : {},
  )
  const tooLarge: Refusal = {
    status: 413,
    message: `Payload too large: the request body exceeds ${maxBodyBytes} bytes (MCP_MAX_BODY_BYTES).`,
  }
  const busy: Refusal = {
    status: 503,
    message: `Server busy: request bodies in flight would exceed ${maxInFlightBodyBytes} bytes — retry shortly.`,
    headers: { "retry-after": "1" },
  }
  let inFlight = 0
  let heldBodyBytes = 0
  let waiters: Array<() => void> = []
  const settle = (): void => {
    inFlight -= 1
    if (inFlight > 0) return
    const ready = waiters
    waiters = []
    for (const resolve of ready) resolve()
  }
  const budgetShare = (): BudgetShare => {
    let held = 0
    return {
      grow: (total) => {
        const extra = total - held
        if (extra <= 0) return true
        if (heldBodyBytes + extra > maxInFlightBodyBytes) return false
        heldBodyBytes += extra
        held = total
        return true
      },
      release: () => {
        heldBodyBytes -= held
        held = 0
      },
    }
  }

  const serve = async (
    req: IncomingMessage,
    res: ServerResponse,
    share: BudgetShare,
  ): Promise<void> => {
    const method = (req.method ?? "GET").toUpperCase()
    if (method === "GET" || method === "HEAD") return bridge(req, res)
    if (refusedBeforeBody?.(req)) {
      // The app's guard answers (and counts) the 403.
      req.resume()
      res.setHeader("connection", "close")
      return bridge(bodiless(req), res)
    }
    const declared = Number(req.headers["content-length"])
    if (declared > maxBodyBytes) return refuse(req, res, tooLarge, discardGraceMs)
    if (declared > 0 && !share.grow(declared)) return refuse(req, res, busy, discardGraceMs)
    const read = await readCapped(req, maxBodyBytes, share)
    if (read.kind === "too-large") return refuse(req, res, tooLarge, discardGraceMs)
    if (read.kind === "busy") return refuse(req, res, busy, discardGraceMs)
    if (read.kind === "aborted") return
    return bridge(replay(req, read.chunks), res)
  }

  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    inFlight += 1
    // Created before the first await, so a client that disconnects at once still releases it.
    const share = budgetShare()
    res.once("close", () => {
      share.release()
      settle()
    })
    serve(req, res, share).catch((error: unknown) => {
      onError?.(error instanceof Error ? error : new Error(String(error)))
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  }

  // defineProperties, not Object.assign: the counts must stay live getters.
  return Object.defineProperties(listener, {
    inFlight: { get: () => inFlight, enumerable: true },
    heldBodyBytes: { get: () => heldBodyBytes, enumerable: true },
    idle: {
      value: (): Promise<void> =>
        inFlight === 0 ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve)),
    },
  }) as BodyLimitedListener
}
