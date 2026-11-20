import { createContext, useContext, type ComponentType, type ReactNode } from "react"
import type { ToolResult } from "../protocol/tool-result.js"

/**
 * What a hand-off does in this host: `chat` posts it into the chat (`sendFollowUp`), `copy` offers
 * its prompt to copy into a chat of the user's own, `none` shows no hand-off. Only a chat host
 * posts; a page outside a chat (`mountApp`, `mountPage`) copies or hides.
 */
export type FollowUp = "chat" | "copy" | "none"

/**
 * Where a view is, in its view tool's argument shape (`{ view, engine, <ids> }` for the cockpit):
 * what a page's address names. `memo` is the view's own record of how it got there (its trail, say),
 * which the page keeps with the entry and hands back on Back or Forward; the page never reads it.
 */
export interface ViewPlace {
  readonly args: Readonly<Record<string, unknown>>
  readonly memo?: unknown
}

/**
 * A page's address, which follows the view (`ViewHost.location`): only a page outside a chat offers
 * it (`PageView`'s `location`, `mountPage`'s), a chat has no address to follow.
 */
export interface ViewLocation {
  /**
   * Where the page's address put the view at its start, where the view tool's arguments name less
   * than the address (a page path of its own over the view's start); absent otherwise.
   */
  readonly start?: ViewPlace
  /**
   * The view moved: `push` adds an entry to the page's history (a drill, a section), `replace`
   * names the entry the reader is on anew (the view's first place, a tab inside a view).
   */
  readonly report: (place: ViewPlace, entry: "push" | "replace") => void
  /**
   * Back or Forward on the page: `go` gets the place the entry names and answers whether the view
   * goes there itself; where no view does, the page loads the entry anew. Returns the unsubscribe.
   */
  readonly subscribe: (go: (place: ViewPlace) => boolean) => () => void
  /**
   * Whether the page shows the place `args` names itself, with a screen of its own: a view that
   * reaches it reports it as any other move (`report`) and renders nothing there, and never goes
   * there itself on Back or Forward, so the page takes over. Without it the page shows none.
   */
  readonly claims?: (args: ViewPlace["args"]) => boolean
  /**
   * The page's name of a place it shows itself (`claims`), its navigation's word: a view's trail
   * names a crumb that leads there by it, so the page calls one place one thing. Undefined, or
   * without it, the view names the place itself.
   */
  readonly nameOf?: (args: ViewPlace["args"]) => string | undefined
}

/**
 * A page's chrome of its own around its views (`PageView`'s `chrome`): the page navigates itself,
 * its navigation holding what a view's head holds in a chat (the sections, the engine switch, the
 * view across engines), so a view leaves that head to it and keeps its bar. Only a page offers it,
 * a chat never.
 */
export interface HostChrome {
  /**
   * The page's menu button, which opens its navigation where the page hides it (a narrow
   * window): the first element of every view bar (pulse-ui's `ViewBarSlots` `lead`).
   */
  readonly menu: ReactNode
}

/**
 * The ONE seam between a view and its host. Widgets never import `@modelcontextprotocol/ext-apps`:
 * a chat provides the ext-apps adapter (`mountViews`), a page outside a chat the browser adapter
 * (`mountApp`, `mountPage`), tests `TestViewHost`. Display mode stays in the host-agnostic
 * `useShellHost`/`useDisplayModeControl`.
 */
export interface ViewHost {
  /**
   * Calls any server tool by name. RESOLVES with the raw result, an `isError` result included
   * (`decodeToolResult` throws it); rejects only on a transport failure (no host, no
   * `serverTools` capability, a JSON-RPC error such as an unknown tool).
   */
  callTool: (name: string, args?: object) => Promise<ToolResult>
  /** Posts a USER message into the chat (hand-offs, navigation). Fail-soft: never throws. */
  sendFollowUp: (prompt: string) => void
  /** Whether a hand-off posts (`chat`), is copied (`copy`) or shows not at all (`none`). */
  followUp: FollowUp
  /**
   * Whether a view may write to an engine here: absent or true in a chat and in `TestViewHost`,
   * false on a page outside a chat (`mountApp`, `mountPage`), which offers no write, so no write
   * control shows there (`useHostWrites`).
   */
  writes?: boolean
  /**
   * The page's start page, where a page's words of a refused start lead (`mountApp`'s and
   * `mountPage`'s `startPage`): the failure's state then links to it. A chat has none.
   */
  startPage?: string
  /**
   * The page's address for this view, which follows where it is (`PageView`'s `location`,
   * `mountPage`'s): a view reports each move and goes where Back and Forward lead. A chat has none.
   */
  location?: ViewLocation
  /**
   * The page's chrome around the view (`PageView`'s `chrome`), where the page navigates itself:
   * the view leaves its own head to it and shows the page's menu first in its bar. A chat has none.
   */
  chrome?: HostChrome
  /** Opens a URL outside the frame. Fail-soft. */
  openExternal: (url: string) => void
  /** One node of the view's model-context tree; nested nodes join into one context. */
  ModelContext: ComponentType<{ content: string; children?: ReactNode }>
}

const ViewHostContext = createContext<ViewHost | null>(null)

export function ViewHostProvider({ host, children }: { host: ViewHost; children: ReactNode }) {
  return <ViewHostContext.Provider value={host}>{children}</ViewHostContext.Provider>
}

export function useViewHost(): ViewHost {
  const host = useContext(ViewHostContext)
  if (!host) {
    throw new Error("[pulse] useViewHost() needs mountViews/mountView, mountPage or TestViewHost")
  }
  return host
}

/**
 * What a hand-off does in this host, without the host's tool caller: a widget asks it before it
 * shows a menu or a section that holds hand-offs alone, which `none` would leave empty.
 */
export function useHostFollowUp(): FollowUp {
  return useViewHost().followUp
}

/**
 * Where the kit's words of a failure say what to do: a chat's (`chat`) may send the reader there,
 * a page's (`copy`, `none`) say what to do on the page (`describeError`'s `followUp`). Outside a
 * view host (a kit piece rendered on its own) a chat's, as before the host told.
 */
export function useWordsFollowUp(): FollowUp {
  return useContext(ViewHostContext)?.followUp ?? "chat"
}

/**
 * The page's start page (`ViewHost.startPage`), without the host's tool caller; outside a view
 * host (a kit piece rendered on its own) none.
 */
export function useStartPage(): string | undefined {
  return useContext(ViewHostContext)?.startPage
}

/**
 * The page's address (`ViewHost.location`), without the host's tool caller; outside a view host
 * and in a chat none, so a view that asks it moves on screen alone.
 */
export function useHostLocation(): ViewLocation | undefined {
  return useContext(ViewHostContext)?.location
}

/**
 * The page's chrome around the view (`ViewHost.chrome`), without the host's tool caller; outside a
 * view host, in a chat and on a page without chrome of its own none, so a view shows its own head.
 */
export function useHostChrome(): HostChrome | undefined {
  return useContext(ViewHostContext)?.chrome
}

/**
 * Whether this host lets a view write to an engine, without the host's tool caller: a widget's one
 * write primitive asks it before it shows a write control, which a host that writes nothing hides.
 */
export function useHostWrites(): boolean {
  return useViewHost().writes ?? true
}

/** The ONE way a widget reports model context; build `content` with `modelContextText`. */
export function HostModelContext({ content, children }: { content: string; children?: ReactNode }) {
  const { ModelContext } = useViewHost()
  return <ModelContext content={content}>{children}</ModelContext>
}
