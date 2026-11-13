import { createContext, useContext, type ReactNode } from "react"
import { cn } from "@miragon/pulse-ui"

/** Without this flag every embedded widget would stack a second background and padding inside the first. */
const InsideShellContext = createContext(false)

/** The display mode the bundle root provides, read by `useShellHost`'s consumers. */
const DisplayModeContext = createContext<string>("inline")

export function DisplayModeProvider({ mode, children }: { mode: string; children: ReactNode }) {
  return <DisplayModeContext.Provider value={mode}>{children}</DisplayModeContext.Provider>
}

export function useHostDisplayMode(): string {
  return useContext(DisplayModeContext)
}

/**
 * Every child may shrink (`min-w-0`), so a wide table scrolls in its own region instead of widening
 * the document. The view sits in the gutter of the density roles and its sections the section gap
 * apart (12 px each, 16 px on touch).
 */
export function WidgetShell({ children, className }: { children: ReactNode; className?: string }) {
  const nested = useContext(InsideShellContext)
  const displayMode = useContext(DisplayModeContext)
  // Nested: keep the section stack; widgets rely on the shell's gap.
  if (nested) {
    return <div className={cn("gap-section flex min-w-0 flex-col", className)}>{children}</div>
  }

  const isFullscreen = displayMode === "fullscreen"
  return (
    <InsideShellContext.Provider value={true}>
      <div className={cn("bg-card text-card-foreground min-h-full min-w-0", className)}>
        <div
          className={`gap-section p-gutter mx-auto flex min-w-0 flex-col ${isFullscreen ? "max-w-full" : "max-w-7xl"}`}
        >
          {children}
        </div>
      </div>
    </InsideShellContext.Provider>
  )
}
