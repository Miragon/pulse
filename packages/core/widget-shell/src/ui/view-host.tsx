import { createContext, useContext, type ComponentType, type ReactNode } from "react"
import type { ToolResult } from "../protocol/tool-result.js"

/**
 * What a hand-off does in this host: `chat` posts it into the chat (`sendFollowUp`), `copy` offers
 * its prompt to copy into a chat of the user's own, `none` shows no hand-off. Only a chat host
 * posts; a page outside a chat (`mountPage`) copies or hides.
 */
export type FollowUp = "chat" | "copy" | "none"

/**
 * The ONE seam between a view and its host. Widgets never import `@modelcontextprotocol/ext-apps`:
 * a chat provides the ext-apps adapter (`mountViews`), a page outside a chat the browser adapter
 * (`mountPage`), tests `TestViewHost`. Display mode stays in the host-agnostic
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
   * false on a page outside a chat (`mountPage`), which offers no write, so no write control
   * shows there (`useHostWrites`).
   */
  writes?: boolean
  /**
   * The page's start page, where a page's words of a refused start lead (`mountPage`'s
   * `startPage`): the failure's state then links to it. A chat has none.
   */
  startPage?: string
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
