import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "../lib/utils.js"

/**
 * The view's heading, focusable from script only, takes focus: a screen reader reads the view's
 * name as its `h1` says it, and the next Tab goes on from there. Null while no heading is drawn.
 */
function focusHeading(frame: HTMLElement): HTMLElement | null {
  const heading = frame.querySelector("h1")
  if (!heading) return null
  if (!heading.hasAttribute("tabindex")) {
    heading.tabIndex = -1
    // No control: it takes focus to be read, and draws no ring for it.
    heading.style.outlineStyle = "none"
  }
  heading.focus()
  return heading
}

/**
 * Moves focus to the new view's heading when `viewKey` changes, so a drill never drops focus on
 * the body and the reader hears where they are: the view's `h1`, which a route renders before its
 * data. A view that draws its heading later holds focus on the frame until it shows; a heading
 * that leaves with the view it headed (a route's guard, which its loaded view replaces) hands
 * focus to the heading drawn in its place. It watches until the reader moves focus elsewhere or
 * the view changes: one the reader left keeps the reader's focus. The first render takes no focus.
 * Render one frame for all views so it persists.
 */
export function NavigationFocus({
  viewKey,
  className,
  children,
}: {
  viewKey: string
  /** The frame's layout in its parent (a page's flex column that a screen fills). */
  className?: string
  children: ReactNode
}) {
  const frame = useRef<HTMLDivElement>(null)
  const shown = useRef(viewKey)
  useEffect(() => {
    if (shown.current === viewKey) return
    shown.current = viewKey
    const root = frame.current
    if (!root) return
    // What holds the focus this component gave: the heading, else the frame.
    let holder = focusHeading(root) ?? root
    if (holder === root) root.focus()
    const observer = new MutationObserver(() => {
      const active = document.activeElement
      // The heading that held focus left the document, so the browser dropped focus on the body.
      const dropped = !holder.isConnected && (active === null || active === document.body)
      if (active !== holder && !dropped) {
        // The reader moved on: their focus stays where they put it.
        observer.disconnect()
        return
      }
      // A heading that still holds focus keeps it; the frame hands it on once a heading shows.
      if (holder !== root && !dropped) return
      holder = focusHeading(root) ?? root
      if (holder === root) root.focus()
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [viewKey])
  return (
    <div ref={frame} tabIndex={-1} className={cn("min-w-0 outline-none", className)}>
      {children}
    </div>
  )
}
