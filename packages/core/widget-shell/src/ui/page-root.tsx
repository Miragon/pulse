/**
 * The page root: one view on a plain page outside a chat (the web app), without ext-apps' `App`.
 * The page calls the view tool itself through the caller it hands in, and the view runs under the
 * same providers as in a chat, so every widget runs unchanged.
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { decodeToolResult } from "../protocol/tool-result.js"
import { BrowserViewHost, type BrowserHostOptions } from "./browser-view-host.js"
import { isViewData, type ViewCall, type ViewPhase } from "./view-call.js"
import { ViewErrorBoundary } from "./view-error-boundary.js"
import { ViewFrame } from "./view-frame.js"
import { useViewHost, type ViewHost } from "./view-host.js"
import { rootElement, ViewProviders } from "./view-providers.js"
import type { ViewComponent, ViewMap } from "./views.js"

export interface MountPageOptions extends BrowserHostOptions {
  /** The view to show: its view tool's name, a key of the view map. */
  view: string
  /** The view tool's arguments, as a chat's call would pass them. */
  args?: Record<string, unknown>
  /** Where the page mounts it; default: the document's `#root`, created where it has none. */
  container?: HTMLElement
}

const NO_ARGS: Record<string, unknown> = {}

/** The view tool's result as the frame shows it: the view's data, or why it is missing. */
async function loadView(
  callTool: ViewHost["callTool"],
  name: string,
  args: Record<string, unknown>,
): Promise<ViewPhase> {
  try {
    const data = decodeToolResult<unknown>(await callTool(name, args))
    if (!isViewData(data)) {
      return { phase: "error", error: new Error("The view's data did not arrive.") }
    }
    return { phase: "ready", data, reloadedAt: null }
  } catch (error) {
    return { phase: "error", error: error instanceof Error ? error : new Error(String(error)) }
  }
}

/** The page's own call of the view tool: once on mount, again on the user's retry. */
function usePageCall(name: string, args: Record<string, unknown>, enabled: boolean): ViewCall {
  const { callTool } = useViewHost()
  const [phase, setPhase] = useState<ViewPhase>({ phase: "waiting" })
  const started = useRef(false)
  useEffect(() => {
    // Once per mount; the ref also stops StrictMode's second effect run.
    if (!enabled || started.current) return
    started.current = true
    void loadView(callTool, name, args).then(setPhase)
  }, [enabled, callTool, name, args])
  const retry = useCallback(() => {
    setPhase({ phase: "waiting" })
    void loadView(callTool, name, args).then(setPhase)
  }, [callTool, name, args])
  return useMemo(() => ({ phase, retry }), [phase, retry])
}

interface PageRootProps {
  name: string
  view: ViewComponent | undefined
  args: Record<string, unknown>
  host: BrowserHostOptions
}

function PageViewFrame({ name, view, args }: Omit<PageRootProps, "host">) {
  return <ViewFrame call={usePageCall(name, args, view !== undefined)} view={view} />
}

/** The provider order is `ViewRoot`'s: the host first, then the providers every root shares. */
function PageRoot({ name, view, args, host }: PageRootProps) {
  return (
    <StrictMode>
      <BrowserViewHost options={host}>
        <ViewProviders>
          <PageViewFrame name={name} view={view} args={args} />
        </ViewProviders>
      </BrowserViewHost>
    </StrictMode>
  )
}

/**
 * Mounts the view `options.view` names from `views` on a page outside a chat; an unknown name
 * renders the "can't show" state. Returns the unmount.
 */
export function mountPage(views: ViewMap, options: MountPageOptions): () => void {
  const { view: name, args = NO_ARGS, container, ...host } = options
  const view = Object.hasOwn(views, name) ? views[name] : undefined
  const root = createRoot(container ?? rootElement())
  root.render(
    <ViewErrorBoundary>
      <PageRoot name={name} view={view} args={args} host={host} />
    </ViewErrorBoundary>,
  )
  return () => root.unmount()
}
