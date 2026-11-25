/**
 * The calls of a page's reads, framework-free over the page's ONE query client: the page's
 * sections read through it (`useSectionRead`), a recorder or a test in Node through
 * `createPageReader`, the same code either way.
 */
import { QueryClient } from "@tanstack/react-query"
import { getFormatTimeZone } from "@miragon/pulse-ui"
import { decodeToolResult } from "../../protocol/tool-result.js"
import type { ToolCaller } from "../browser-view-host.js"
import type { ToolCallOptions } from "../view-host.js"
import { isPageWideRefusal } from "./page-call-error.js"

/** The root of every page read's cache key: the calls and the sections. */
export const PAGE_READS = "pulse-page-reads"

/** The prefix of the sections' reads, under which a section's own key follows. */
export const SECTION_READS: readonly unknown[] = [PAGE_READS, "section"]

/**
 * How long an answer stays fresh, at both levels: 30 s, the server's own floor under its expensive
 * reads, and what a caller that keeps answers of its own keeps them for.
 */
export const PAGE_READ_TTL_MS = 30_000

/**
 * What a page's read sees: its calls, the zone it counts days in and the page's clock. The page's
 * own reads name their tools (`PageReader<ToolName>`), so a tool the page does not declare is a
 * type error.
 */
export interface PageReader<TTool extends string = string> {
  /**
   * One tool call, its data (`decodeToolResult`: an `isError` answer throws its text), kept 30 s
   * by connection, tool and arguments (their keys in any order), shared while it runs; a failure
   * is never kept. `connector` names another connection than the caller's own.
   */
  call<T = unknown>(
    tool: TTool,
    args?: Record<string, unknown>,
    options?: { readonly connector?: string },
  ): Promise<T>
  /** The IANA zone the page counts days in: the one its dates render in. */
  readonly timeZone: string
  /** The page's clock: a recording's time where the page replays one, else now. */
  now(): Date
}

export interface PageReaderOptions {
  /** The query client the calls are kept in; default one of the reader's own. */
  readonly client?: QueryClient
  /** The zone the days are counted in; default the one the kit's formatters render in. */
  readonly timeZone?: string
  /** The page's clock; default now. */
  readonly now?: () => Date
}

/** The clients whose page was refreshed: from then on every call asks past the caches. */
const refreshed = new WeakSet<QueryClient>()

/** The page's Refresh ran on `client`: its calls ask the server from now on. */
export function markRefreshed(client: QueryClient): void {
  refreshed.add(client)
}

export function wasRefreshed(client: QueryClient): boolean {
  return refreshed.has(client)
}

/** An answer's top-level `asOf`, when the server read it, in ms; none where it names none. */
function asOfOf(answer: unknown): number | undefined {
  const asOf = (answer as { asOf?: unknown } | null | undefined)?.asOf
  const at = typeof asOf === "string" ? Date.parse(asOf) : Number.NaN
  return Number.isNaN(at) ? undefined : at
}

/**
 * The reader of one run of a read: its calls go through `client`, and `onAsOf` hears each
 * answer's `asOf`, a kept one's too. A call asks past every cache under the caller (`refresh`)
 * once the page was refreshed or the call settled before (a failure's Try again, an answer older
 * than 30 s), so only a key's first read may come from the caller's own cache.
 */
export function readerOf(
  callTool: ToolCaller,
  client: QueryClient,
  timeZone: string,
  now: () => Date,
  onAsOf?: (at: number) => void,
): PageReader {
  async function call<T>(
    tool: string,
    args: Record<string, unknown> = {},
    { connector }: { readonly connector?: string } = {},
  ): Promise<T> {
    const queryKey = [PAGE_READS, "call", connector ?? null, tool, args]
    // Read before the call: its queryFn runs only where this call starts the read.
    const last = client.getQueryState(queryKey)
    const settled = last !== undefined && last.dataUpdateCount + last.errorUpdateCount > 0
    const data = await client.fetchQuery({
      queryKey,
      staleTime: PAGE_READ_TTL_MS,
      // Load-bearing: fetchQuery takes the client's retries unless told, and the section above
      // retries already; nested, a failure would wait out both backoffs.
      retry: false,
      networkMode: "always",
      queryFn: async () => {
        const refresh = wasRefreshed(client) || settled
        const options: ToolCallOptions =
          connector === undefined ? { refresh } : { refresh, connector }
        return decodeToolResult<unknown>(await callTool(tool, args, options))
      },
    })
    const at = asOfOf(data)
    if (at !== undefined) onAsOf?.(at)
    return data as T
  }
  return { call, timeZone, now }
}

/**
 * The page's reader without React: the same calls, cache and rules as a section's, for a
 * recorder or a test in Node (`recordToolCalls`, `playRecording`). Without a client it keeps its
 * own (in Node it holds no timer, so nothing keeps the process alive).
 */
export function createPageReader(
  callTool: ToolCaller,
  options: PageReaderOptions = {},
): PageReader {
  return readerOf(
    callTool,
    options.client ?? new QueryClient(),
    options.timeZone ?? getFormatTimeZone(),
    options.now ?? (() => new Date()),
  )
}

/**
 * The page's Refresh: from now on every call asks the server; the reads running now are cancelled,
 * so none joins a call sent without `refresh`; the sections a refusal of a connection closed are
 * reset, so their gate opens; then every read is marked stale, and the sections on screen read
 * again (the others when they mount).
 */
export async function refreshPageReads(client: QueryClient): Promise<void> {
  markRefreshed(client)
  await client.cancelQueries({ queryKey: [PAGE_READS] })
  for (const query of client.getQueryCache().findAll({ queryKey: SECTION_READS })) {
    // A query holds an error only while it failed (a success or a new read without data clears it).
    if (isPageWideRefusal(query.state.error)) query.reset()
  }
  await client.invalidateQueries({ queryKey: [PAGE_READS] })
}
