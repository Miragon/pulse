import { useMemo, type ReactNode } from "react"
import { DisplayModeControlProvider, type DisplayModeControl } from "./display-mode-toggle.js"
import {
  INLINE_DIAGRAM_MAX_HEIGHT,
  InlineBudgetProvider,
  NO_INLINE_BUDGET,
  type InlineBudget,
} from "./inline-budget.js"
import { ShellHostProvider, type ShellHost } from "./shell-host.js"
import { ViewHostProvider, type ViewHost } from "./view-host.js"
import { DisplayModeProvider } from "./widget-shell.js"

export type RequestDisplayMode = (mode: "inline" | "fullscreen") => void

/**
 * The host-agnostic contexts every widget reads, all derived from ONE `ShellHost`: the display
 * mode, the fullscreen switch, the inline budget (#396) and the view host. The ext-apps adapter
 * (`ext-apps-host.tsx`) and `TestViewHost` both mount it, so a widget test sees the production
 * derivation: inline, the BPMN canvas is capped and "show more" asks for fullscreen where the
 * host offers it.
 */
export function HostContexts({
  shell,
  host,
  requestDisplayMode,
  children,
}: {
  shell: ShellHost
  host: ViewHost
  /** Stable across renders (a `useCallback`), so the derived contexts stay stable too. */
  requestDisplayMode: RequestDisplayMode
  children: ReactNode
}) {
  const { displayMode } = shell
  const offersFullscreen = shell.availableDisplayModes.includes("fullscreen")
  const control = useMemo<DisplayModeControl>(
    () => ({
      displayMode,
      canFullscreen: displayMode === "fullscreen" || offersFullscreen,
      request: requestDisplayMode,
    }),
    [displayMode, offersFullscreen, requestDisplayMode],
  )
  const budget = useMemo<InlineBudget>(
    () =>
      displayMode === "inline"
        ? {
            diagramMaxHeight: INLINE_DIAGRAM_MAX_HEIGHT,
            expand: offersFullscreen ? () => requestDisplayMode("fullscreen") : null,
          }
        : NO_INLINE_BUDGET,
    [displayMode, offersFullscreen, requestDisplayMode],
  )
  return (
    <ShellHostProvider host={shell}>
      <DisplayModeProvider mode={displayMode}>
        <DisplayModeControlProvider control={control}>
          <InlineBudgetProvider budget={budget}>
            <ViewHostProvider host={host}>{children}</ViewHostProvider>
          </InlineBudgetProvider>
        </DisplayModeControlProvider>
      </DisplayModeProvider>
    </ShellHostProvider>
  )
}
