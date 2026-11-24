import { EngineError, asEngineError, type Connector, type ToolResult } from "./connector.ts"
import type { ToolName } from "./tools.ts"

export interface Engine {
  /**
   * One tool call, its data (`structuredContent`, else the JSON of its text), kept for `ttlMs` by
   * tool and arguments; calls in flight with the same arguments share one, so sections that read
   * the same answer make one call. With `engineId` set every call names that engine, else the
   * server reads its default engine (its only one, or the one it names as default). Every call
   * after `invalidate()`, and a call whose last read failed, asks the connector for a fresh answer
   * (`refresh`), so no cache under it answers the viewer's Refresh or Try again.
   */
  call<T>(tool: ToolName, args?: Record<string, unknown>): Promise<T>
  /** Forgets every kept answer: the next calls read the engine again, past any cache under it. */
  invalidate(): void
  /** The engine's clock: the fixture's recording time when the page runs on fixtures. */
  now(): Date
  /** The IANA time zone whose days the page counts in: the viewer's. */
  readonly timeZone: string
}

export interface EngineOptions {
  /**
   * How long an answer is kept. Default `ANSWER_TTL_MS`; the artifact's runtime keeps its own
   * answers that long whatever this says (claude-connector.ts).
   */
  ttlMs?: number
  /** The engine's clock, which relative times are measured from. Default: the browser's. */
  now?: () => Date
  /** The clock the kept answers age by, in ms. Default `Date.now`. */
  clock?: () => number
  /**
   * The engine every call names; default none, so the server reads its default engine. A server
   * with several engines and no default refuses a call without one (`ENGINE_NOT_SELECTED`): name
   * the engine here then.
   */
  engineId?: string
  /** The time zone the days are counted in. Default the viewer's (`viewerTimeZone`). */
  timeZone?: string
}

/**
 * How long an answer is kept: by the page's engine and by the artifact's runtime under it (its
 * cache's `staleTime`, claude-connector.ts), one value, so an answer the engine forgets is stale in
 * the runtime too. 30 s, the server's own floor under the reads the page makes.
 */
export const ANSWER_TTL_MS = 30_000

/** The viewer's IANA time zone, as the browser resolves it; UTC where it names none. */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

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

export function createEngine(connector: Connector, options: EngineOptions = {}): Engine {
  const ttlMs = options.ttlMs ?? ANSWER_TTL_MS
  const now = options.now ?? (() => new Date())
  const clock = options.clock ?? (() => Date.now())
  const kept = new Map<string, { at: number; value: Promise<unknown> }>()
  /** The calls whose last read failed: their next read asks past the caches too. */
  const failed = new Set<string>()
  /** Set by the first `invalidate()`, the viewer's Refresh: from then on every call asks fresh. */
  let refreshed = false

  /** One call through the cache: a failure is never kept, so a retry reads again. */
  function call<T>(tool: ToolName, args: Record<string, unknown> = {}): Promise<T> {
    const named = options.engineId === undefined ? args : { ...args, engine: options.engineId }
    const key = callKey(tool, named)
    const at = clock()
    const hit = kept.get(key)
    if (hit !== undefined && at - hit.at < ttlMs) return hit.value as Promise<T>
    const refresh = refreshed || failed.has(key)
    const value = (async () => {
      let result: ToolResult
      try {
        result = await connector.callTool(tool, named, { refresh })
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

  return {
    call,
    invalidate: () => {
      kept.clear()
      refreshed = true
    },
    now,
    timeZone: options.timeZone ?? viewerTimeZone(),
  }
}
