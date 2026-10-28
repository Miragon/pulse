import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { FIT_LIMITS, solveInlineFit } from "./inline-fit-solve.js"
import { DOM_MEASURE, LIST_SELECTOR, SlotRegistry, type FitMeasure } from "./inline-fit-registry.js"

export {
  CONTINUES_ATTRIBUTE,
  DOM_MEASURE,
  FIT_CONTINUES_ROW,
  type FitMeasure,
} from "./inline-fit-registry.js"

/**
 * The measured inline fit (#396): a card taller than the host budget becomes
 * one scroll box, so inline lists show only the rows that fit, measured on
 * the rendered view.
 * - Runs before first paint, so the host's first size report is fitted.
 * - Within an EPOCH (budget, width, display mode) a cap only shrinks.
 * - After the user's first pointer/key, only a list's own placement refits,
 *   so rows never vanish under the pointer; until then late content (a font swap, a diagram) refits.
 * Outside a host and in fullscreen there is no fit: every row shows.
 */

export const START_ROWS = 10
export const UNSTATED_BUDGET = 600
/** Smaller width changes are scrollbars or rounding, not a new epoch. */
const WIDTH_EPSILON = 8
const RESIZE_DEBOUNCE_MS = 150

interface SlotCaps {
  fitted: number
  revealed: number
}

interface FitState {
  epoch: string
  caps: Readonly<Record<string, SlotCaps>>
}

interface FitApi {
  register: (id: string) => () => void
  setRows: (id: string, element: HTMLElement | null, kind: "rows" | "fallback") => void
  fit: () => void
  reveal: (id: string, rows: number) => void
  reset: (id: string) => void
}

const FitApiContext = createContext<FitApi | null>(null)
const FitCapsContext = createContext<FitState | null>(null)

const capsOf = (state: FitState | null, id: string): SlotCaps =>
  state?.caps[id] ?? { fitted: START_ROWS, revealed: 0 }

function applyCuts(state: FitState, cuts: Record<string, number>): FitState {
  const entries = Object.entries(cuts).filter(([id, rows]) => rows < capsOf(state, id).fitted)
  if (entries.length === 0) return state
  const caps = { ...state.caps }
  for (const [id, rows] of entries) caps[id] = { fitted: rows, revealed: 0 }
  return { ...state, caps }
}

function withRevealed(
  state: FitState,
  id: string,
  revealed: (previous: number) => number,
): FitState {
  const caps = capsOf(state, id)
  const next = revealed(caps.revealed)
  if (next === caps.revealed) return state
  return { ...state, caps: { ...state.caps, [id]: { ...caps, revealed: next } } }
}

/** Rendered in every display mode so the tree never changes with the mode. */
export function InlineFitBox({
  active,
  budget,
  style,
  measure = DOM_MEASURE,
  children,
}: {
  active: boolean
  budget: number
  style?: CSSProperties
  measure?: FitMeasure
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const width = useFrameWidth(active)
  const epoch = `${active}|${budget}|${width}`
  const [state, setState] = useState<FitState>({ epoch, caps: {} })
  if (state.epoch !== epoch) setState({ epoch, caps: {} })

  const [registry] = useState(() => new SlotRegistry())
  const latched = useRef(false)
  /** A parent's ref attaches after its children's effects, so early fits wait here. */
  const pending = useRef(false)
  const current = useRef({ active, budget, measure })
  // Insertion effect: runs before the lists' layout effects, so a refit reads the new budget.
  useInsertionEffect(() => {
    current.current = { active, budget, measure }
  }, [active, budget, measure])

  const fit = useCallback(() => {
    const element = box.current
    if (!element) {
      pending.current = true
      return
    }
    pending.current = false
    const { active: on, budget: limit, measure: m } = current.current
    if (!on) {
      element.removeAttribute("data-inline-fit")
      return
    }
    const { slots, fresh } = registry.measure(element, m)
    // A newly placed list is a new view: late content refits until touched.
    if (fresh) latched.current = false
    const { cuts, fits } = solveInlineFit({ budget: limit, content: m.content(element), slots })
    element.setAttribute("data-inline-fit", fits ? "fits" : "overflow")
    setState((previous) => applyCuts(previous, cuts))
  }, [registry])

  const api = useMemo<FitApi>(
    () => ({
      register: (id) => registry.register(id),
      setRows: (id, element, kind) => registry.setRows(id, element, kind),
      fit,
      reveal(id, rows) {
        registry.setFrozen(id, true)
        setState((previous) => withRevealed(previous, id, (revealed) => revealed + rows))
      },
      reset(id) {
        registry.setFrozen(id, false)
        registry.unplace(id)
        setState((previous) => withRevealed(previous, id, () => 0))
      },
    }),
    [registry, fit],
  )

  useLayoutEffect(() => {
    if (pending.current) fit()
  })

  // Insertion effect so the restart precedes the lists' own fits of the epoch.
  useInsertionEffect(() => {
    latched.current = false
    registry.restart()
  }, [epoch, registry])

  useEffect(() => {
    if (!active) return
    const latch = () => {
      latched.current = true
    }
    window.addEventListener("pointerdown", latch, true)
    window.addEventListener("keydown", latch, true)
    return () => {
      window.removeEventListener("pointerdown", latch, true)
      window.removeEventListener("keydown", latch, true)
    }
  }, [active])

  useEffect(() => {
    const element = box.current
    if (!active || !element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (!latched.current || registry.hasUnplacedVisible(current.current.measure)) fit()
    })
    const observeAll = () => {
      for (const child of Array.from(element.children)) observer.observe(child)
      element.querySelectorAll(LIST_SELECTOR).forEach((rows) => observer.observe(rows))
    }
    observeAll()
    const mutations = new MutationObserver(observeAll)
    mutations.observe(element, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [active, registry, fit])

  return (
    <div ref={box} style={style}>
      <FitApiContext.Provider value={api}>
        <FitCapsContext.Provider value={active ? state : null}>{children}</FitCapsContext.Provider>
      </FitApiContext.Provider>
    </div>
  )
}

function useFrameWidth(active: boolean): number {
  const [width, setWidth] = useState(() =>
    typeof document === "undefined" ? 0 : document.documentElement.clientWidth,
  )
  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const next = document.documentElement.clientWidth
        setWidth((w) => (Math.abs(next - w) >= WIDTH_EPSILON ? next : w))
      }, RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener("resize", onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("resize", onResize)
    }
  }, [active])
  return width
}

export interface InlineRows {
  /** null = every row. */
  cap: number | null
  step: number
  attachRows: (element: HTMLElement | null) => void
  /** Used when no table inside names its body. */
  attachFallback: (element: HTMLElement | null) => void
  reveal: (rows: number) => void
}

export const NO_FIT_ROWS: InlineRows = {
  cap: null,
  step: 0,
  attachRows: () => undefined,
  attachFallback: () => undefined,
  reveal: () => undefined,
}

/** `resetKey` names the search or filter: a new one drops rows revealed in place. */
export function useInlineRows(
  available: number,
  {
    resetKey = "",
    contentKey,
    enabled = true,
  }: {
    resetKey?: string
    contentKey?: unknown
    enabled?: boolean
  } = {},
): InlineRows {
  const api = useContext(FitApiContext)
  const state = useContext(FitCapsContext)
  const id = useId()
  const on = enabled && api !== null && state !== null
  const caps = capsOf(state, id)
  const cap = on ? caps.fitted + caps.revealed : null
  const shown = cap === null ? available : Math.min(cap, available)

  useLayoutEffect(() => {
    if (!api || !enabled) return
    return api.register(id)
  }, [api, id, enabled])

  const fittedKey = useRef(resetKey)
  useLayoutEffect(() => {
    if (fittedKey.current === resetKey) return
    fittedKey.current = resetKey
    if (on) api?.reset(id)
  }, [on, api, id, resetKey])

  const epoch = state?.epoch
  useLayoutEffect(() => {
    if (on) api?.fit()
  }, [on, api, shown, available, resetKey, contentKey, epoch])

  const attachRows = useCallback(
    (element: HTMLElement | null) => api?.setRows(id, element, "rows"),
    [api, id],
  )
  const attachFallback = useCallback(
    (element: HTMLElement | null) => api?.setRows(id, element, "fallback"),
    [api, id],
  )
  const reveal = useCallback((rows: number) => api?.reveal(id, rows), [api, id])

  const step = Math.max(caps.fitted, FIT_LIMITS.softMin)
  return on ? { cap, step, attachRows, attachFallback, reveal } : NO_FIT_ROWS
}
