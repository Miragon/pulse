import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from "react"
import {
  asEngineError,
  type Connector,
  type EngineError,
  type EngineErrorCode,
} from "./connector.ts"
import { createEngine, type Engine, type EngineOptions } from "./engine.ts"

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
 * The page's gate, which every section reads behind: the engine every call names
 * (`engine_list_engines`), resolved once per load. It fails, or a read meets a refusal of the
 * connector itself, and the page is refused as a whole: every section would fail alike, so none
 * mounts and the page says it once (`PageGate`).
 */
export type Gate =
  | { readonly status: "resolving" }
  | { readonly status: "ready" }
  | { readonly status: "refused"; readonly error: EngineError }

/** What a section tells the page: when its numbers were read, its failure and its retry. */
interface SectionReport {
  /** When the data it shows was read; none while it shows none. */
  readonly at?: Date
  /** Its failure as one key, its code and raw text: identical failures are said once. */
  readonly failure?: string
  /** Reads the section again. */
  readonly retry: () => void
}

interface EngineContextValue {
  engine: Engine
  gate: Gate
  /**
   * When the numbers on the page were read, the freshness the bar shows: the oldest `at` of the
   * sections that hold data, so a section whose refresh failed keeps the stamp at its older read;
   * none while no section holds data or the page is refused.
   */
  readAt: Date | undefined
  /** Forgets every kept answer, resolves the engine again and reads every section again. */
  refresh: () => void
  /** For `useSection`: each section's report, by its place on the page. */
  sections: ReadonlyMap<number, SectionReport>
  /** For `useSection`: a section's place on the page, in the order the sections first render. */
  enrol: () => number
  /** For `useSection`: a section's report, or none to remove it. */
  report: (order: number, report: SectionReport | undefined) => void
  /** For `useSection`: a read met a refusal of the connector itself. */
  refuse: (error: EngineError) => void
}

const EngineContext = createContext<EngineContextValue | null>(null)

export interface EngineProviderProps extends EngineOptions {
  connector: Connector
  children: ReactNode
}

function sameReport(a: SectionReport | undefined, b: SectionReport): boolean {
  return (
    a !== undefined &&
    a.at?.getTime() === b.at?.getTime() &&
    a.failure === b.failure &&
    a.retry === b.retry
  )
}

/** The oldest of the sections' `at`, none when no section holds data. */
function oldestAt(sections: ReadonlyMap<number, SectionReport>): Date | undefined {
  let oldest: Date | undefined
  for (const { at } of sections.values()) {
    if (at !== undefined && (oldest === undefined || at.getTime() < oldest.getTime())) oldest = at
  }
  return oldest
}

/** The page's engine over `connector`, one for the page, its gate, read again on `refresh`. */
export function EngineProvider({ connector, children, ...options }: EngineProviderProps) {
  const { ttlMs, now, clock, engineId } = options
  const engine = useMemo(
    () => createEngine(connector, { ttlMs, now, clock, engineId }),
    [connector, ttlMs, now, clock, engineId],
  )
  const [generation, setGeneration] = useState(0)
  const [gate, setGate] = useState<Gate>({ status: "resolving" })
  const [sections, setSections] = useState<ReadonlyMap<number, SectionReport>>(() => new Map())
  const next = useRef(0)

  useEffect(() => {
    let current = true
    setGate((last) => (last.status === "resolving" ? last : { status: "resolving" }))
    engine.engineId().then(
      () => {
        if (current) setGate({ status: "ready" })
      },
      (error: unknown) => {
        if (current) {
          setGate({ status: "refused", error: asEngineError(error, "engine_list_engines") })
        }
      },
    )
    return () => {
      current = false
    }
  }, [engine, generation])

  const refresh = useCallback(() => {
    engine.invalidate()
    setGeneration((n) => n + 1)
  }, [engine])
  const enrol = useCallback(() => next.current++, [])
  const report = useCallback((order: number, section: SectionReport | undefined) => {
    setSections((last) => {
      if (section === undefined ? !last.has(order) : sameReport(last.get(order), section)) {
        return last
      }
      const changed = new Map(last)
      if (section === undefined) changed.delete(order)
      else changed.set(order, section)
      return changed
    })
  }, [])
  const refuse = useCallback((error: EngineError) => {
    setGate((last) => (last.status === "refused" ? last : { status: "refused", error }))
  }, [])

  const readAt = gate.status === "refused" ? undefined : oldestAt(sections)
  const value = useMemo(
    () => ({ engine, gate, readAt, refresh, sections, enrol, report, refuse }),
    [engine, gate, readAt, refresh, sections, enrol, report, refuse],
  )
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}

export function useEngine(): EngineContextValue {
  const value = useContext(EngineContext)
  if (value === null) throw new Error("useEngine needs an EngineProvider above it")
  return value
}

/** A section's read: its state, its data (kept while a refresh runs or fails) and its retry. */
export interface Section<T> {
  /** `loading` before the first answer, `error` when the last read failed, else `ready`. */
  status: "loading" | "ready" | "error"
  /** The last good data: kept when a refresh fails, so the section shows it with the failure. */
  data?: T
  error?: EngineError
  /** When the shown data was read (the engine's clock). */
  at?: Date
  /** A read runs while older data shows. */
  refreshing: boolean
  /**
   * A section earlier on the page fails alike (the same code and raw text) and says it: this one
   * only says that it was not read, so the page says a failure once.
   */
  repeatsFailure: boolean
  /** Reads this section again (a failed call is never kept, so it goes to the engine). */
  refresh: () => void
  /** Reads again every section that fails alike: the one Try again of a failure said once. */
  retry: () => void
}

interface SectionState<T> {
  status: Section<T>["status"]
  data?: T
  error?: EngineError
  at?: Date
  refreshing: boolean
}

/** A failure as the key identical failures share: its code and its raw text. */
function failureKey(error: EngineError): string {
  return `${error.code}\n${error.detail}`
}

/**
 * One section's read through the page's engine, behind the page's gate: loading, ready or error,
 * the last good data kept when a refresh fails, so one failing section never blanks the page.
 * `deps` are what `read` reads besides the engine (the process key); the page's Refresh reads
 * every section again. The section tells the page when its data was read (the bar's freshness)
 * and how it failed (said once where sections fail alike); a refusal of the connector itself
 * refuses the whole page.
 */
export function useSection<T>(
  read: (engine: Engine) => Promise<T>,
  deps: DependencyList,
): Section<T> {
  const { engine, gate, sections, enrol, report, refuse } = useEngine()
  const [order] = useState(enrol)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<SectionState<T>>({ status: "loading", refreshing: true })
  useEffect(() => {
    if (gate.status !== "ready") {
      // A page not open has no section failures: its gate says what keeps it closed.
      const refreshing = gate.status === "resolving"
      setState((last) =>
        last.error === undefined && last.refreshing === refreshing
          ? last
          : {
              status: last.data === undefined ? "loading" : "ready",
              data: last.data,
              at: last.at,
              refreshing,
            },
      )
      return undefined
    }
    let current = true
    setState((last) => (last.refreshing ? last : { ...last, refreshing: true }))
    read(engine).then(
      (data) => {
        if (current) setState({ status: "ready", data, at: engine.now(), refreshing: false })
      },
      (thrown: unknown) => {
        if (!current) return
        const error = asEngineError(thrown)
        if (PAGE_WIDE.has(error.code)) {
          // The page's gate says it, in the same render: the section never shows it as its own.
          refuse(error)
          setState((last) => ({ ...last, refreshing: false }))
          return
        }
        setState((last) => ({
          status: "error",
          data: last.data,
          at: last.at,
          error,
          refreshing: false,
        }))
      },
    )
    return () => {
      current = false
    }
    // `read` is a new function at every render; what it reads is in `deps`. A new gate comes
    // with every Refresh of the page.
  }, [engine, gate, attempt, ...deps])
  const refresh = useCallback(() => {
    setAttempt((n) => n + 1)
  }, [])
  const failure = state.error === undefined ? undefined : failureKey(state.error)
  // Reported before the browser paints, so sections that fail alike never show their failure
  // twice for a frame, and the bar's stamp moves with the numbers it dates.
  useLayoutEffect(() => {
    report(order, { at: state.at, failure, retry: refresh })
  }, [report, order, state.at, failure, refresh])
  useLayoutEffect(
    () => () => {
      report(order, undefined)
    },
    [report, order],
  )
  const alike = useMemo(
    () =>
      failure === undefined
        ? []
        : [...sections].filter(
            ([other, section]) => other !== order && section.failure === failure,
          ),
    [sections, order, failure],
  )
  const retry = useCallback(() => {
    refresh()
    for (const [, section] of alike) section.retry()
  }, [refresh, alike])
  const repeatsFailure = alike.some(([other]) => other < order)
  return { ...state, repeatsFailure, refresh, retry }
}
