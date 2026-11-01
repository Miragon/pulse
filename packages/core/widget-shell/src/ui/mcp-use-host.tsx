/**
 * The mcp-use adapter of the view host (one of the two widget-shell files that import
 * `mcp-use/react`; the other is `view-root.tsx`). Its hooks work only under `bootstrapView`, so
 * everything a widget needs from the host is bridged here into host-agnostic contexts.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  getPublicBaseUrl,
  ModelContext,
  ToolCancelledError,
  ToolError,
  useDisplayMode,
  useDynamicTool,
  useHostContext,
  useOpenExternal,
  useSendFollowUp,
  useToolContext,
} from "mcp-use/react"
import { decodeToolResult, type ToolResult } from "../tool-result.js"
import { NO_CALL_OBSERVATION, type CallObserver } from "./call-observer.js"
import { HostContexts, type RequestDisplayMode } from "./host-contexts.js"
import { hostThemeOf } from "./host-context.js"
import type { ShellHost } from "./shell-host.js"
import { isViewData, resolveViewCall, type Rerun, type ViewCall } from "./view-call.js"
import { useViewHost, type ViewHost } from "./view-host.js"

type BoundCall = (args: Record<string, unknown>) => Promise<unknown>
type PoolCall = (name: string, args: Record<string, unknown>) => Promise<ToolResult>

const warn = (what: string) => (error: unknown) => console.warn(`[pulse] ${what} failed:`, error)

/** One `useDynamicTool` handle, handed up to the pool once it is bound. */
function ToolBinder({
  name,
  onBind,
}: {
  name: string
  onBind: (name: string, call: BoundCall) => void
}): null {
  const { callTool } = useDynamicTool<Record<string, unknown>>(name)
  useEffect(() => {
    onBind(name, callTool)
  }, [name, callTool, onBind])
  return null
}

/** The tool's own `isError` answer resolves; only a transport failure rejects. */
async function settled(call: Promise<unknown>): Promise<ToolResult> {
  try {
    return (await call) as ToolResult
  } catch (error) {
    if (error instanceof ToolError) return error.result
    throw error
  }
}

/**
 * Call-by-name over mcp-use's per-name hooks: mcp-use 2.x has no `(name, args)` API, so the first
 * call for a name mounts one `ToolBinder` (one render tick) and later calls use its handle.
 * Binders stay for the mount's lifetime: a view's tool names are a small closed set.
 */
function useToolPool(): { callTool: PoolCall; binders: ReactNode } {
  const [names, setNames] = useState<readonly string[]>([])
  const bound = useRef(new Map<string, BoundCall>())
  const waiters = useRef(new Map<string, ((call: BoundCall) => void)[]>())

  const onBind = useCallback((name: string, call: BoundCall) => {
    bound.current.set(name, call)
    const waiting = waiters.current.get(name)
    if (!waiting) return
    waiters.current.delete(name)
    for (const resolve of waiting) resolve(call)
  }, [])

  const callTool = useCallback<PoolCall>((name, args) => {
    const call = bound.current.get(name)
    if (call) return settled(call(args))
    const binding = new Promise<BoundCall>((resolve) => {
      waiters.current.set(name, [...(waiters.current.get(name) ?? []), resolve])
    })
    setNames((prev) => (prev.includes(name) ? prev : [...prev, name]))
    return binding.then((next) => settled(next(args)))
  }, [])

  const binders = useMemo(
    () => names.map((name) => <ToolBinder key={name} name={name} onBind={onBind} />),
    [names, onBind],
  )
  return { callTool, binders }
}

/** The host's context and calls from mcp-use's view hooks, mounted as the host-agnostic contexts. */
export function McpUseViewHost({ children }: { children: ReactNode }) {
  const { hostContext, isAvailable, maxHeight, safeArea } = useHostContext()
  const { displayMode, availableDisplayModes, requestDisplayMode } = useDisplayMode()
  const sendFollowUp = useSendFollowUp()
  const openExternal = useOpenExternal()
  const pool = useToolPool()

  const shell = useMemo<ShellHost>(
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
      safeArea,
      publicBase: getPublicBaseUrl(),
    }),
    [hostContext, isAvailable, maxHeight, safeArea, displayMode, availableDisplayModes],
  )
  const request = useCallback<RequestDisplayMode>(
    (mode) => void requestDisplayMode({ mode }).catch(warn("requestDisplayMode")),
    [requestDisplayMode],
  )
  const callTool = pool.callTool
  const host = useMemo<ViewHost>(
    () => ({
      callTool: (name, args = {}) => callTool(name, args as Record<string, unknown>),
      sendFollowUp: (prompt) => void sendFollowUp({ prompt }).catch(warn("sendFollowUp")),
      openExternal: (url) => {
        // Not connected (the bundle opened straight in a browser): the plain browser way.
        if (!isAvailable) {
          window.open(url, "_blank", "noopener,noreferrer")
          return
        }
        void openExternal({ url }).catch(warn("openExternal"))
      },
      ModelContext,
    }),
    [callTool, sendFollowUp, openExternal, isAvailable],
  )

  return (
    <HostContexts shell={shell} host={host} requestDisplayMode={request}>
      {pool.binders}
      {children}
    </HostContexts>
  )
}

function asArgs(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * The rendering call as the view shows it: mcp-use's latch plus the observer, which tells a
 * stripped result (claude.ai forwards `tool-result` without `structuredContent`; mcp-use then
 * stays pending) from a slow tool. A stripped result re-runs the view's own show tool ONCE with
 * the call's complete arguments; the view name IS that tool (`showToolBinding`).
 */
export function useMcpUseViewCall(
  name: string | undefined,
  observer: CallObserver | null,
): ViewCall {
  const tool = useToolContext()
  const subscribe = useCallback(
    (listener: () => void) => (observer ? observer.subscribe(listener) : () => undefined),
    [observer],
  )
  const snapshot = useCallback(
    () => (observer ? observer.getSnapshot() : NO_CALL_OBSERVATION),
    [observer],
  )
  const observation = useSyncExternalStore(subscribe, snapshot, snapshot)
  const { callTool } = useViewHost()
  const [rerun, setRerun] = useState<Rerun>({ state: "idle" })
  const started = useRef(false)

  const cancelled = tool.status === "error" && tool.error instanceof ToolCancelledError
  const callFailed = tool.status === "error"
  // The COMPLETE tool input the observer saw, else mcp-use's (which may be a partial stream).
  const args = useMemo(
    () => observation.args ?? asArgs(tool.toolInput) ?? {},
    [observation.args, tool.toolInput],
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
    cancelled: cancelled || observation.cancelled,
    observation,
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
