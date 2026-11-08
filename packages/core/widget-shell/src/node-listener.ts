/**
 * The one place that sees `req.url` as sent: the bridge's URL parser resolves dot segments before
 * any route, so a target that is not its own normal form gets 404 here, on every route, ahead of
 * the guard and OAuth (a `Host` the bridge would join into the path gets 400, a method it cannot
 * build a `Request` of 405).
 *
 * The bridge also buffers every non-GET body before the app sees it, and a JSON body parses into a
 * heap graph up to ~20× its size, all before the OAuth gate. So before the bridge: a guard-refused
 * request's body is discarded unread, an over-cap body gets 413, and a body past the in-flight
 * budget gets 503 + `Retry-After`. Every boot serves through it, `pnpm dev` included.
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { toNodeHandler, type NodeIncomingMessageLike } from "@modelcontextprotocol/node"
import {
  IN_FLIGHT_BODY_MULTIPLE,
  isNormalTarget,
  isUsableHost,
  isUsableMethod,
  jsonRpcErrorBody,
  METHOD_REFUSED,
  NOT_A_HOST,
  NOT_NORMAL_TARGET,
  pathOfTarget,
  type RefusedRequest,
} from "./http-edge.js"

/** `McpHttpApp` satisfies it structurally. */
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
  /** A request answered here, which the app's log and metrics never see. */
  onRefused?: (refused: RefusedRequest) => void
  /** What a path takes, for the `Allow` of a 405; the default, empty, says it takes nothing. */
  allowedMethods?: (path: string) => string
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
 * The body headers go too: a handler that parses JSON before the guard would answer an empty
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

const NOT_NORMAL: Refusal = { status: 404, message: NOT_NORMAL_TARGET }
const BAD_HOST: Refusal = { status: 400, message: NOT_A_HOST }

/** The path first, which takes no header and no body. */
function targetRefusal(req: IncomingMessage): Refusal | undefined {
  if (!isNormalTarget(req.url ?? "/")) return NOT_NORMAL
  return isUsableHost(req.headers.host) ? undefined : BAD_HOST
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
    "cache-control": "no-store",
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
    onRefused,
    allowedMethods = () => "",
    onError,
  }: BodyLimitedListenerOptions,
): BodyLimitedListener {
  const bridge = toNodeHandler(
    { fetch: (request) => target.fetch(request) },
    { maxRequestBodySize: maxBodyBytes, ...(onError ? { onerror: onError } : {}) },
  )
  const tooLarge: Refusal = {
    status: 413,
    message: `Payload too large: the request body exceeds ${maxBodyBytes} bytes (MCP_MAX_BODY_BYTES).`,
  }
  const busy: Refusal = {
    status: 503,
    message: `Server busy: request bodies in flight would exceed ${maxInFlightBodyBytes} bytes. Retry shortly.`,
    headers: { "retry-after": "1" },
  }
  /** The target before the method: `Allow` reads a path, and only a normal one names a route. */
  const edgeRefusal = (req: IncomingMessage, method: string): Refusal | undefined => {
    const refused = targetRefusal(req)
    if (refused || isUsableMethod(method)) return refused
    const allow = allowedMethods(pathOfTarget(req.url ?? "/"))
    return { status: 405, message: METHOD_REFUSED, headers: { allow } }
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
    const refused = edgeRefusal(req, method)
    if (refused) {
      onRefused?.({ method, target: req.url ?? "/", ...refused })
      return refuse(req, res, refused, discardGraceMs)
    }
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
