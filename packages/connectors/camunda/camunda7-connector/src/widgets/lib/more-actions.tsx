import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { Button, usePortalContainer } from "@miragon/mcp-toolkit-ui"
import { Icon } from "@miragon/pulse-widget-shell/widgets"
import { Ellipsis } from "lucide-react"

const GAP = 4

interface Placement {
  top: number
  right: number
}

/** Over the button when there is no room below: an inline chat frame is only as tall as its content. */
function placePanel(button: DOMRect, panelHeight: number, frameHeight: number): Placement {
  const below = button.bottom + GAP
  const fitsBelow = below + panelHeight <= frameHeight
  return {
    top: fitsBelow ? below : Math.max(GAP, button.top - GAP - panelHeight),
    right: Math.max(GAP, window.innerWidth - button.right),
  }
}

/** An entry that rendered nothing is not one. */
function menuItems(panel: HTMLElement | null): HTMLElement[] {
  return panel ? [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]')] : []
}

function nextItem(items: HTMLElement[], current: number, key: string): HTMLElement | null {
  const last = items.length - 1
  if (last < 0) return null
  if (key === "ArrowDown") return items[current >= last ? 0 : current + 1]
  if (key === "ArrowUp") return items[current <= 0 ? last : current - 1]
  if (key === "Home") return items[0]
  if (key === "End") return items[last]
  return null
}

/**
 * #322 U20, CI §8/§12 menu button: arrows/Home/End move, Escape returns focus to the button,
 * Tab, an outside click, scroll or resize close it. Portaled into the theme scope's overlay node and placed
 * `fixed`: a pinned action column is a stacking context per row, so an in-cell panel would
 * paint under the next rows and lose its clicks.
 */
export function MoreActions({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const portalContainer = usePortalContainer()
  const measurePanel = useCallback((panel: HTMLDivElement | null) => {
    panelRef.current = panel
    if (!panel || !buttonRef.current) return
    setPlacement(
      placePanel(buttonRef.current.getBoundingClientRect(), panel.offsetHeight, window.innerHeight),
    )
  }, [])

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (open && placement) menuItems(panelRef.current)[0]?.focus({ preventScroll: true })
  }, [open, placement])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        close(false)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
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
  }, [open, close])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      // The menu lives at the end of the theme scope, so Tab goes on from the button.
      close(true)
      return
    }
    const items = menuItems(panelRef.current)
    const next = nextItem(items, items.indexOf(document.activeElement as HTMLElement), event.key)
    if (!next) return
    event.preventDefault()
    next.focus({ preventScroll: true })
  }

  const onMenuClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('[role="menuitem"]')) close(true)
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setPlacement(null)
          setOpen((was) => !was)
        }}
      >
        <Icon icon={Ellipsis} dense />
      </Button>
      {open &&
        createPortal(
          <div
            ref={measurePanel}
            id={panelId}
            role="menu"
            aria-label={label}
            aria-orientation="vertical"
            data-slot="more-actions"
            style={
              placement
                ? { position: "fixed", top: placement.top, right: placement.right }
                : { position: "fixed", visibility: "hidden" }
            }
            className="border-border bg-popover text-popover-foreground shadow-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 z-50 flex min-w-max flex-col rounded-md border p-1.5"
            onKeyDown={onMenuKeyDown}
            onClick={onMenuClick}
          >
            {children}
          </div>,
          portalContainer ?? document.body,
        )}
    </>
  )
}
