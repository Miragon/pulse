/**
 * The engine port of the Camunda 7 REST API family: the operations a workflow sends, by the
 * operation ids of the REST API, and the read rules every caller shares (paging, missing
 * resources, text answers). A caller supplies the transport; vendors are its runtime config.
 */

import { type Rec, records } from "./records.js"

/** Query values by wire name, as text; undefined entries are not sent. */
export type Query = Readonly<Record<string, string | undefined>>

/** Path values in path order, the query, an optional JSON body. */
export interface OperationInput {
  readonly pathArgs: readonly string[]
  readonly query: Query
  readonly body?: unknown
}

/** A request a workflow sends. */
export interface PlannedRequest {
  readonly operationId: string
  readonly input: OperationInput
}

/**
 * A write of a workflow; `label` says it in words (`execute job j1`), for a preview. Not named
 * `summary`: scripts/hand-off-refs.test.mjs reads an object literal with a `summary` in a
 * package's source as a hand-off to the model.
 */
export interface PlannedWrite extends PlannedRequest {
  readonly label: string
}

/** What an engine's error answer says. */
export interface EngineFailure {
  readonly status: number
  readonly engineType?: string
  readonly engineMessage?: string
}

/**
 * How a caller reaches one engine. `A` is the caller's answer of a request, which the port reads
 * as JSON or as text right after awaiting it.
 */
export interface EngineTransport<A = unknown> {
  /** Sends the operation and resolves to its answer; rejects on any failure. */
  send(operationId: string, input: OperationInput): Promise<A>
  /** The JSON value of an answer; undefined when it carries none. */
  json(answer: A): unknown
  /** The text of an answer (stacktrace, error details); undefined when it carries none. */
  text(answer: A): string | undefined
  /** The engine answer an error of `send` carries; undefined for anything else. */
  failure(error: unknown): EngineFailure | undefined
}

export interface ListResult {
  readonly items: readonly Rec[]
  /** True when the engine has more than the `cap` items that were loaded. */
  readonly truncated: boolean
}

/** What the workflows run on. */
export interface EnginePort {
  /** The JSON value of the operation. */
  json(operationId: string, input: OperationInput): Promise<unknown>
  /** As `json`; a missing resource (`isMissing`) gives undefined. */
  find(operationId: string, input: OperationInput): Promise<unknown>
  /** All pages of 500, at most `cap` items (one more is asked for to tell truncation). */
  list(operationId: string, query: Query, cap?: number): Promise<ListResult>
  /** A text answer; missing, 204, empty or blank give undefined. */
  text(operationId: string, pathArgs: readonly string[]): Promise<string | undefined>
  /** The engine answer an error of the port carries (the transport's reading). */
  failure(error: unknown): EngineFailure | undefined
}

/** Most parallel requests of one round. */
export const PARALLEL = 8
const PAGE_SIZE = 500

/**
 * A 404 that is no engine answer about a resource: no exception type (a servlet container's or a
 * proxy's error page) or the JAX-RS `NotFoundException` of a path the REST API does not serve. The
 * engine URL is most likely not the REST API root (or this engine does not serve the endpoint).
 */
export function isUnknownEndpoint(failure: EngineFailure | undefined): boolean {
  const type = failure?.engineType
  return failure?.status === 404 && (type === undefined || type === "NotFoundException")
}

/**
 * An engine 404 that names a missing resource: status 404 that is no unknown endpoint
 * ({@link isUnknownEndpoint}: no exception type, or NotFoundException) and no QueryParamException
 * (an unreadable query value). The ONE missing-resource rule of the family: the MCP tools, the CLI
 * and the VS Code extension read a 404 through it, so a wrong REST root fails loud instead of
 * reading as "none".
 */
export function isMissing(failure: EngineFailure | undefined): boolean {
  return (
    failure?.status === 404 &&
    !isUnknownEndpoint(failure) &&
    failure.engineType !== "QueryParamException"
  )
}

/** The query of a page of `list`. */
export function pageQuery(query: Query, first: number, size: number): Query {
  return { ...query, firstResult: String(first), maxResults: String(size) }
}

/** Page size of the next page: one item more than `cap` in total tells whether more exist. */
function pageSize(loaded: number, cap: number): number {
  return Math.min(PAGE_SIZE, cap + 1 - loaded)
}

/**
 * The port over `transport`: a plain object of closures, never a class instance, so a caller can
 * spread it and add its own methods.
 */
export function createEnginePort<A>(transport: EngineTransport<A>): EnginePort {
  const missing = (error: unknown) => isMissing(transport.failure(error))
  return {
    async json(operationId, input) {
      return transport.json(await transport.send(operationId, input))
    },
    failure: (error) => transport.failure(error),
    async find(operationId, input) {
      try {
        return transport.json(await transport.send(operationId, input))
      } catch (error) {
        if (missing(error)) return undefined
        throw error
      }
    },
    async list(operationId, query, cap = Number.POSITIVE_INFINITY) {
      const items: Rec[] = []
      for (let size = pageSize(0, cap); ; size = pageSize(items.length, cap)) {
        const input = { pathArgs: [], query: pageQuery(query, items.length, size) }
        const page = records(transport.json(await transport.send(operationId, input)))
        for (const item of page) items.push(item)
        // a page of a different size is the last one (shorter, or the engine ignored the paging)
        if (page.length !== size || items.length > cap) break
      }
      return { items: items.slice(0, cap), truncated: items.length > cap }
    },
    async text(operationId, pathArgs) {
      try {
        const text = transport.text(await transport.send(operationId, { pathArgs, query: {} }))
        return text !== undefined && text.trim() !== "" ? text : undefined
      } catch (error) {
        if (missing(error)) return undefined
        throw error
      }
    },
  }
}

/**
 * At most `limit` requests in flight: the rounds of a workflow may start more at once, the
 * others wait for a free slot (a released slot passes straight to the next waiter).
 */
export class Slots {
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly limit = PARALLEL) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  release(): void {
    const next = this.waiting.shift()
    if (next === undefined) this.active -= 1
    else next()
  }

  /** Runs `fn` in a slot: waits for one, frees it when `fn` settles. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
