/**
 * The official adapter of the view host: `view-runtime.ts`' stores mounted as the host-agnostic
 * contexts every widget reads. Widgets never touch the `App` (invariant 6).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { decodeToolResult } from "../protocol/tool-result.js"
import { HostContexts, type RequestDisplayMode } from "./host-contexts.js"
import { hostThemeOf } from "./host-context.js"
import type { ShellHost } from "./shell-host.js"
import { isViewData, resolveViewCall, type Rerun, type ViewCall } from "./view-call.js"
import { useViewHost, type ViewHost } from "./view-host.js"
import type { ViewRuntime } from "./view-runtime.js"

const warn = (what: string) => (error: unknown) => console.warn(`[pulse] ${what} failed:`, error)

const RuntimeContext = createContext<ViewRuntime | null>(null)
const ParentNodeContext = createContext<string | null>(null)

const NO_SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 }

function useRuntime(): ViewRuntime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error("[pulse] the view runtime is mounted by mountViews/mountView")
  return runtime
}

/** A node of the model-context tree; a blank `content` hands its children to its parent. */
function RuntimeModelContext({ content, children }: { content: string; children?: ReactNode }) {
  const runtime = useRuntime()
  const parentId = useContext(ParentNodeContext)
  const id = useId()
  const hasContent = content.trim().length > 0
  useEffect(() => {
    if (hasContent) runtime.setModelContextNode({ id, parentId, content })
    else runtime.removeModelContextNode(id)
  }, [runtime, id, parentId, content, hasContent])
  useEffect(() => () => runtime.removeModelContextNode(id), [runtime, id])
  if (children === undefined || children === null) return null
  return (
    <ParentNodeContext.Provider value={hasContent ? id : parentId}>
      {children}
    </ParentNodeContext.Provider>
  )
}

function maxHeightOf(dimensions: Record<string, unknown> | undefined): number | undefined {
  if (typeof dimensions?.height === "number") return dimensions.height
  return typeof dimensions?.maxHeight === "number" ? dimensions.maxHeight : undefined
}

/** The serving server's origin, as the document's inline config states it. */
const publicBaseOf = (): string =>
  (globalThis as { __pulseViewConfig?: { publicBase?: string } }).__pulseViewConfig?.publicBase ??
  ""

/** The host's context and calls from the `App`, mounted as the host-agnostic contexts. */
export function ExtAppsViewHost({
  runtime,
  children,
}: {
  runtime: ViewRuntime
  children: ReactNode
}) {
  const { hostContext, connected, displayMode, availableDisplayModes } = useSyncExternalStore(
    runtime.subscribeHost,
    runtime.getHost,
  )
  const shell = useMemo<ShellHost>(
    () => ({
      connected,
      theme: hostThemeOf(hostContext?.theme),
      locale: hostContext?.locale,
      timeZone: hostContext?.timeZone,
      styleVariables: hostContext?.styles?.variables,
      fontCss: hostContext?.styles?.css?.fonts,
      displayMode,
      availableDisplayModes,
      maxHeight: maxHeightOf(hostContext?.containerDimensions),
      safeArea: hostContext?.safeAreaInsets ?? NO_SAFE_AREA,
      publicBase: publicBaseOf(),
    }),
    [hostContext, connected, displayMode, availableDisplayModes],
  )
  const request = useCallback<RequestDisplayMode>(
    (mode) => void runtime.requestDisplayMode(mode).catch(warn("requestDisplayMode")),
    [runtime],
  )
  const host = useMemo<ViewHost>(
    () => ({
      callTool: (name, args = {}) => runtime.callTool(name, args as Record<string, unknown>),
      sendFollowUp: (prompt) => void runtime.sendFollowUp(prompt).catch(warn("sendFollowUp")),
      openExternal: (url) => {
        // Not connected (the bundle opened straight in a browser): the plain browser way.
        if (!connected) {
          window.open(url, "_blank", "noopener,noreferrer")
          return
        }
        void runtime.openLink(url).catch(warn("openExternal"))
      },
      ModelContext: RuntimeModelContext,
    }),
    [runtime, connected],
  )
  return (
    <RuntimeContext.Provider value={runtime}>
      <HostContexts shell={shell} host={host} requestDisplayMode={request}>
        {children}
      </HostContexts>
    </RuntimeContext.Provider>
  )
}

/**
 * The rendering call as the view shows it. A stripped result re-runs the view's own show tool ONCE
 * with the call's complete arguments; the view name IS that tool (`showToolBinding`).
 */
export function useViewCall(name: string | undefined): ViewCall {
  const runtime = useRuntime()
  const tool = useSyncExternalStore(runtime.subscribeTool, runtime.getTool)
  const { callTool } = useViewHost()
  const [rerun, setRerun] = useState<Rerun>({ state: "idle" })
  const started = useRef(false)

  const callFailed = tool.status === "error"
  const args = useMemo(
    () => tool.completeArgs ?? tool.toolInput ?? {},
    [tool.completeArgs, tool.toolInput],
  )
  const rerunView = useCallback(
    async (recovered: boolean): Promise<Rerun> => {
      if (!name) return { state: "failed", error: new Error("The view has no name to re-run.") }
      try {
        const data = decodeToolResult<unknown>(await callTool(name, args))
        if (!isViewData(data)) {
          return { state: "failed", error: new Error("The view's data did not arrive.") }
        }
        return { state: "done", data, at: Date.now(), recovered }
      } catch (error) {
        return { state: "failed", error: error instanceof Error ? error : new Error(String(error)) }
      }
    },
    [name, callTool, args],
  )

  const { phase, recover } = resolveViewCall({
    status: tool.status,
    output: tool.toolOutput,
    error: tool.error,
    cancelled: tool.cancelled,
    stripped: tool.stripped,
    rerun,
  })

  // Once per document; the ref also stops StrictMode's second effect run.
  useEffect(() => {
    if (!recover || started.current || !name) return
    started.current = true
    void rerunView(true).then(setRerun)
  }, [recover, name, rerunView])

  const retry = useCallback(() => {
    setRerun({ state: "running" })
    // After a failed or cancelled call the chat never had figures: no "reloaded" stamp.
    void rerunView(!callFailed).then(setRerun)
  }, [rerunView, callFailed])

  return { phase, retry }
}
