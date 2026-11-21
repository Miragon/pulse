import { useMemo } from "react"
import { useFleetSums, type EngineRowData } from "@miragon/pulse-blocks"
import type { FleetSumsData } from "@miragon/pulse-screens"
import { describeError, isSessionEnded, useToolQueries } from "@miragon/pulse-widget-shell/widgets"
import { refusalOf, useEngineList, type ListedEngines } from "../../engine-list.js"
import {
  ENGINE_SCREEN_FEED,
  engineScreenKey,
  type EngineScreenFeed,
} from "../engine/engine-feed.js"
import { READ_AGAIN_AFTER_MS } from "../read-on-return.js"

/**
 * How a read runs again: `cancelRefetch: false` joins a read that runs (the reader's return, whose
 * two events read once), TanStack's default starts it over (the Refresh).
 */
type Refetch = (options?: { cancelRefetch: boolean }) => Promise<unknown>

/** One engine's read on the start page: what its engine screen gave, or why it gave nothing. */
export interface EngineRead {
  readonly engine: string
  readonly screen: EngineScreenFeed | undefined
  readonly error: Error | null
  readonly pending: boolean
  readonly fetching: boolean
  /** When its last read answered or failed, 0 before one (a refused profile's never). */
  readonly readAt: number
  readonly refetch: Refetch
}

/**
 * The engine a server of one engine and no board shows in the start page's place (as the cockpit's
 * landing gave way to it): the only engine or refused profile, where the list names no board and
 * no board file; else none.
 */
export function onlyEngineOf(list: ListedEngines): string | undefined {
  const engines = [...(list.engines ?? []), ...(list.refused ?? [])]
  const boards = (list.boards?.length ?? 0) + (list.refusedBoards?.length ?? 0)
  const [only] = engines
  return engines.length === 1 && boards === 0 ? only?.id : undefined
}

/** What the start page uses of an engine screen's read: TanStack's query result. */
interface ScreenQuery {
  readonly data: EngineScreenFeed | undefined
  readonly error: Error | null
  readonly failureReason: Error | null
  readonly isPending: boolean
  readonly isFetching: boolean
  readonly dataUpdatedAt: number
  readonly errorUpdatedAt: number
  readonly refetch: Refetch
}

/**
 * One engine's read from its query, pending while its query has not started: its failure from its
 * first failed attempt on, as the query client retries quietly behind it, so a down engine says so
 * at once.
 */
export function readOf(engine: string, query: ScreenQuery | undefined): EngineRead {
  if (query === undefined) {
    return {
      engine,
      screen: undefined,
      error: null,
      pending: true,
      fetching: false,
      readAt: 0,
      refetch: () => Promise.resolve(),
    }
  }
  return {
    engine,
    screen: query.data,
    error: query.error ?? query.failureReason,
    pending: query.isPending,
    fetching: query.isFetching,
    readAt: Math.max(query.dataUpdatedAt, query.errorUpdatedAt),
    refetch: (options) => query.refetch(options),
  }
}

/** A refused profile's read: nothing read, the server's refusal from the list's reason. */
function refusedRead(engine: string, reason: string | undefined): EngineRead {
  return {
    engine,
    screen: undefined,
    error: refusalOf(engine, reason),
    pending: false,
    fetching: false,
    readAt: 0,
    refetch: () => Promise.resolve(),
  }
}

/**
 * An engine's row of the engine table: its sums once read, else where its read stands; a page's
 * ended session a quiet row that read nothing, no failure of the engine's (the frame's notice says
 * it once).
 */
function rowOf(read: EngineRead, sums: FleetSumsData): EngineRowData {
  const summed = sums.engines.find(({ engine }) => engine === read.engine)
  if (summed !== undefined) return { engine: read.engine, state: "read", sums: summed }
  if (read.error === null) return { engine: read.engine, state: "loading" }
  if (isSessionEnded(read.error)) return { engine: read.engine, state: "unread" }
  const refused = describeError(read.error, undefined).kind === "profileRefused"
  return { engine: read.engine, state: refused ? "refused" : "failed" }
}

/**
 * The start page's reads: the frame's one read of the engine list, then each engine's engine screen
 * (`engine_screen_processes_data`, the engine screen's own read and cache key, so the start page
 * and an engine's screen show one read), one call per engine, all at once, each engine's failure
 * its own; a refused profile read nothing of, its refusal the list's reason in the server's words
 * (after the engines). The screens read sum in the browser (the blocks' `useFleetSums` over the
 * screens' `FleetSums`: counts only, never a rate). Nothing is read where the server has one engine
 * and no board, which the page shows in the start page's place (`only`).
 */
export function useStartReads() {
  const list = useEngineList()
  const only = list.data === undefined ? undefined : onlyEngineOf(list.data)
  const listed = only === undefined ? list.data : undefined
  const ids = useMemo(() => (listed?.engines ?? []).map(({ id }) => id), [listed])
  const queries = useToolQueries<EngineScreenFeed>(
    ids.map((engine) => ({
      key: engineScreenKey(engine),
      tool: ENGINE_SCREEN_FEED,
      args: { engine },
    })),
    { staleTime: READ_AGAIN_AFTER_MS },
  )
  const reads: EngineRead[] = [
    ...ids.map((engine, index) => readOf(engine, queries[index])),
    ...(listed?.refused ?? []).map(({ id, reason }) => refusedRead(id, reason)),
  ]
  const screens = reads.flatMap(({ screen }) => (screen === undefined ? [] : [screen]))
  const sums = useFleetSums(screens)
  return { list, only, reads, sums, rows: reads.map((read) => rowOf(read, sums)) }
}
