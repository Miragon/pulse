/**
 * The browser adapter of the view host: what a plain page outside a chat provides, mounted as the
 * host-agnostic contexts every widget reads, as the ext-apps adapter does in a chat. It speaks to
 * no host: tools go through the caller the page hands in, nothing reaches a model, and no view
 * writes to an engine.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import type { ToolResult } from "../protocol/tool-result.js"
import { HostContexts, type RequestDisplayMode } from "./host-contexts.js"
import { hostThemeOf, type EffectiveTheme } from "./host-context.js"
import { PAGE_HINTS, type PageHints } from "./page-hints.js"
import type { ShellHost } from "./shell-host.js"
import type { FollowUp, ToolCallOptions, ViewHost } from "./view-host.js"

/**
 * Calls a server tool for the page, a fetch to the server's `/mcp` endpoint say. RESOLVES with the
 * raw result, an `isError` result included; rejects only on a transport failure. `options` asks
 * past the caller's caches (`refresh`) or names another connection (`connector`); a caller that
 * reaches one server refuses a call that names another.
 */
export type ToolCaller = (
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
) => Promise<ToolResult>

export interface BrowserHostOptions {
  callTool: ToolCaller
  /**
   * What a hand-off does on the page, which posts into no chat: `copy` offers its prompt to copy
   * into a chat of the user's own, `none` (the default) shows none.
   */
  followUp?: Exclude<FollowUp, "chat">
  /**
   * The page's start page, its URL: the state of a start the server refuses for good (a board it
   * does not show, arguments no tool takes, data it does not offer) links to it, as its words say.
   */
  startPage?: string
  /** The page's locale; default: the document's `lang`, else the browser's language. */
  locale?: string
  /**
   * The serving Pulse server's origin, whose Geist faces the page then declares; without one the
   * page's own stylesheet brings its fonts.
   */
  publicBase?: string
  /**
   * The page's words of what to do after a failure (`ViewHost.pageHints`); default `PAGE_HINTS`,
   * which lead to Pulse's start page. A page elsewhere (an artifact) brings its own, with the place
   * where its viewer manages its connection (`connectionPlace`).
   */
  pageHints?: PageHints
  /**
   * The time zone the page's dates and days are in (an IANA name); default, and for a zone the
   * browser does not know: the browser's own.
   */
  timeZone?: string
  /**
   * The document states its theme itself on `<html>`'s `data-theme` (claude.ai stamps it on an
   * artifact's root for an explicit choice and leaves it off to follow the system): the view reads
   * it and writes no theme onto the document, so the kit's stylesheet follows that attribute, else
   * the OS. Default false: the page's `data-cd-theme`, else the OS, written onto the document.
   */
  documentTheme?: boolean
  /**
   * The page's clock (`ViewHost.now`), where its numbers are not read now (a recording's `asOf`);
   * default none: the page reads live.
   */
  now?: () => Date
}

/** How the view learns the theme the page states: it subscribes to it and reads it. */
interface PageThemeSource {
  readonly subscribe: (onChange: () => void) => () => void
  readonly read: () => EffectiveTheme | undefined
}

/** A theme the root names in `attribute`, its changes observed; none: the view follows the OS. */
function rootThemeSource(attribute: string): PageThemeSource {
  return {
    subscribe: (onChange) => {
      const observer = new MutationObserver(onChange)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [attribute],
      })
      return () => observer.disconnect()
    },
    read: () => hostThemeOf(document.documentElement.getAttribute(attribute)),
  }
}

/** The guide's theme switch on the document, as the editor hosts write it. */
const PAGE_THEME = rootThemeSource("data-cd-theme")

/** The document's own theme, which the view then never writes (`documentTheme`). */
const DOCUMENT_THEME = rootThemeSource("data-theme")

/** A page owns its viewport: fullscreen, its one mode, so it offers no switch. */
const PAGE_MODES: readonly string[] = ["fullscreen"]

const NO_SWITCH: RequestDisplayMode = () => undefined

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

/**
 * A page writes to no engine: it offers only what a view reads. It keeps no address: a page's view
 * gets the page's address for it where the page shows it (`PageView`'s `location`). A call's
 * options reach the page's caller only where the view names them, so a caller sees what it saw.
 */
function browserViewHost(
  callTool: ToolCaller,
  followUp: FollowUp,
  startPage: string | undefined,
  pageHints: PageHints,
  now: (() => Date) | undefined,
): ViewHost {
  return {
    callTool: async (name, args = {}, ...options: [ToolCallOptions?]) =>
      await callTool(name, args as Record<string, unknown>, ...options),
    sendFollowUp: () => undefined,
    followUp,
    pageHints,
    writes: false,
    startPage,
    now,
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
  const { callTool, followUp = "none", startPage, publicBase, timeZone, now } = options
  const { pageHints = PAGE_HINTS, documentTheme = false, locale: given } = options
  const source = documentTheme ? DOCUMENT_THEME : PAGE_THEME
  const theme = useSyncExternalStore(source.subscribe, source.read, () => undefined)
  const [locale] = useState(() => given ?? pageLocale())
  const shell = useMemo<ShellHost>(
    () => ({
      connected: true,
      theme,
      documentTheme,
      locale,
      timeZone,
      displayMode: "fullscreen",
      availableDisplayModes: PAGE_MODES,
      publicBase,
    }),
    [theme, documentTheme, locale, timeZone, publicBase],
  )
  const host = useMemo(
    () => browserViewHost(callTool, followUp, startPage, pageHints, now),
    [callTool, followUp, startPage, pageHints, now],
  )
  return (
    <HostContexts shell={shell} host={host} requestDisplayMode={NO_SWITCH}>
      {children}
    </HostContexts>
  )
}
