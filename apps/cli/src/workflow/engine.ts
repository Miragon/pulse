/**
 * Engine access of the workflow commands: catalog operations sent through
 * `buildRequest` + `sendRequest` exactly like `ping`, so `--engine`, auth, `-H`, `--timeout`,
 * `--verbose` traces, redirect refusal and the error hints apply unchanged, and hints name the
 * generated command of the request (`pulse-cli task complete`).
 */

import { findByOperationId } from "../catalog/catalog.js"
import type { Catalog, OperationSpec } from "../catalog/types.js"
import type {
  AuthorizedPreview,
  EnginePort,
  PlannedRequest,
  Query,
} from "../engine-port/engine-port.js"
import { OperateError } from "../errors.js"
import type { ClientOptions } from "../http/client.js"
import { commandRef } from "../operation/command-ref.js"
import { dryRunPreview } from "../operation/preview.js"
import {
  buildRequest,
  enginePrefix,
  expandPath,
  type OperationInput,
  type Target,
} from "../operation/request.js"
import type { OperationResult } from "../operation/result.js"
import { sendRequest } from "../operation/send.js"
import { mapLimit } from "../util.js"
import { countOf, type Rec, records } from "./records.js"

/** Most parallel requests of one round. */
export const PARALLEL = 8
/** Ids per request of a query parameter that takes a comma separated list (URL length). */
export const ID_CHUNK = 50
const PAGE_SIZE = 500

/** Engine 404s mean "missing"; routing 404s (a wrong REST root) have no engine type. */
export function isMissing(error: unknown): boolean {
  if (!(error instanceof OperateError) || error.code !== "NOT_FOUND") return false
  const type = error.details.engineType
  return type !== undefined && type !== "NotFoundException"
}

function jsonValue(result: OperationResult): unknown {
  return result.kind === "json" ? result.value : undefined
}

/** The query of the first page of `list`. */
export function pageQuery(query: Query, first: number, size: number): Query {
  return { ...query, firstResult: String(first), maxResults: String(size) }
}

/** Page size of the next page: one item more than `cap` in total tells whether more exist. */
function pageSize(loaded: number, cap: number): number {
  return Math.min(PAGE_SIZE, cap + 1 - loaded)
}

/**
 * At most `PARALLEL` requests in flight: the rounds of a command may start more at once, the
 * others wait for a free slot (a released slot passes straight to the next waiter).
 */
class Slots {
  private active = 0
  private readonly waiting: (() => void)[] = []

  async acquire(): Promise<void> {
    if (this.active < PARALLEL) {
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
}

class CatalogPort implements EnginePort {
  private readonly slots = new Slots()

  constructor(
    private readonly catalog: Catalog,
    private readonly target: Target,
    private readonly client: ClientOptions,
  ) {}

  private operation(operationId: string, input: OperationInput): OperationSpec {
    const operation = findByOperationId(this.catalog, operationId)
    if (operation === undefined) {
      throw new OperateError("INTERNAL", `The catalog has no operation ${operationId}`)
    }
    for (const [key, value] of Object.entries(input.query)) {
      const known = operation.params.some((param) => param.in === "query" && param.name === key)
      if (value !== undefined && !known) {
        throw new OperateError("INTERNAL", `${operationId} has no query parameter ${key}`)
      }
    }
    return operation
  }

  async call(operationId: string, input: OperationInput): Promise<OperationResult> {
    const operation = this.operation(operationId, input)
    const request = buildRequest(operation, input, this.target)
    await this.slots.acquire()
    try {
      return await sendRequest(request, this.client, commandRef(operation, this.catalog))
    } finally {
      this.slots.release()
    }
  }

  async find(operationId: string, input: OperationInput): Promise<unknown> {
    try {
      return jsonValue(await this.call(operationId, input))
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
  }

  async list(operationId: string, query: Query, cap = Number.POSITIVE_INFINITY) {
    const items: Rec[] = []
    for (let size = pageSize(0, cap); ; size = pageSize(items.length, cap)) {
      const input = { pathArgs: [], query: pageQuery(query, items.length, size) }
      const page = records(jsonValue(await this.call(operationId, input)))
      for (const item of page) items.push(item)
      // a page of a different size is the last one (shorter, or the engine ignored the paging)
      if (page.length !== size || items.length > cap) break
    }
    return { items: items.slice(0, cap), truncated: items.length > cap }
  }

  async text(operationId: string, pathArgs: readonly string[]): Promise<string | undefined> {
    try {
      const result = await this.call(operationId, { pathArgs, query: {} })
      return result.kind === "text" && result.text.trim() !== "" ? result.text : undefined
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
  }

  async preview(request: PlannedRequest): Promise<AuthorizedPreview> {
    const operation = this.operation(request.operationId, request.input)
    const built = buildRequest(operation, request.input, this.target)
    const { request: preview, note } = await dryRunPreview(built, this.client.auth)
    return note === undefined ? { request: preview } : { request: preview, note }
  }

  route(operationId: string, input: OperationInput): string {
    const operation = this.operation(operationId, input)
    const prefix = enginePrefix(this.target.engine, operation.engineScoped)
    return `${operation.method} ${prefix}${expandPath(operation, input.pathArgs)}`
  }
}

export function enginePort(catalog: Catalog, target: Target, client: ClientOptions): EnginePort {
  return new CatalogPort(catalog, target, client)
}

/** The JSON value of a request. */
export async function json(
  port: EnginePort,
  operationId: string,
  input: OperationInput,
): Promise<unknown> {
  return jsonValue(await port.call(operationId, input))
}

/** A request without path arguments. */
export function queryInput(query: Query): OperationInput {
  return { pathArgs: [], query }
}

/** `ids` in chunks of `ID_CHUNK`, each joined with commas. */
function idChunks(ids: readonly string[]): string[] {
  const chunks: string[] = []
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    chunks.push(ids.slice(start, start + ID_CHUNK).join(","))
  }
  return chunks
}

/** A list or count request over an id list (`processInstanceIds`, ...): `key` takes the ids. */
export interface IdRequest {
  readonly operationId: string
  readonly key: string
  readonly ids: readonly string[]
  readonly query?: Query
  /** Items per chunk at most (lists only). */
  readonly cap?: number
}

/**
 * The summed `count` of a count operation over an id list, sent in chunks of 50 ids; no ids give
 * 0 without a request.
 */
export async function countByIds(port: EnginePort, request: IdRequest): Promise<number> {
  const counts = await mapLimit(idChunks(request.ids), PARALLEL, async (chunk) => {
    const query = { ...request.query, [request.key]: chunk }
    return countOf(await json(port, request.operationId, queryInput(query)))
  })
  return counts.reduce((sum, count) => sum + count, 0)
}

/** The items of a list operation over an id list, chunked like `countByIds` and concatenated. */
export async function listByIds(port: EnginePort, request: IdRequest): Promise<Rec[]> {
  const pages = await mapLimit(idChunks(request.ids), PARALLEL, async (chunk) =>
    port.list(request.operationId, { ...request.query, [request.key]: chunk }, request.cap),
  )
  return pages.flatMap((page) => page.items)
}
