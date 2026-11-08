import { createContext, useContext, type ComponentType, type ReactNode } from "react"
import type { ToolResult } from "../protocol/tool-result.js"

/**
 * The ONE seam between a view and its host. Widgets never import `@modelcontextprotocol/ext-apps`:
 * production provides the ext-apps adapter (`mountViews`), tests `TestViewHost`, a later host
 * (a web app, an editor) its own. Display mode stays in the host-agnostic `useShellHost`/`useDisplayModeControl`.
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
  if (!host) throw new Error("[pulse] useViewHost() needs mountViews/mountView or TestViewHost")
  return host
}

/** The ONE way a widget reports model context; build `content` with `modelContextText`. */
export function HostModelContext({ content, children }: { content: string; children?: ReactNode }) {
  const { ModelContext } = useViewHost()
  return <ModelContext content={content}>{children}</ModelContext>
}
