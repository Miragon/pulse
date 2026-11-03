import { useEffect, useRef, type ReactNode } from "react"

/**
 * Moves focus to the new view and announces it when `viewKey` changes, so a
 * drill never drops focus on the body unannounced. The first render takes no
 * focus. Render one frame for all views so it persists.
 */
export function NavigationFocus({
  viewKey,
  label,
  children,
}: {
  viewKey: string
  label: string
  children: ReactNode
}) {
  const frame = useRef<HTMLDivElement>(null)
  const shown = useRef(viewKey)
  useEffect(() => {
    if (shown.current === viewKey) return
    shown.current = viewKey
    frame.current?.focus()
  }, [viewKey])
  return (
    <div ref={frame} tabIndex={-1} className="min-w-0 outline-none">
      <span role="status" aria-live="polite" className="sr-only">
        {label}
      </span>
      {children}
    </div>
  )
}
