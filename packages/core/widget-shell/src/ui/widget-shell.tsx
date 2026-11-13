import { createContext, useContext, type ReactNode } from "react"
import { cn } from "@miragon/pulse-ui"

/**
 * What a shell's children sit in: `null` outside any shell, `"padded"` inside a shell's content
 * (the gutter is already there), `"flush"` inside a shell whose children are views of their own.
 */
type ShellContent = "padded" | "flush" | null

/** Without it every embedded widget would stack a second background and gutter inside the first. */
const ShellContentContext = createContext<ShellContent>(null)

/** The display mode the bundle root provides, read by `useShellHost`'s consumers. */
const DisplayModeContext = createContext<string>("inline")

export function DisplayModeProvider({ mode, children }: { mode: string; children: ReactNode }) {
  return <DisplayModeContext.Provider value={mode}>{children}</DisplayModeContext.Provider>
}

export function useHostDisplayMode(): string {
  return useContext(DisplayModeContext)
}

/** Whether the shell around a component pads its children (`"padded"`), leaves them flush or is none. */
export function useShellContent(): ShellContent {
  return useContext(ShellContentContext)
}

/** A shell's content: the gutter at its sides, 12 px above and below, its sections the section gap apart. */
const CONTENT = "px-gutter gap-section flex min-w-0 flex-col py-3"

export interface WidgetShellProps {
  /**
   * The view's bars, from edge to edge of the card: its `WidgetHeader` (the kit's `ViewBar`), then
   * the `StatusStrip`s docked under it and a list's filter `Toolbar` right under the bar. A bar
   * brings the gutter at its sides itself; one further down, inside the content, reaches the
   * card's edges with `-mx-gutter`.
   */
  header?: ReactNode
  /** The view's content: in the gutter, 12 px above and below, its sections the section gap apart. */
  children?: ReactNode
  /**
   * The children are views of their own, each a shell with its bars and its content (a cockpit's
   * routes): they sit flush, from edge to edge, and pad themselves.
   */
  flush?: boolean
  className?: string
}

/**
 * The card a view sits on. It pads nothing itself: its `header` runs from edge to edge (a bar's
 * rule spans the card, the webview's context bar), its children sit in the gutter of the density
 * roles (12 px, 16 px on touch) with the section gap between them. Every child may shrink
 * (`min-w-0`), so a wide table scrolls in its own region instead of widening the document.
 *
 * Nested: inside a `flush` shell it is a view of its own (its bars from edge to edge, its content
 * in the gutter); inside another shell's padded content it is part of that content and adds no
 * gutter, only its bars and its sections the section gap apart.
 */
export function WidgetShell({ header, children, flush = false, className }: WidgetShellProps) {
  const around = useContext(ShellContentContext)
  const displayMode = useContext(DisplayModeContext)
  const inner: ShellContent = flush ? "flush" : "padded"
  if (around === "padded") {
    return (
      <ShellContentContext.Provider value="padded">
        <div
          data-slot="widget-shell"
          className={cn("gap-section flex min-w-0 flex-col", className)}
        >
          {header}
          {children}
        </div>
      </ShellContentContext.Provider>
    )
  }
  const body = (
    <ShellContentContext.Provider value={inner}>
      {header}
      {children !== undefined && children !== null && children !== false && (
        <div data-slot="widget-content" className={flush ? "flex min-w-0 flex-col" : CONTENT}>
          {children}
        </div>
      )}
    </ShellContentContext.Provider>
  )
  // Inside a flush shell: a view of its own, on the card the outer shell draws.
  if (around === "flush") {
    return (
      <div data-slot="widget-shell" className={cn("flex min-w-0 flex-col", className)}>
        {body}
      </div>
    )
  }
  const isFullscreen = displayMode === "fullscreen"
  return (
    <div className={cn("bg-card text-card-foreground min-h-full min-w-0", className)}>
      <div
        data-slot="widget-shell"
        className={cn("mx-auto flex min-w-0 flex-col", isFullscreen ? "max-w-full" : "max-w-7xl")}
      >
        {body}
      </div>
    </div>
  )
}
