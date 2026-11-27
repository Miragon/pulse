import { useEffect, useMemo, useRef } from "react"
import {
  useFleetSums,
  type EngineRowData,
  type EngineVerdict,
  type OutsideAnyProcessData,
} from "@miragon/pulse-blocks"
import type { FleetSumsData } from "@miragon/pulse-screens"
import {
  describeError,
  isSessionEnded,
  type QueryClient,
  useQueryClient,
  useToolQueries,
} from "@miragon/pulse-widget-shell/widgets"
import { refusalOf, useEngineList, type ListedEngines } from "../../engine-list.js"
import {
  ENGINE_SCREEN_FEED,
  engineScreenKey,
  type EngineScreenFeed,
} from "../engine/engine-feed.js"
import {
  ENGINE_VERDICT_FEED,
  engineVerdictKey,
  type EngineVerdictFeed,
  hasVerdict,
  outsideOf,
  verdictOf,
} from "../engine/verdict-feed.js"
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
  /**
   * Its live state (the verdict the server decided for a Camunda 7 engine, read apart, a failed
   * read of it, none for an engine of another dialect or a refused profile).
   */
  readonly verdict: EngineVerdict
  /** The root incidents outside any process its verdict judged, where it shows one. */
  readonly outside?: OutsideAnyProcessData
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
  /** Its next attempt waits: TanStack pauses a retry while the tab is hidden. */
  readonly isPaused: boolean
  readonly dataUpdatedAt: number
  readonly errorUpdatedAt: number
  readonly refetch: Refetch
}

/** What an engine's state takes of its verdict's read (`verdictOf`). */
type VerdictState = NonNullable<Parameters<typeof verdictOf>[0]>

/** What the start page uses of a verdict's read: TanStack's query result. */
type VerdictQuery = VerdictState & {
  readonly isFetching: boolean
  readonly dataUpdatedAt: number
  readonly errorUpdatedAt: number
  readonly refetch: Refetch
}

/** What a verdict's read gives an engine's read: its state, and what it judged outside any process. */
type Judged = Pick<EngineRead, "verdict" | "outside">

/** The verdict's part of an engine's read, from its query where the server decides one. */
function verdictPartOf(judged: { readonly query: VerdictState | undefined } | undefined): Judged {
  const outside = outsideOf(judged?.query, judged !== undefined)
  return {
    verdict: verdictOf(judged?.query, judged !== undefined),
    ...(outside === undefined ? {} : { outside }),
  }
}

/**
 * One engine's read from its query, pending while its query has not started: its failure from its
 * first failed attempt on, as the query client retries quietly behind it, so a down engine says so
 * at once; beside it the engine's verdict where the server decides one (`judged`: its query, none
 * before the engine's screen answered, which reads again after each new answer of the engine's)
 * and the root incidents outside any process that verdict judged.
 */
export function readOf(
  engine: string,
  query: ScreenQuery | undefined,
  judged?: { readonly query: VerdictState | undefined },
): EngineRead {
  const state = verdictPartOf(judged)
  if (query === undefined) {
    return {
      engine,
      screen: undefined,
      error: null,
      pending: true,
      fetching: false,
      readAt: 0,
      refetch: () => Promise.resolve(),
      ...state,
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
    ...state,
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
    verdict: "none",
  }
}

/**
 * An engine's row of the engine table: its sums once read, with its verdict and what that judged
 * outside any process (the column then names its incidents in processes), else where its read
 * stands; a page's ended session a quiet row that read nothing, no failure of the engine's (the
 * frame's notice says it once).
 */
function rowOf(read: EngineRead, sums: FleetSumsData): EngineRowData {
  const summed = sums.engines.find(({ engine }) => engine === read.engine)
  if (summed !== undefined) {
    return {
      engine: read.engine,
      state: "read",
      sums: summed,
      verdict: read.verdict,
      outside: read.outside,
    }
  }
  if (read.error === null) return { engine: read.engine, state: "loading" }
  if (isSessionEnded(read.error)) return { engine: read.engine, state: "unread" }
  const refused = describeError(read.error, undefined).kind === "profileRefused"
  return { engine: read.engine, state: refused ? "refused" : "failed" }
}

/** An engine's verdict in the page's cache: what its last read left, and whether one reads now. */
type LastVerdict = VerdictState & { readonly reading: boolean }

/**
 * An engine's verdict as its last read left it in the page's cache (the engine screen's bar shares
 * it), none before one: what the start page shows of a verdict it does not read now.
 */
function lastVerdictOf(client: QueryClient, engine: string): LastVerdict | undefined {
  const key = [...engineVerdictKey(engine), { engine }]
  const state = client.getQueryState<EngineVerdictFeed, Error>(key)
  return (
    state && {
      data: state.data,
      error: state.error,
      failureReason: state.fetchFailureReason,
      reading: state.fetchStatus !== "idle",
    }
  )
}

/** Whether an engine's screen reads: an attempt under way, or its retry paused in a hidden tab. */
const screenReads = (screen: ScreenQuery): boolean => screen.isFetching || screen.isPaused

/**
 * Whether the start page reads an engine's verdict: once its screen answered, and where the verdict
 * has no answer yet (none read, or a failed read) only while its read is under way or the screen
 * neither reads nor failed, since such a verdict reads at once when it is read, never starting
 * beside the screen nor after its failure; one under way stays read, so its answer shows at once.
 */
const judges = (screen: ScreenQuery, last: LastVerdict | undefined): boolean =>
  screen.data !== undefined &&
  (last?.data !== undefined ||
    last?.reading === true ||
    (!screenReads(screen) && screen.error === null))

/**
 * Where each engine's verdict stands to its screen's reads, per engine: the screen's answer before
 * a read its verdict's read went on beside, and the screen's answer its verdict counts for.
 */
interface Following {
  readonly beside: Map<string, number>
  readonly counted: Map<string, number>
}

/**
 * Whether an engine's verdict reads again after a render: once its screen's read is over and
 * answered after the verdict's last read, unless the verdict's read went on beside that read,
 * which counts for its answer (a failed read leaves the screen's answer as it was); never while
 * the screen reads nor while the verdict does.
 */
function readsAgain(
  following: Following,
  engine: string,
  screen: ScreenQuery,
  verdict: VerdictQuery | undefined,
): boolean {
  const { beside, counted } = following
  if (screenReads(screen)) {
    if (verdict?.isFetching === true) beside.set(engine, screen.dataUpdatedAt)
    return false
  }
  const before = beside.get(engine)
  beside.delete(engine)
  if (before !== undefined && before !== screen.dataUpdatedAt) {
    counted.set(engine, screen.dataUpdatedAt)
  }
  return (
    verdict?.isFetching === false &&
    Math.max(verdict.dataUpdatedAt, verdict.errorUpdatedAt) < screen.dataUpdatedAt &&
    counted.get(engine) !== screen.dataUpdatedAt
  )
}

/**
 * Reads each verdict again once its engine's screen answered after the verdict's last read (the
 * Refresh, the reader's return, the page shown again after 60 s: each reads the screens alone), so
 * a verdict follows its engine's figures, never starting while they read nor after a failed read;
 * a verdict that still reads is joined, never started over. A verdict whose read was under way, its
 * retries included, when its screen read again goes on beside that read and counts for its answer,
 * which reads it no second time.
 */
function useVerdictsAfterScreens(
  pairs: readonly (readonly [string, ScreenQuery, VerdictQuery | undefined])[],
): void {
  const following = useRef<Following>({ beside: new Map(), counted: new Map() }).current
  // After each render: a verdict read again is fetching at the next, so it is asked once.
  useEffect(() => {
    for (const [engine, screen, verdict] of pairs) {
      if (readsAgain(following, engine, screen, verdict)) {
        void verdict?.refetch({ cancelRefetch: false })
      }
    }
  })
}

/**
 * The start page's reads: the frame's one read of the engine list, then each engine's engine screen
 * (`engine_screen_processes_data`, the engine screen's own read and cache key, so the start page
 * and an engine's screen show one read), one call per engine, all at once, each engine's failure
 * its own (the page sends one call per engine at a time, `engineLanes`), and once it answered
 * each Camunda 7 engine's verdict (`engine_screen_verdict_data`, the engine screen's bar's read and
 * cache key), its failure its own too, read again after each new answer of the engine's screen
 * alone: never started while the screen reads, so an engine that hangs holds one of the browser's
 * connections (two only while a verdict reads, its retries included, when its screen is read again,
 * or when the reader moves to the search while a verdict reads), and never after a failed read of
 * it, so the verdict asks the engine no second statistics (the server reads it from the screen's list of processes, which
 * stands on its floor whatever else the screen read). A refused profile is read nothing of, its
 * refusal the list's reason in the server's words (after the engines). The screens read sum in the
 * browser (the blocks' `useFleetSums` over the screens' `FleetSums`: counts only, never a rate).
 * Nothing is read where the server has one engine and no board, which the page shows in the start
 * page's place (`only`).
 */
export function useStartReads() {
  const list = useEngineList()
  const only = list.data === undefined ? undefined : onlyEngineOf(list.data)
  const listed = only === undefined ? list.data : undefined
  const ids = useMemo(() => (listed?.engines ?? []).map(({ id }) => id), [listed])
  const judged = useMemo(
    () => (listed?.engines ?? []).filter(({ dialect }) => hasVerdict(dialect)).map(({ id }) => id),
    [listed],
  )
  const queries = useToolQueries<EngineScreenFeed>(
    ids.map((engine) => ({
      key: engineScreenKey(engine),
      tool: ENGINE_SCREEN_FEED,
      args: { engine },
    })),
    { staleTime: READ_AGAIN_AFTER_MS },
  )
  const screenOf = (engine: string) => queries[ids.indexOf(engine)]
  const client = useQueryClient()
  // The engines whose verdict the page reads now, each with its screen's read.
  const judging = judged.flatMap((engine) => {
    const screen = screenOf(engine)
    return screen !== undefined && judges(screen, lastVerdictOf(client, engine))
      ? [{ engine, screen }]
      : []
  })
  // Once it answered, a verdict reads again only after its engine's screen answered anew.
  const verdicts = useToolQueries<EngineVerdictFeed>(
    judging.map(({ engine }) => ({
      key: engineVerdictKey(engine),
      tool: ENGINE_VERDICT_FEED,
      args: { engine },
    })),
    { staleTime: Infinity },
  )
  useVerdictsAfterScreens(
    judging.map(({ engine, screen }, index) => [engine, screen, verdicts[index]]),
  )
  const judgedOf = (engine: string) => {
    if (!judged.includes(engine)) return undefined
    const index = judging.findIndex((entry) => entry.engine === engine)
    return { query: index < 0 ? lastVerdictOf(client, engine) : verdicts[index] }
  }
  const reads: EngineRead[] = [
    ...ids.map((engine, index) => readOf(engine, queries[index], judgedOf(engine))),
    ...(listed?.refused ?? []).map(({ id, reason }) => refusedRead(id, reason)),
  ]
  const screens = reads.flatMap(({ screen }) => (screen === undefined ? [] : [screen]))
  const sums = useFleetSums(screens)
  return { list, only, reads, sums, rows: reads.map((read) => rowOf(read, sums)) }
}
