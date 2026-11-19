import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import { MoveHorizontal } from "lucide-react"
import { useUiMessages } from "../locale/locale-provider.js"
import { cn } from "../lib/utils.js"
import { Button } from "../primitives/button.js"
import { usePortalContainer } from "../theme/portal-container.js"
import { cellWidth, type ColumnSizer } from "./column-measure.js"
import { Icon } from "./icon.js"
import { MENU_ITEM } from "./menu-item.js"

/** Wider and Narrower size by 32 px, the grip's Shift step. */
const MENU_STEP = 32
const GAP = 4

interface Placement {
  top: number
  left: number
}

/** Below the button, or over it where an inline frame has no room below; never off the side. */
function placeMenu(button: DOMRect, panel: { width: number; height: number }): Placement {
  const below = button.bottom + GAP
  const top =
    below + panel.height <= window.innerHeight
      ? below
      : Math.max(GAP, button.top - GAP - panel.height)
  const left = Math.max(GAP, Math.min(button.left, window.innerWidth - panel.width - GAP))
  return { top, left }
}

const MOVES: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => (index >= last ? 0 : index + 1),
  ArrowUp: (index, last) => (index <= 0 ? last : index - 1),
  Home: () => 0,
  End: (_index, last) => last,
}

/** Closes on Escape (focus back on the button), an outside press, a scroll or a resize. */
function useDismiss(
  open: boolean,
  close: (refocus: boolean) => void,
  inside: (node: Node) => boolean,
) {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target as Node)) close(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true)
    }
    const onMove = () => close(false)
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("scroll", onMove, true)
    window.addEventListener("resize", onMove)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("scroll", onMove, true)
      window.removeEventListener("resize", onMove)
    }
  }, [open, close, inside])
}

/**
 * A column's menu (CI §8 menu button), the single-pointer way to size it (WCAG 2.5.7): Fit to
 * content, Wider, Narrower and Reset all widths. A 24 px button in the head, shown while the
 * pointer is over the head or focus is in it (always on a touch screen), named after the column.
 * The arrows, Home and End move through the entries, Escape closes it with focus back on the
 * button, Tab, an outside press, a scroll or a resize close it. Portaled and placed `fixed`, so no
 * scroll region or pinned cell cuts it.
 */
export function ColumnMenu({
  column,
  columnKey,
  sizer,
}: {
  column: string
  columnKey: string
  sizer: ColumnSizer
}) {
  const { dataTable } = useUiMessages()
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const panelId = useId()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const portal = usePortalContainer()
  const label = dataTable.columnMenu({ column })

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }, [])
  const inside = useCallback(
    (node: Node) => !!(panel.current?.contains(node) || button.current?.contains(node)),
    [],
  )
  useDismiss(open, close, inside)
  const measure = useCallback((element: HTMLDivElement | null) => {
    panel.current = element
    if (!element || !button.current) return
    setPlacement(
      placeMenu(button.current.getBoundingClientRect(), {
        width: element.offsetWidth,
        height: element.offsetHeight,
      }),
    )
  }, [])
  useEffect(() => {
    if (open && placement)
      panel.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true })
  }, [open, placement])

  const entries = [
    { label: dataTable.fitColumn, run: (cell: Element) => sizer.fit(cell, columnKey) },
    {
      label: dataTable.widerColumn,
      run: (cell: Element) => sizer.resize(cell, columnKey, cellWidth(cell) + MENU_STEP, true),
    },
    {
      label: dataTable.narrowerColumn,
      run: (cell: Element) => sizer.resize(cell, columnKey, cellWidth(cell) - MENU_STEP, true),
    },
    { label: dataTable.resetColumns, run: () => sizer.reset() },
  ]
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      close(true)
      return
    }
    const move = MOVES[event.key]
    if (!move) return
    event.preventDefault()
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")]
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[move(at, items.length - 1)]?.focus({ preventScroll: true })
  }

  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-slot="column-menu"
        className="text-muted-foreground group-focus-within/th:opacity-100 group-hover/th:opacity-100 aria-expanded:opacity-100 [@media(hover:hover)]:opacity-0"
        onClick={() => {
          setPlacement(null)
          setOpen((was) => !was)
        }}
      >
        <Icon icon={MoveHorizontal} />
      </Button>
      {open &&
        createPortal(
          <div
            ref={measure}
            id={panelId}
            role="menu"
            aria-label={label}
            aria-orientation="vertical"
            data-slot="column-menu-panel"
            style={
              placement
                ? { position: "fixed", top: placement.top, left: placement.left }
                : { position: "fixed", visibility: "hidden" }
            }
            className="border-border bg-popover text-popover-foreground shadow-3 z-50 flex min-w-max flex-col rounded-md border p-1.5"
            onKeyDown={onMenuKeyDown}
          >
            {entries.map((entry) => (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={cn(MENU_ITEM)}
                onClick={() => {
                  const cell = button.current?.closest("th")
                  if (cell) entry.run(cell)
                  close(true)
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>,
          portal ?? document.body,
        )}
    </>
  )
}
