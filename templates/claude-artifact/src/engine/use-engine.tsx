import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type DependencyList,
  type ReactNode,
} from "react"
import { useLocale, type SectionStateValue } from "@miragon/pulse-ui"
import {
  asEngineError,
  type Connector,
  type EngineError,
  type EngineErrorCode,
} from "./connector.ts"
import { createEngine, type Engine, type EngineOptions } from "./engine.ts"
import { describeEngineError } from "./errors.ts"

/**
 * The runtime's refusals of the viewer's connector as a whole (no sign-in, no connector, no
 * approval): no read of the page passes then, so whichever read meets one closes the page's gate.
 */
const PAGE_WIDE: ReadonlySet<EngineErrorCode> = new Set([
  "needs_reauth",
  "not_connected",
  "approval_required",
])

/**
 * The page's gate, which every section reads behind: open, or refused once a read meets a refusal
 * of the connector itself. Every section would fail alike then, so none mounts and the page says
 * it once (`PageGate`).
 */
export type Gate =
  { readonly status: "open" } | { readonly status: "refused"; readonly error: EngineError }

interface EngineContextValue {
  engine: Engine
  gate: Gate
  /**
   * When the numbers on the page were read, the freshness the bar shows: the oldest `asOf` of the
   * answers the sections hold, when the server read them (an answer from its 30 s floor keeps
   * its first read's), so a section whose refresh failed keeps the stamp at its older read; none
   * while no section holds data or the page is refused.
   */
  readAt: Date | undefined
  /** Forgets every kept answer, opens the gate and reads every section again. */
  refresh: () => void
  /** Bumped by every `refresh`: what each section's read depends on besides its own. */
  generation: number
  /** For `useSection`: when a section's data was read, or none to take it back. */
  report: (id: string, at: Date | undefined) => void
  /** For `useSection`: a read met a refusal of the connector itself. */
  refuse: (error: EngineError) => void
}

const EngineContext = createContext<EngineContextValue | null>(null)

export interface EngineProviderProps extends EngineOptions {
  connector: Connector
  children: ReactNode
}

/** The oldest of the sections' reads, none when no section holds data. */
function oldestOf(reads: ReadonlyMap<string, Date>): Date | undefined {
  let oldest: Date | undefined
  for (const at of reads.values()) {
    if (oldest === undefined || at.getTime() < oldest.getTime()) oldest = at
  }
  return oldest
}

/** The page's engine over `connector`, one for the page, its gate, read again on `refresh`. */
export function EngineProvider({ connector, children, ...options }: EngineProviderProps) {
  const { ttlMs, now, clock, engineId, timeZone } = options
  const engine = useMemo(
    () => createEngine(connector, { ttlMs, now, clock, engineId, timeZone }),
    [connector, ttlMs, now, clock, engineId, timeZone],
  )
  const [generation, setGeneration] = useState(0)
  const [gate, setGate] = useState<Gate>({ status: "open" })
  const [reads, setReads] = useState<ReadonlyMap<string, Date>>(() => new Map())

  const refresh = useCallback(() => {
    engine.invalidate()
    setGate((last) => (last.status === "open" ? last : { status: "open" }))
    setGeneration((n) => n + 1)
  }, [engine])
  const report = useCallback((id: string, at: Date | undefined) => {
    setReads((last) => {
      if (at === undefined ? !last.has(id) : last.get(id)?.getTime() === at.getTime()) return last
      const changed = new Map(last)
      if (at === undefined) changed.delete(id)
      else changed.set(id, at)
      return changed
    })
  }, [])
  const refuse = useCallback((error: EngineError) => {
    setGate((last) => (last.status === "refused" ? last : { status: "refused", error }))
  }, [])

  const readAt = gate.status === "refused" ? undefined : oldestOf(reads)
  const value = useMemo(
    () => ({ engine, gate, readAt, refresh, generation, report, refuse }),
    [engine, gate, readAt, refresh, generation, report, refuse],
  )
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}

export function useEngine(): EngineContextValue {
  const value = useContext(EngineContext)
  if (value === null) throw new Error("useEngine needs an EngineProvider above it")
  return value
}

/** A section's read: what pulse-ui's `SectionState` shows, its data and its retry. */
export interface Section<T> {
  /** For `SectionState`: the data kept, the failure in words, whether a read runs. */
  state: SectionStateValue<T>
  /** The last good data: kept when a refresh fails, so the section shows it with the failure. */
  data?: T
  /** The last read's failure, none after a good read. */
  error?: EngineError
  /** When the server read the shown data: its answer's `asOf`. */
  at?: Date
  /** A read runs. */
  loading: boolean
  /** Reads this section again (a failed call is never kept, so it goes to the engine). */
  retry: () => void
}

interface ReadState<T> {
  data?: T
  error?: EngineError
  at?: Date
  loading: boolean
}

/** When the server read an answer: its `asOf`, else the page's clock where it names none. */
function readAtOf(asOf: string | undefined, engine: Engine): Date {
  const at = asOf === undefined ? Number.NaN : Date.parse(asOf)
  return Number.isNaN(at) ? engine.now() : new Date(at)
}

/**
 * One section's read through the page's engine: loading, ready or failed on its own, the last
 * good data kept when a refresh fails, so one failing section never blanks the page. `deps` are
 * what `read` reads besides the engine (the process key); the page's Refresh reads every section
 * again. The section tells the page when its data was read, `asOf` of its data (the answer's,
 * when the server read it, which a refresh inside the server's 30 s floor leaves as it was): the
 * bar's freshness. A refusal of the connector itself refuses the whole page. Sections that fail
 * alike say it once under one `SectionStateGroup`, which compares their failures in words.
 */
export function useSection<T>(
  read: (engine: Engine) => Promise<T>,
  deps: DependencyList,
  asOf: (data: T) => string | undefined,
): Section<T> {
  const { engine, generation, report, refuse } = useEngine()
  const locale = useLocale()
  const id = useId()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ReadState<T>>({ loading: true })
  useEffect(() => {
    let current = true
    setState((last) => (last.loading ? last : { ...last, loading: true }))
    read(engine).then(
      (data) => {
        if (current) setState({ data, at: readAtOf(asOf(data), engine), loading: false })
      },
      (thrown: unknown) => {
        if (!current) return
        const error = asEngineError(thrown)
        if (PAGE_WIDE.has(error.code)) {
          // The page's gate says it, in the same render: the section never shows it as its own.
          refuse(error)
          setState((last) => ({ data: last.data, at: last.at, loading: false }))
          return
        }
        setState((last) => ({ data: last.data, at: last.at, error, loading: false }))
      },
    )
    return () => {
      current = false
    }
    // `read` is a new function at every render; what it reads is in `deps`. A new generation
    // comes with every Refresh of the page.
  }, [engine, generation, attempt, ...deps])
  const retry = useCallback(() => {
    setAttempt((n) => n + 1)
  }, [])
  // Reported before the browser paints, so the bar's stamp moves with the numbers it dates.
  useLayoutEffect(() => {
    report(id, state.at)
  }, [report, id, state.at])
  useLayoutEffect(
    () => () => {
      report(id, undefined)
    },
    [report, id],
  )
  const failure = useMemo(
    () => (state.error === undefined ? undefined : describeEngineError(state.error, locale)),
    [state.error, locale],
  )
  return {
    ...state,
    state: { data: state.data, error: failure, loading: state.loading },
    retry,
  }
}
