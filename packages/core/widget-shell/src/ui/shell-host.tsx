import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useDisplayMode, useHostContext } from "mcp-use/react"
import { resolveRecoveryToolName } from "@miragon/mcp-toolkit-ui/hooks"
import { hostThemeOf, type EffectiveTheme, type HostStyleVariables } from "./host-context.js"
import {
  INLINE_DIAGRAM_MAX_HEIGHT,
  InlineBudgetProvider,
  NO_INLINE_BUDGET,
  type InlineBudget,
} from "./inline-budget.js"
import { DisplayModeControlProvider, type DisplayModeControl } from "./display-mode-toggle.js"
import { DisplayModeProvider } from "./widget-shell.js"

/**
 * As REPORTED, no fallbacks, so "the host said nothing" stays distinguishable.
 * mcp-use's hooks only work under `bootstrapView`, so this is provided from the bundle root.
 */
export interface ShellHost {
  /** The bridge is connected; until then every other field is unknown. */
  connected: boolean
  theme?: EffectiveTheme
  locale?: string
  timeZone?: string
  /** SEP-1865 `styles.variables` (`--color-*`, `--font-*`, …). */
  styleVariables?: HostStyleVariables
  /** SEP-1865 `styles.css.fonts` — `@font-face`/`@import` CSS for the host font. */
  fontCss?: string
  displayMode: string
  availableDisplayModes: readonly string[]
  /** Vertical budget in px from `containerDimensions`; `undefined` = unbounded. */
  maxHeight?: number
  toolName?: string
}

const NO_HOST: ShellHost = { connected: true, displayMode: "inline", availableDisplayModes: [] }

const ShellHostContext = createContext<ShellHost>(NO_HOST)

export function ShellHostProvider({ host, children }: { host: ShellHost; children: ReactNode }) {
  return <ShellHostContext.Provider value={host}>{children}</ShellHostContext.Provider>
}

export function useShellHost(): ShellHost {
  return useContext(ShellHostContext)
}

/** mcp-use hooks are legal only under `bootstrapView`; bridges them into host-agnostic contexts. */
export function ViewHostBridge({ children }: { children: ReactNode }) {
  const { hostContext, isAvailable, maxHeight } = useHostContext()
  const { displayMode, availableDisplayModes, requestDisplayMode } = useDisplayMode()
  const host = useMemo<ShellHost>(
    () => ({
      connected: isAvailable,
      theme: hostThemeOf(hostContext?.theme),
      locale: hostContext?.locale,
      timeZone: hostContext?.timeZone,
      styleVariables: hostContext?.styles?.variables,
      fontCss: hostContext?.styles?.css?.fonts,
      displayMode,
      availableDisplayModes,
      maxHeight,
      toolName: resolveRecoveryToolName(hostContext),
    }),
    [hostContext, isAvailable, maxHeight, displayMode, availableDisplayModes],
  )
  // Inline, "show more" asks for fullscreen where the host offers it (#396).
  const canExpand = availableDisplayModes.includes("fullscreen")
  const budget = useMemo<InlineBudget>(
    () =>
      displayMode === "inline"
        ? {
            diagramMaxHeight: INLINE_DIAGRAM_MAX_HEIGHT,
            expand: canExpand ? () => void requestDisplayMode({ mode: "fullscreen" }) : null,
          }
        : NO_INLINE_BUDGET,
    [displayMode, canExpand, requestDisplayMode],
  )
  const control = useMemo<DisplayModeControl>(
    () => ({
      displayMode,
      canFullscreen: canExpand,
      request: (mode) => void requestDisplayMode({ mode }),
    }),
    [displayMode, canExpand, requestDisplayMode],
  )
  return (
    <ShellHostProvider host={host}>
      <DisplayModeProvider mode={displayMode}>
        <DisplayModeControlProvider control={control}>
          <InlineBudgetProvider budget={budget}>{children}</InlineBudgetProvider>
        </DisplayModeControlProvider>
      </DisplayModeProvider>
    </ShellHostProvider>
  )
}
