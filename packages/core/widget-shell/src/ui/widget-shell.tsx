import { createContext, useContext, type ReactNode } from "react"
import { cn } from "@miragon/mcp-toolkit-ui"

/** Without this flag every embedded widget would stack a second background and padding inside the first. */
const InsideShellContext = createContext(false)

/** mcp-use 2.x's `useDisplayMode` only works under `bootstrapView`, so the bundle root provides it. */
const DisplayModeContext = createContext<string>("inline")

export function DisplayModeProvider({ mode, children }: { mode: string; children: ReactNode }) {
  return <DisplayModeContext.Provider value={mode}>{children}</DisplayModeContext.Provider>
}

export function useHostDisplayMode(): string {
  return useContext(DisplayModeContext)
}

/** Every child may shrink (`min-w-0`), so a wide table scrolls in its own region instead of widening the document. */
export function WidgetShell({ children, className }: { children: ReactNode; className?: string }) {
  const nested = useContext(InsideShellContext)
  const displayMode = useContext(DisplayModeContext)
  // Nested: keep the section stack; widgets rely on the shell's gap.
  if (nested) {
    return <div className={cn("flex min-w-0 flex-col gap-6", className)}>{children}</div>
  }

  const isFullscreen = displayMode === "fullscreen"
  return (
    <InsideShellContext.Provider value={true}>
      <div className={cn("bg-card text-card-foreground min-h-full min-w-0", className)}>
        <div
          className={`mx-auto flex min-w-0 flex-col gap-6 p-4 sm:p-6 ${isFullscreen ? "max-w-full" : "max-w-7xl"}`}
        >
          {children}
        </div>
      </div>
    </InsideShellContext.Provider>
  )
}
