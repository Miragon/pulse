import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react"
import { cn } from "../lib/utils.js"
import type { DataTableColumn, DataTableProps, DataTableSelection } from "./data-table-types.js"
import { Td } from "./table.js"

/**
 * A row a pointer or the keyboard opens: the hand, and the focus indicator as an outline drawn
 * inside the row (`--focus-width`, 3 px under high contrast), since a ring's shadow does not paint
 * on a table row and an outset one would be cut by the scroll region.
 */
const INTERACTIVE_ROW =
  "cursor-pointer outline-none focus-visible:outline-(length:--focus-width) focus-visible:outline-solid focus-visible:outline-focus focus-visible:-outline-offset-(--focus-width)"

/** Every body row fills on hover from `--accent` (the guide's hover), drawn or composed by hand. */
const ROW_HOVER = "[&>tr:hover]:bg-accent"

/**
 * A cell of a column that fits its content (`rows`, not sized): as narrow as its one line allows,
 * a `NamedId` in it whole. The column that takes the rest has none of it, so a `NamedId` there
 * gives way down to its floor where the region is short of room.
 */
export const FITTED_CELL = "w-[1%] [--named-id-floor:max-content]"

/** Marks a hand-composed row's cell of a column that fits its content (`fit`). */
const FIT_ATTRIBUTE = "data-fit"

/**
 * A marked cell of hand-composed rows, as a drawn row's fitted cell: one line, a `NamedId` in it
 * whole. The head's `FITTED_CELL` makes the column as narrow as that line.
 */
const COMPOSED_FIT =
  "[&>tr>[data-fit]]:whitespace-nowrap [&>tr>[data-fit]]:[--named-id-floor:max-content]"

/** The selection column: 32 px, the box at the cell's start. */
export const SELECTION_WIDTH = 32
export const SELECTION_CELL = "w-8 pl-cell pr-0"

/** Controls inside a row handle their own click and keys; the row does not act on them too. */
const CONTROL = "a, button, input, select, textarea, label, [role=checkbox], [role=separator]"

function fromControl(event: { target: EventTarget; currentTarget: Element }): boolean {
  const control = (event.target as Element).closest?.(CONTROL)
  return !!control && control !== event.currentTarget && event.currentTarget.contains(control)
}

const wantsSide = (event: { ctrlKey: boolean; metaKey: boolean }) => event.ctrlKey || event.metaKey

const MOVES: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_index, last) => last,
}

type RowsProps<Row> = Pick<
  DataTableProps<Row>,
  "onActivate" | "onCopy" | "selection" | "bodyRef"
> & {
  columns: ReadonlyArray<DataTableColumn<Row>>
  rows: ReadonlyArray<Row>
  rowKey: (row: Row) => string
  /** Whether a column fits its content (not the one that takes the rest, not a sized table). */
  fitted: (key: string) => boolean
}

/** One tab stop for the rows: the one focused last (by key, so a live update keeps it). */
function useRowKeys<Row>({ rows, rowKey, onActivate, onCopy, selection }: RowsProps<Row>) {
  const [activeKey, setActiveKey] = useState<string>()
  const found = rows.findIndex((row) => rowKey(row) === activeKey)
  const active = found === -1 ? 0 : found
  const setActive = (index: number) => {
    const row = rows[index]
    setActiveKey(row === undefined ? undefined : rowKey(row))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: Row, index: number) => {
    if (event.target !== event.currentTarget) return
    const move = MOVES[event.key]
    if (move) {
      event.preventDefault()
      const next = move(index, rows.length - 1)
      setActive(next)
      event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(":scope > tr")[next]?.focus()
    } else if (event.key === "Enter") {
      onActivate?.(row, { toSide: wantsSide(event) })
    } else if (event.key === " " && selection && (selection.isSelectable?.(row) ?? true)) {
      event.preventDefault()
      selection.onToggle(row)
    } else if (onCopy && wantsSide(event) && event.key.toLowerCase() === "c") {
      event.preventDefault()
      onCopy(row)
    }
  }
  return { active, setActive, onKeyDown }
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value)
  else if (ref) (ref as { current: T | null }).current = value
}

/**
 * Focus stays on the row at the same place when the rows change under it (a live update), as long
 * as the window has focus and nothing outside the body took it meanwhile. `attach` is the body's
 * ref, handed on to the caller's `bodyRef` too.
 */
function useFocusKeptInBody(
  rows: ReadonlyArray<unknown>,
  bodyRef: Ref<HTMLTableSectionElement> | undefined,
) {
  const body = useRef<HTMLTableSectionElement | null>(null)
  const focusedIndex = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const forget = () => {
      focusedIndex.current = undefined
    }
    const forgetOutside = (event: Event) => {
      if (!(event.target instanceof Node && body.current?.contains(event.target))) forget()
    }
    document.addEventListener("focusin", forgetOutside)
    document.addEventListener("pointerdown", forgetOutside, true)
    window.addEventListener("blur", forget)
    return () => {
      document.removeEventListener("focusin", forgetOutside)
      document.removeEventListener("pointerdown", forgetOutside, true)
      window.removeEventListener("blur", forget)
    }
  }, [])
  useLayoutEffect(() => {
    const element = body.current
    const index = focusedIndex.current
    if (!element || index === undefined || !document.hasFocus()) return
    if (element.contains(document.activeElement)) return
    const rows = element.querySelectorAll<HTMLElement>(":scope > tr")
    const next = rows[Math.min(index, rows.length - 1)]
    if (next) next.focus()
    else focusedIndex.current = undefined
  }, [rows])
  const attach = useCallback(
    (element: HTMLTableSectionElement | null) => {
      body.current = element
      setRef(bodyRef, element)
    },
    [bodyRef],
  )
  const focused = useCallback((index: number) => {
    focusedIndex.current = index
  }, [])
  return { attach, focused }
}

function SelectionCell<Row>({
  row,
  selection,
  inRowFocus,
}: {
  row: Row
  selection: DataTableSelection<Row>
  inRowFocus: boolean
}) {
  const selectable = selection.isSelectable?.(row) ?? true
  return (
    <Td className={SELECTION_CELL}>
      {selectable && (
        <selection.Box
          aria-label={selection.rowLabel(row)}
          checked={selection.isSelected(row)}
          onCheckedChange={() => selection.onToggle(row)}
          // In a row that takes focus itself, Space on the row toggles: one tab stop per row.
          tabIndex={inRowFocus ? -1 : undefined}
          className="align-middle"
        />
      )}
    </Td>
  )
}

/** The table's `rows`, one line each, drawn by the columns' cells. */
export function RowsBody<Row>(props: RowsProps<Row>) {
  const { columns, rows, rowKey, onActivate, selection, bodyRef, fitted } = props
  const keys = useRowKeys(props)
  const { attach, focused } = useFocusKeptInBody(rows, bodyRef)
  const interactive = onActivate !== undefined
  const activate = (event: MouseEvent<HTMLTableRowElement>, row: Row) => {
    if (fromControl(event)) return
    onActivate?.(row, { toSide: wantsSide(event) })
  }
  return (
    <tbody ref={attach} className={ROW_HOVER}>
      {rows.map((row, index) => (
        <tr
          key={rowKey(row)}
          data-selected={selection?.isSelected(row) || undefined}
          tabIndex={interactive ? (index === keys.active ? 0 : -1) : undefined}
          className={cn("data-selected:bg-accent", interactive && INTERACTIVE_ROW)}
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return
            keys.setActive(index)
            focused(index)
          }}
          onKeyDown={(event) => keys.onKeyDown(event, row, index)}
          onClick={interactive ? (event) => activate(event, row) : undefined}
        >
          {selection && <SelectionCell row={row} selection={selection} inRowFocus={interactive} />}
          {columns.map((column) => (
            <Td
              key={column.key}
              align={column.align}
              className={cn(
                "whitespace-nowrap",
                fitted(column.key) && FITTED_CELL,
                column.cellClassName,
              )}
            >
              {column.cell?.(row)}
            </Td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

/**
 * Marks each cell that stands alone in a fitted column, by its position in its row: column spans
 * counted, row spans not.
 */
function markFitted(body: HTMLTableSectionElement, fitted: ReadonlySet<number>) {
  for (const row of Array.from(body.querySelectorAll<HTMLTableRowElement>(":scope > tr"))) {
    let column = 0
    for (const cell of Array.from(row.cells)) {
      cell.toggleAttribute(FIT_ATTRIBUTE, cell.colSpan === 1 && fitted.has(column))
      column += cell.colSpan
    }
  }
}

/**
 * The table's `children`, rows composed by hand. Their cells take no column's classes, so the
 * cells of a column that fits its content are marked by their position (`fitted`, the columns'
 * indexes), again whenever rows or cells come and go.
 */
export function ComposedBody({
  fitted,
  bodyRef,
  children,
}: {
  fitted: ReadonlyArray<number>
  bodyRef: Ref<HTMLTableSectionElement> | undefined
  children: ReactNode
}) {
  const body = useRef<HTMLTableSectionElement | null>(null)
  const positions = fitted.join(" ")
  useLayoutEffect(() => {
    const element = body.current
    if (!element) return
    const columns = new Set(positions === "" ? [] : positions.split(" ").map(Number))
    const mark = () => markFitted(element, columns)
    mark()
    if (columns.size === 0) return
    const observer = new MutationObserver(mark)
    observer.observe(element, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [positions])
  const attach = useCallback(
    (element: HTMLTableSectionElement | null) => {
      body.current = element
      setRef(bodyRef, element)
    },
    [bodyRef],
  )
  return (
    <tbody ref={attach} className={cn(ROW_HOVER, COMPOSED_FIT)}>
      {children}
    </tbody>
  )
}

/** Placeholder rows while the table loads: one 8 px bar per cell, hidden from assistive tech. */
export function SkeletonBody({ columns, count }: { columns: number; count: number }) {
  return (
    <tbody aria-hidden="true" data-slot="data-table-skeleton">
      {Array.from({ length: count }, (_row, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }, (_cell, cellIndex) => (
            <Td key={cellIndex} className="w-1/4 border-transparent">
              <span
                className={cn(
                  "bg-accent block h-2 rounded-full",
                  cellIndex === 0 ? "w-2/5" : "w-3/5",
                )}
              />
            </Td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}
