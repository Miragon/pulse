/**
 * The page root: one view on a plain page outside a chat, without ext-apps' `App`. It is the app
 * root (`mountApp`) with one `PageView` as its app, in the page's frame where it brings one: the
 * page calls the view tool itself through the caller it hands in, and the view runs under the same
 * providers as in a chat, so every widget runs unchanged. A page with an app of its own (a router,
 * views it changes) mounts that app with `mountApp` and shows its views with `PageView`.
 */
import type { ComponentType, ReactNode } from "react"
import { mountApp, type MountAppOptions } from "./app-root.js"
import type { BrowserHostOptions } from "./browser-view-host.js"
import { PageView, type FailedStart } from "./page-view.js"
import type { ViewLocation } from "./view-host.js"
import type { ViewMap } from "./views.js"

/** A page's own frame around its view: the view, if the page shows one, is its `children`. */
export type PageFrame = ComponentType<{ children?: ReactNode }>

export interface MountPageOptions extends BrowserHostOptions, Pick<MountAppOptions, "client"> {
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
   * The page's address for the view, which follows where it is: the view reports each move, and
   * Back and Forward lead it back (`PageView`'s `location`). Without one the address stays where
   * the page started.
   */
  location?: ViewLocation
  /**
   * The view's data for a start whose view tool failed, where the view shows that failure in its
   * own place; null leaves the failure to the frame's error state, as without this option.
   */
  failedStart?: FailedStart
}

/**
 * A page whose frame renders alone (a signed-out page, say): no view, so no caller. Its frame runs
 * under the same providers and host as a view's would; a tool it asks for anyway is refused.
 */
export interface FramePageOptions
  extends Omit<BrowserHostOptions, "callTool">, Pick<MountAppOptions, "client"> {
  view?: undefined
  args?: undefined
  container?: HTMLElement
  /** The page's chrome, alone: see {@link MountPageOptions.frame}. */
  frame: PageFrame
  callTool?: undefined
  location?: undefined
  failedStart?: undefined
}

interface PageBodyProps {
  readonly views: ViewMap
  readonly name: string | undefined
  readonly args: Record<string, unknown> | undefined
  readonly frame: PageFrame | undefined
  readonly location: ViewLocation | undefined
  readonly failedStart: FailedStart | undefined
}

/** The view in the page's frame, or the frame alone; without a frame the view fills the page. */
function PageBody({ views, name, args, frame: Frame, location, failedStart }: PageBodyProps) {
  const view = { views, args, location, failedStart }
  if (Frame === undefined) return <PageView {...view} view={name ?? ""} fill />
  if (name === undefined) return <Frame />
  return (
    <Frame>
      <PageView {...view} view={name} />
    </Frame>
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
  const { view: name, args, frame, failedStart, location, ...host } = options
  const body = { views, name, args, frame, location, failedStart }
  return mountApp(() => <PageBody {...body} />, host)
}
