/**
 * The bundle root. `mountViews` picks the view the document's prelude names; `mountView` mounts one
 * view without a map, the entry a per-view build would call.
 */
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { readViewName } from "../protocol/view-name.js"
import { SHELL_VIEW_CONFIG } from "./display-mode-toggle.js"
import { ExtAppsViewHost, useViewCall } from "./ext-apps-host.js"
import { ViewErrorBoundary } from "./view-error-boundary.js"
import { ViewFrame } from "./view-frame.js"
import { rootElement, ViewProviders } from "./view-providers.js"
import { createViewRuntime, type ViewRuntime } from "./view-runtime.js"
import type { ViewComponent, ViewMap } from "./views.js"

export interface MountViewOptions {
  /** The view's name (= its show tool's name); the stripped-result recovery re-runs it. */
  name: string | undefined
  view: ViewComponent | undefined
}

export interface MountViewsOptions {
  views: ViewMap
}

/** One view, no map: the handlers sit on the `App` before it connects, so none misses a notification. */
export function mountView(options: MountViewOptions): void {
  const runtime = createViewRuntime(SHELL_VIEW_CONFIG)
  void runtime.connect().catch((error: unknown) => {
    console.error("[pulse] Failed to connect the view runtime:", error)
  })
  createRoot(rootElement()).render(
    <ViewErrorBoundary>
      <ViewRoot {...options} runtime={runtime} />
    </ViewErrorBoundary>,
  )
}

/** The view the document's prelude names; an unknown name renders the "can't show" state. */
export function mountViews({ views }: MountViewsOptions): void {
  const name = readViewName()
  const view = name !== undefined && Object.hasOwn(views, name) ? views[name] : undefined
  mountView({ name, view })
}

function RootViewFrame({ name, view }: MountViewOptions) {
  return <ViewFrame call={useViewCall(name)} view={view} />
}

/**
 * The provider order is load-bearing: the host first (every hook below reads it), then the
 * providers every root shares (`ViewProviders`: ONE query client per document, the document layer,
 * the locale gate, the icon stroke and toasts).
 */
export function ViewRoot({ name, view, runtime }: MountViewOptions & { runtime: ViewRuntime }) {
  return (
    <StrictMode>
      <ExtAppsViewHost runtime={runtime}>
        <ViewProviders>
          <RootViewFrame name={name} view={view} />
        </ViewProviders>
      </ExtAppsViewHost>
    </StrictMode>
  )
}
