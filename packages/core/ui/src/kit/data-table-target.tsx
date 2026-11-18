import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react"
import { cn } from "../lib/utils.js"
import type { DataTableRowProps } from "./data-table-types.js"

/**
 * A row a pointer or the keyboard opens: the hand, and the focus indicator as an outline drawn
 * inside the row (`--focus-width`, 3 px under high contrast), since a ring's shadow does not paint
 * on a table row and an outset one would be cut by the scroll region.
 */
export const INTERACTIVE_ROW =
  "cursor-pointer outline-none focus-visible:outline-(length:--focus-width) focus-visible:outline-solid focus-visible:outline-focus focus-visible:-outline-offset-(--focus-width)"

/** Marks a composed row that opens, so its body can give the target rows one tab stop. */
export const TARGET_ATTRIBUTE = "data-row-target"

/**
 * Controls inside a row handle their own click and keys; the row does not act on them too. A
 * disclosure (a cut message's `details`) opens and closes itself, and what it shows is read.
 */
const CONTROL =
  "a, button, input, select, textarea, label, summary, details, [role=button], [role=menuitem], [role=checkbox], [role=separator]"

function fromControl(event: { target: EventTarget; currentTarget: Element }): boolean {
  const control = (event.target as Element).closest?.(CONTROL)
  return !!control && control !== event.currentTarget && event.currentTarget.contains(control)
}

/**
 * Whether the reader selected text in the row: a click that ends the selection selects and opens
 * nothing, and Ctrl or Cmd with C copies the selection, the browser's own copy, not the row's.
 */
function holdsSelection(row: Element): boolean {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.toString() === "") return false
  const inRow = (node: Node | null) => !!node && row.contains(node)
  return inRow(selection.anchorNode) || inRow(selection.focusNode)
}

/** Whether a click on a row opens it: not on a control in it, not at the end of a selection. */
export function opensOnClick(event: MouseEvent<HTMLTableRowElement>): boolean {
  return !fromControl(event) && !holdsSelection(event.currentTarget)
}

export const wantsSide = (event: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  event.ctrlKey || event.metaKey

/**
 * Ctrl or Cmd with C on a row that copies: the row's own copy, unless the reader selected text in
 * it, which the browser then copies.
 */
export const copiesRow = (event: KeyboardEvent<HTMLTableRowElement>): boolean =>
  wantsSide(event) && event.key.toLowerCase() === "c" && !holdsSelection(event.currentTarget)

export const MOVES: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_index, last) => last,
}

/**
 * The ids of the words a screen reader hears after a target row's name: Enter opens it, or opens
 * it and Ctrl or Cmd with C copies it. The table provides them; a row outside a table has none.
 */
export type RowHints = (copies: boolean) => string

export const RowHintsContext = createContext<RowHints | null>(null)

/**
 * A composed row as a target (`DataTableRowProps`). Inside a `DataTable`'s composed body the body
 * keeps its tab stop; outside one it is a tab stop of its own.
 */
export function DataTableRow({
  label,
  onActivate,
  onCopy,
  className,
  children,
}: DataTableRowProps) {
  const hints = useContext(RowHintsContext)
  if (onActivate === undefined) return <tr className={className}>{children}</tr>
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter") {
      onActivate({ toSide: wantsSide(event) })
    } else if (onCopy && copiesRow(event)) {
      event.preventDefault()
      onCopy()
    }
  }
  return (
    <tr
      {...{ [TARGET_ATTRIBUTE]: "" }}
      aria-label={label}
      aria-describedby={hints?.(onCopy !== undefined)}
      tabIndex={hints ? undefined : 0}
      className={cn(INTERACTIVE_ROW, className)}
      onClick={(event) => {
        if (opensOnClick(event)) onActivate({ toSide: wantsSide(event) })
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </tr>
  )
}

const rowsOf = (body: HTMLTableSectionElement) =>
  Array.from(body.querySelectorAll<HTMLElement>(":scope > tr"))

const targetsOf = (body: HTMLTableSectionElement) =>
  rowsOf(body).filter((row) => row.hasAttribute(TARGET_ATTRIBUTE))

/** The direct target row an event of the body comes from, if any. */
function targetOf(event: { target: EventTarget; currentTarget: HTMLTableSectionElement }) {
  const row = event.target as HTMLElement
  return row.parentElement === event.currentTarget && row.hasAttribute(TARGET_ATTRIBUTE)
    ? row
    : null
}

/**
 * One tab stop for a composed body's target rows: the one focused last while it is there, else the
 * first. `sync` sets it again whenever rows come and go (the body observes them), and tells the
 * table whether the body has any target row, so the region drops its own tab stop.
 */
export function useTargetRows(onTargets: (some: boolean) => void) {
  const active = useRef<HTMLElement | null>(null)
  const managed = useRef(new WeakSet<HTMLElement>())
  const sync = useCallback(
    (body: HTMLTableSectionElement) => {
      const targets = targetsOf(body)
      if (!active.current || !targets.includes(active.current)) active.current = targets[0] ?? null
      for (const row of rowsOf(body)) {
        if (targets.includes(row)) {
          row.tabIndex = row === active.current ? 0 : -1
          managed.current.add(row)
        } else if (managed.current.has(row)) {
          row.removeAttribute("tabindex")
          managed.current.delete(row)
        }
      }
      onTargets(targets.length > 0)
    },
    [onTargets],
  )
  const onFocus = (event: FocusEvent<HTMLTableSectionElement>) => {
    const row = targetOf(event)
    if (!row) return
    active.current = row
    sync(event.currentTarget)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const row = targetOf(event)
    const move = MOVES[event.key]
    if (!row || !move) return
    event.preventDefault()
    const targets = targetsOf(event.currentTarget)
    targets[move(targets.indexOf(row), targets.length - 1)]?.focus()
  }
  return { sync, onFocus, onKeyDown }
}
