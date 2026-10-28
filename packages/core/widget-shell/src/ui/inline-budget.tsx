import { createContext, useContext, type ReactNode } from "react"
import type { InlineRows } from "./inline-fit.js"

/** What an INLINE view may show before it offers more (#396); provided by {@link ViewHostBridge}. */
export interface InlineBudget {
  /** null = the canvas's own maximum. */
  diagramMaxHeight: number | null
  expand: (() => void) | null
}

export const NO_INLINE_BUDGET: InlineBudget = { diagramMaxHeight: null, expand: null }

export const INLINE_DIAGRAM_MAX_HEIGHT = 320

const InlineBudgetContext = createContext<InlineBudget>(NO_INLINE_BUDGET)

export function InlineBudgetProvider({
  budget,
  children,
}: {
  budget: InlineBudget
  children: ReactNode
}) {
  return <InlineBudgetContext.Provider value={budget}>{children}</InlineBudgetContext.Provider>
}

export function useInlineBudget(): InlineBudget {
  return useContext(InlineBudgetContext)
}

/** A paged list fits as ONE list: a `ListTable` inside hands its body here instead of capping twice. */
const RowsBudgetedContext = createContext<InlineRows | null>(null)

export function RowsBudgeted({ rows, children }: { rows: InlineRows; children: ReactNode }) {
  return <RowsBudgetedContext.Provider value={rows}>{children}</RowsBudgetedContext.Provider>
}

export function useRowsBudgeted(): InlineRows | null {
  return useContext(RowsBudgetedContext)
}
