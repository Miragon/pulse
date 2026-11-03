import { createContext, useContext, type ReactNode } from "react"
import type { EffectiveTheme, HostStyleVariables } from "./host-context.js"

/**
 * As REPORTED, no fallbacks, so "the host said nothing" stays distinguishable. The mcp-use
 * adapter (`McpUseViewHost`) provides it in production, `TestViewHost` in tests.
 */
export interface ShellHost {
  /** The bridge is connected; until then every other field is unknown. */
  connected: boolean
  theme?: EffectiveTheme
  locale?: string
  timeZone?: string
  /** SEP-1865 `styles.variables` (`--color-*`, `--font-*`, …). */
  styleVariables?: HostStyleVariables
  /** SEP-1865 `styles.css.fonts`: `@font-face`/`@import` CSS for the host font. */
  fontCss?: string
  displayMode: string
  availableDisplayModes: readonly string[]
  /** Vertical budget in px from `containerDimensions`; `undefined` = unbounded. */
  maxHeight?: number
  /** Mobile safe-area insets in px. */
  safeArea?: { top: number; right: number; bottom: number; left: number }
  /** The serving MCP server's public asset base (empty outside a served view document). */
  publicBase?: string
}

const NO_HOST: ShellHost = { connected: true, displayMode: "inline", availableDisplayModes: [] }

const ShellHostContext = createContext<ShellHost>(NO_HOST)

export function ShellHostProvider({ host, children }: { host: ShellHost; children: ReactNode }) {
  return <ShellHostContext.Provider value={host}>{children}</ShellHostContext.Provider>
}

export function useShellHost(): ShellHost {
  return useContext(ShellHostContext)
}
