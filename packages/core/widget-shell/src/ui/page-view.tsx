/**
 * A view of a page outside a chat, where the page's own app puts it (its frame, its router): the
 * view calls its view tool through the page's caller and runs under the providers `mountApp`
 * mounts, so every widget runs as in a chat. The page's address for the view, if it keeps one, is
 * the view's own (`ViewHost.location`), so a page that shows another view starts it with its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { decodeToolResult } from "../protocol/tool-result.js"
import { isViewData, type ViewCall, type ViewPhase } from "./view-call.js"
import { ViewFrame } from "./view-frame.js"
import { useViewHost, ViewHostProvider, type ViewHost, type ViewLocation } from "./view-host.js"
import type { ViewComponent, ViewMap } from "./views.js"

/** The view's data for a start that failed with `error`, or null for the frame's error state. */
export type FailedStart = (error: Error) => object | null

export interface PageViewProps {
  /** The page's views; `view` names one of them. */
  readonly views: ViewMap
  /**
   * The view to show: its view tool's name, a key of `views`. An unknown one renders the "can't
   * show" state and calls no tool.
   */
  readonly view: string
  /**
   * The view tool's arguments, as a chat's call would pass them. Another view or other arguments
   * start the view anew: a new call of its tool, its state reset.
   */
  readonly args?: Readonly<Record<string, unknown>>
  /**
   * The page's address for this view: the view reports each move and goes where Back and Forward
   * lead (`ViewHost.location`). Without one the view moves on screen alone.
   */
  readonly location?: ViewLocation
  /**
   * The view's data for a start whose view tool failed, where the view shows that failure in its
   * own place (the cockpit keeps its head over the route that failed to read its engine); null
   * leaves the failure to the frame's error state, as without this option.
   */
  readonly failedStart?: FailedStart
  /**
   * Whether the view fills the viewport, as a chat's fullscreen view does (a page without its own
   * layout), or takes its content's height in the page's layout (the default).
   */
  readonly fill?: boolean
}

const NO_ARGS: Readonly<Record<string, unknown>> = {}

/** The view tool's result as the frame shows it: the view's data, or why it is missing. */
async function loadView(
  callTool: ViewHost["callTool"],
  name: string,
  args: Readonly<Record<string, unknown>>,
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
  args: Readonly<Record<string, unknown>>,
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

interface StartedViewProps {
  readonly name: string
  readonly view: ViewComponent | undefined
  readonly args: Readonly<Record<string, unknown>>
  readonly fill: boolean
  readonly failedStart: FailedStart | undefined
}

/** One start of the view: its call, then its phases in the view frame. */
function StartedView({ name, view, args, fill, failedStart }: StartedViewProps) {
  const call = usePageCall(name, args, view !== undefined, failedStart)
  return <ViewFrame call={call} view={view} fill={fill} />
}

/** The page's host, its address the one of this view. */
function AtLocation({ location, children }: { location: ViewLocation; children: ReactNode }) {
  const host = useViewHost()
  const located = useMemo<ViewHost>(() => ({ ...host, location }), [host, location])
  return <ViewHostProvider host={located}>{children}</ViewHostProvider>
}

/**
 * Shows the view `view` names from `views`, called through the page's caller with `args`, where
 * the page's app renders it (under `mountApp`, whose host and providers it needs). Each start is
 * its own: another view or other arguments mount it anew, and a page that starts the same one again
 * gives it another React `key`.
 */
export function PageView({
  views,
  view,
  args = NO_ARGS,
  location,
  failedStart,
  fill = false,
}: PageViewProps) {
  const component = Object.hasOwn(views, view) ? views[view] : undefined
  const started = (
    <StartedView
      key={`${view} ${JSON.stringify(args)}`}
      name={view}
      view={component}
      args={args}
      fill={fill}
      failedStart={failedStart}
    />
  )
  return location === undefined ? started : <AtLocation location={location}>{started}</AtLocation>
}
