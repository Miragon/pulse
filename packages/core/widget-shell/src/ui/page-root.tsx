/**
 * The page root: one view on a plain page outside a chat (the web app), without ext-apps' `App`.
 * The page calls the view tool itself through the caller it hands in, and the view runs under the
 * same providers as in a chat, so every widget runs unchanged. A page may bring its own frame
 * around the view (its bar, its notices), which renders under those providers too.
 */
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import { createRoot } from "react-dom/client"
import { decodeToolResult } from "../protocol/tool-result.js"
import { BrowserViewHost, type BrowserHostOptions, type ToolCaller } from "./browser-view-host.js"
import { isViewData, type ViewCall, type ViewPhase } from "./view-call.js"
import { ViewErrorBoundary } from "./view-error-boundary.js"
import { ViewFrame } from "./view-frame.js"
import { useViewHost, type ViewHost } from "./view-host.js"
import { rootElement, ViewProviders } from "./view-providers.js"
import type { ViewComponent, ViewMap } from "./views.js"

/** A page's own frame around its view: the view, if the page shows one, is its `children`. */
export type PageFrame = ComponentType<{ children?: ReactNode }>

export interface MountPageOptions extends BrowserHostOptions {
  /**
   * The view to show: its view tool's name, a key of the view map. A page with a `frame` may show
   * none: the frame then renders alone and nothing is called.
   */
  view?: string
  /** The view tool's arguments, as a chat's call would pass them. */
  args?: Record<string, unknown>
  /** Where the page mounts it; default: the document's `#root`, created where it has none. */
  container?: HTMLElement
  /**
   * The page's own chrome around the view (a bar above it, a notice under that), under the view's
   * providers, so it reads the view's locale, theme, icon stroke and toasts. The frame lays out
   * the page: the view takes its content's height instead of filling the viewport.
   */
  frame?: PageFrame
  /**
   * The view's data for a start whose view tool failed, where the view shows that failure in its
   * own place (the cockpit keeps its head over the route that failed to read its engine); null
   * leaves the failure to the frame's error state, as without this option.
   */
  failedStart?: FailedStart
}

/** The view's data for a start that failed with `error`, or null for the frame's error state. */
export type FailedStart = (error: Error) => object | null

/**
 * A page whose frame renders alone (a signed-out page, say): no view, so no caller. Its frame runs
 * under the same providers and host as a view's would; a tool it asks for anyway is refused.
 */
export interface FramePageOptions extends Omit<BrowserHostOptions, "callTool"> {
  view?: undefined
  args?: undefined
  container?: HTMLElement
  /** The page's chrome, alone: see {@link MountPageOptions.frame}. */
  frame: PageFrame
  callTool?: undefined
  failedStart?: undefined
}

const NO_ARGS: Record<string, unknown> = {}

/** The caller of a page that shows no view: it calls no tool, and says so to a frame that asks. */
const NO_VIEW_CALLS: ToolCaller = () =>
  Promise.reject(new Error("This page shows no view, so it calls no tool."))

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

/** A failed start's phase: the view's own data where `failedStart` gives some, else the error. */
function afterFailure(phase: ViewPhase, failedStart: FailedStart | undefined): ViewPhase {
  if (phase.phase !== "error" || failedStart === undefined) return phase
  const data = failedStart(phase.error)
  return data === null ? phase : { phase: "ready", data, reloadedAt: null }
}

/** The page's own call of the view tool: once on mount, again on the user's retry. */
function usePageCall(
  name: string,
  args: Record<string, unknown>,
  enabled: boolean,
  failedStart: FailedStart | undefined,
): ViewCall {
  const { callTool } = useViewHost()
  const [phase, setPhase] = useState<ViewPhase>({ phase: "waiting" })
  const started = useRef(false)
  const load = useCallback(
    () => loadView(callTool, name, args).then((loaded) => afterFailure(loaded, failedStart)),
    [callTool, name, args, failedStart],
  )
  useEffect(() => {
    // Once per mount; the ref also stops StrictMode's second effect run.
    if (!enabled || started.current) return
    started.current = true
    void load().then(setPhase)
  }, [enabled, load])
  const retry = useCallback(() => {
    setPhase({ phase: "waiting" })
    void load().then(setPhase)
  }, [load])
  return useMemo(() => ({ phase, retry }), [phase, retry])
}

interface PageViewProps {
  name: string
  view: ViewComponent | undefined
  args: Record<string, unknown>
  fill: boolean
  failedStart: FailedStart | undefined
}

function PageViewFrame({ name, view, args, fill, failedStart }: PageViewProps) {
  const call = usePageCall(name, args, view !== undefined, failedStart)
  return <ViewFrame call={call} view={view} fill={fill} />
}

interface PageRootProps {
  name: string | undefined
  view: ViewComponent | undefined
  args: Record<string, unknown>
  frame: PageFrame | undefined
  failedStart: FailedStart | undefined
  host: BrowserHostOptions
}

/** The view in the page's frame, or the frame alone; without a frame the view fills the page. */
function PageBody({ name, frame: Frame, ...view }: Omit<PageRootProps, "host">) {
  if (Frame === undefined) {
    return <PageViewFrame name={name ?? ""} {...view} fill />
  }
  if (name === undefined) return <Frame />
  return (
    <Frame>
      <PageViewFrame name={name} {...view} fill={false} />
    </Frame>
  )
}

/** The provider order is `ViewRoot`'s: the host first, then the providers every root shares. */
function PageRoot({ host, ...body }: PageRootProps) {
  return (
    <StrictMode>
      <BrowserViewHost options={host}>
        <ViewProviders>
          <PageBody {...body} />
        </ViewProviders>
      </BrowserViewHost>
    </StrictMode>
  )
}

/**
 * Mounts the view `options.view` names from `views` on a page outside a chat, in the page's frame
 * where it brings one; an unknown name renders the "can't show" state. A page whose frame renders
 * alone hands no caller (`FramePageOptions`). Returns the unmount.
 */
export function mountPage(
  views: ViewMap,
  options: MountPageOptions | FramePageOptions,
): () => void {
  const { view: name, args = NO_ARGS, container, frame, callTool, failedStart, ...rest } = options
  const host: BrowserHostOptions = { ...rest, callTool: callTool ?? NO_VIEW_CALLS }
  const view = name !== undefined && Object.hasOwn(views, name) ? views[name] : undefined
  const root = createRoot(container ?? rootElement())
  root.render(
    <ViewErrorBoundary>
      <PageRoot
        name={name}
        view={view}
        args={args}
        frame={frame}
        failedStart={failedStart}
        host={host}
      />
    </ViewErrorBoundary>,
  )
  return () => root.unmount()
}
