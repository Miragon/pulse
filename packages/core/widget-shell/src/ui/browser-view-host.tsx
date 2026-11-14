/**
 * The browser adapter of the view host: what a plain page outside a chat provides, mounted as the
 * host-agnostic contexts every widget reads, as the ext-apps adapter does in a chat. It speaks to
 * no host: tools go through the caller the page hands in, and nothing reaches a model.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import type { ToolResult } from "../protocol/tool-result.js"
import { HostContexts, type RequestDisplayMode } from "./host-contexts.js"
import { hostThemeOf, type EffectiveTheme } from "./host-context.js"
import type { ShellHost } from "./shell-host.js"
import type { FollowUp, ViewHost } from "./view-host.js"

/**
 * Calls a server tool for the page, a fetch to the server's `/mcp` endpoint say. RESOLVES with the
 * raw result, an `isError` result included; rejects only on a transport failure.
 */
export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<ToolResult>

export interface BrowserHostOptions {
  callTool: ToolCaller
  /**
   * What a hand-off does on the page, which posts into no chat: `copy` offers its prompt to copy
   * into a chat of the user's own, `none` (the default) shows none.
   */
  followUp?: Exclude<FollowUp, "chat">
  /** The page's locale; default: the document's `lang`, else the browser's language. */
  locale?: string
  /**
   * The serving Pulse server's origin, whose Geist faces the page then declares; without one the
   * page's own stylesheet brings its fonts.
   */
  publicBase?: string
}

/** The guide's theme switch on the document, as the editor hosts write it. */
const THEME_ATTRIBUTE = "data-cd-theme"

/** A page owns its viewport: fullscreen, its one mode, so it offers no switch. */
const PAGE_MODES: readonly string[] = ["fullscreen"]

const NO_SWITCH: RequestDisplayMode = () => undefined

function subscribePageTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE],
  })
  return () => observer.disconnect()
}

/** The theme the page sets, if any; without one the view follows the OS (`useApplyTheme`). */
function pageTheme(): EffectiveTheme | undefined {
  return hostThemeOf(document.documentElement.getAttribute(THEME_ATTRIBUTE))
}

/** Read once: the locale gate writes the language it resolved into `lang` afterwards. */
function pageLocale(): string | undefined {
  return document.documentElement.lang || navigator.language || undefined
}

/** Nothing on a page reads what a view tells a model. */
function NoModelContext({ children }: { content: string; children?: ReactNode }) {
  return children
}

function openInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer")
}

function browserViewHost(callTool: ToolCaller, followUp: FollowUp): ViewHost {
  return {
    callTool: async (name, args = {}) => await callTool(name, args as Record<string, unknown>),
    sendFollowUp: () => undefined,
    followUp,
    openExternal: openInNewTab,
    ModelContext: NoModelContext,
  }
}

export function BrowserViewHost({
  options,
  children,
}: {
  options: BrowserHostOptions
  children: ReactNode
}) {
  const { callTool, followUp = "none", publicBase } = options
  const theme = useSyncExternalStore(subscribePageTheme, pageTheme, () => undefined)
  const [locale] = useState(() => options.locale ?? pageLocale())
  const shell = useMemo<ShellHost>(
    () => ({
      connected: true,
      theme,
      locale,
      displayMode: "fullscreen",
      availableDisplayModes: PAGE_MODES,
      publicBase,
    }),
    [theme, locale, publicBase],
  )
  const host = useMemo(() => browserViewHost(callTool, followUp), [callTool, followUp])
  return (
    <HostContexts shell={shell} host={host} requestDisplayMode={NO_SWITCH}>
      {children}
    </HostContexts>
  )
}
