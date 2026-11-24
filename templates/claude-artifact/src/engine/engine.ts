import type { Count } from "@miragon/pulse-ui/format"
import { EngineError, asEngineError, type Connector, type ToolResult } from "./connector.ts"
import type { ToolName } from "./tools.ts"

/** The envelope every list tool of the Pulse MCP server answers with. */
export interface ListEnvelope<T> {
  items: T[]
  /** The engine's own count of every match (its `/count`), not the length of this page. */
  totalCount?: number
  hasMore?: boolean
  nextOffset?: number
}

/** A row of a list tool: every list the page reads carries the engine's `id` of the row. */
export interface Row {
  id: string
}

/**
 * Why a paged read holds less than every match for sure:
 * - `cap`: the cap stopped the paging while the server had more
 * - `changed`: the list changed while it was paged (rows came or went), so a row may have moved
 *   past a page boundary and been missed: a page's count differs from the first page's, a row came
 *   twice, or the distinct rows differ from the engine's count
 */
export type Cut = "cap" | "changed"

/** A list read page by page: the rows held, the total, whether every match is in `items`. */
export interface Paged<T> {
  /** The rows read, each once (by its `id`), in the order the engine paged them. */
  items: T[]
  /**
   * How many match: the engine's count where it gives one (its latest page's, exact, even when the
   * cap cut the rows), else the rows read, a lower bound (`{ atLeast }`) when they are cut.
   */
  total: Count
  /**
   * False when `items` may miss rows (`cut` says why): a sum over `items` is then a lower bound
   * and shows as one. `total` stays the engine's count; it is never the sign of a cut.
   */
  complete: boolean
  /** Why `complete` is false; null when it is true. */
  cut: Cut | null
}

export interface PageOptions {
  /** The most rows read; the paging stops at the first page past it. Default 1,000. */
  cap?: number
}

export interface Engine {
  /** The engine every call reads (`engine_list_engines`: its default, else its only engine). */
  engineId(): Promise<string>
  /**
   * One tool call with `engine` added, its data (`structuredContent`, else the JSON of its text),
   * kept for `ttlMs` by tool and arguments; calls in flight with the same arguments share one.
   * Every call after `invalidate()`, and a call whose last read failed, asks the connector for a
   * fresh answer (`refresh`), so no cache under it answers the viewer's Refresh or Try again.
   */
  call<T>(tool: ToolName, args?: Record<string, unknown>): Promise<T>
  /** A list's total (`maxResults: 1`, its `totalCount`); `null` when the server gives none. */
  count(tool: ToolName, args?: Record<string, unknown>): Promise<Count>
  /**
   * A list read in pages of 100 while the server has more, up to the cap, each row once by its
   * `id`; a list that changed while it was paged is marked cut, never passed off as whole.
   */
  page<T extends Row>(
    tool: ToolName,
    args?: Record<string, unknown>,
    options?: PageOptions,
  ): Promise<Paged<T>>
  /** Forgets every kept answer: the next calls read the engine again, past any cache under it. */
  invalidate(): void
  /** The engine's clock: the fixture's recording time when the page runs on fixtures. */
  now(): Date
}

export interface EngineOptions {
  /**
   * How long an answer is kept. Default `ANSWER_TTL_MS`; the artifact's runtime keeps its own
   * answers that long whatever this says (claude-connector.ts).
   */
  ttlMs?: number
  /** The engine's clock, which the reads take their time windows from. Default: the browser's. */
  now?: () => Date
  /** The clock the kept answers age by, in ms. Default `Date.now`. */
  clock?: () => number
  /** The engine to read; default: `engine_list_engines`' default engine, else its only one. */
  engineId?: string
}

/**
 * How long an answer is kept: by the page's engine and by the artifact's runtime under it (its
 * cache's `staleTime`, claude-connector.ts), one value, so an answer the engine forgets is stale in
 * the runtime too. 30 s, the server's own floor under expensive reads.
 */
export const ANSWER_TTL_MS = 30_000

/** A list tool's page: at most 100 rows (the server refuses more). */
export const PAGE_SIZE = 100
export const DEFAULT_CAP = 1000

/** The arguments as one key: sorted keys at every depth, so `{a, b}` and `{b, a}` are one call. */
export function canonicalArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : value,
  )
}

export function callKey(tool: string, args: Record<string, unknown>): string {
  return `${tool} ${canonicalArgs(args)}`
}

/** A tool result's text, its parts joined. */
export function resultText(result: ToolResult): string {
  return (result.content ?? [])
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
}

/** A tool result's data: `structuredContent`, else its text as JSON; an error result throws. */
export function resultData<T>(tool: ToolName, result: ToolResult): T {
  if (result.isError) throw new EngineError("tool_error", tool, resultText(result))
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent as T
  }
  const text = resultText(result)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new EngineError("tool_error", tool, text || "The tool answered without data.")
  }
}

interface EngineList {
  engines?: { id: string }[]
  defaultEngineId?: string | null
}

/** The engine a page without an explicit one reads: the default, else the only one. */
export function pickEngine(list: EngineList): string {
  if (list.defaultEngineId) return list.defaultEngineId
  const ids = (list.engines ?? []).map(({ id }) => id)
  if (ids.length === 1) return ids[0]
  throw new EngineError(
    "tool_error",
    "engine_list_engines",
    ids.length === 0
      ? "The server lists no engine."
      : `The server lists ${String(ids.length)} engines and no default: name one in createEngine's engineId (${ids.join(", ")}).`,
  )
}

export function createEngine(connector: Connector, options: EngineOptions = {}): Engine {
  const ttlMs = options.ttlMs ?? ANSWER_TTL_MS
  const now = options.now ?? (() => new Date())
  const clock = options.clock ?? (() => Date.now())
  const kept = new Map<string, { at: number; value: Promise<unknown> }>()
  /** The calls whose last read failed: their next read asks past the caches too. */
  const failed = new Set<string>()
  /** Set by the first `invalidate()`, the viewer's Refresh: from then on every call asks fresh. */
  let refreshed = false
  let engineIdOf: Promise<string> | undefined

  /** One call through the cache: a failure is never kept, so a retry reads again. */
  function cached<T>(tool: ToolName, args: Record<string, unknown>): Promise<T> {
    const key = callKey(tool, args)
    const at = clock()
    const hit = kept.get(key)
    if (hit !== undefined && at - hit.at < ttlMs) return hit.value as Promise<T>
    const refresh = refreshed || failed.has(key)
    const value = (async () => {
      let result: ToolResult
      try {
        result = await connector.callTool(tool, args, { refresh })
      } catch (error) {
        throw asEngineError(error, tool)
      }
      return resultData<T>(tool, result)
    })()
    kept.set(key, { at, value })
    value.then(
      () => failed.delete(key),
      () => {
        failed.add(key)
        if (kept.get(key)?.value === value) kept.delete(key)
      },
    )
    return value
  }

  function engineId(): Promise<string> {
    if (options.engineId !== undefined) return Promise.resolve(options.engineId)
    if (engineIdOf === undefined) {
      const picked = cached<EngineList>("engine_list_engines", {}).then(pickEngine)
      picked.catch(() => {
        if (engineIdOf === picked) engineIdOf = undefined
      })
      engineIdOf = picked
    }
    return engineIdOf
  }

  async function call<T>(tool: ToolName, args: Record<string, unknown> = {}): Promise<T> {
    if (tool === "engine_list_engines") return cached<T>(tool, args)
    return cached<T>(tool, { ...args, engine: await engineId() })
  }

  async function count(tool: ToolName, args: Record<string, unknown> = {}): Promise<Count> {
    const list = await call<ListEnvelope<unknown>>(tool, { ...args, maxResults: 1 })
    return typeof list.totalCount === "number" ? list.totalCount : null
  }

  async function page<T extends Row>(
    tool: ToolName,
    args: Record<string, unknown> = {},
    { cap = DEFAULT_CAP }: PageOptions = {},
  ): Promise<Paged<T>> {
    // Offset paging over a list that changes: a row that comes below the offset pushes a row read
    // before onto the next page (read twice) and one that goes pulls a row past it (missed). Rows
    // are kept once by their id, as c7-core's `instancesWithIncident` keeps them, and a read whose
    // pages disagree is marked cut.
    const byId = new Map<string, T>()
    let read = 0
    let firstResult = 0
    const counts: number[] = []
    let more = true
    while (more && read < cap) {
      const list = await call<ListEnvelope<T>>(tool, {
        ...args,
        firstResult,
        maxResults: PAGE_SIZE,
      })
      const rows = list.items ?? []
      read += rows.length
      for (const row of rows) byId.set(row.id, row)
      if (typeof list.totalCount === "number") counts.push(list.totalCount)
      more = list.hasMore === true && rows.length > 0
      firstResult = list.nextOffset ?? firstResult + rows.length
    }
    const items = [...byId.values()]
    const totalCount = counts.at(-1)
    const changed =
      read !== items.length ||
      counts.some((count) => count !== counts[0]) ||
      (totalCount !== undefined && totalCount !== items.length)
    const cut: Cut | null = more ? "cap" : changed ? "changed" : null
    const complete = cut === null
    const total: Count = totalCount ?? (complete ? items.length : { atLeast: items.length })
    return { items, total, complete, cut }
  }

  return {
    engineId,
    call,
    count,
    page,
    invalidate: () => {
      kept.clear()
      engineIdOf = undefined
      refreshed = true
    },
    now,
  }
}
