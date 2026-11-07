/**
 * The bundle root. `mountViews` picks the view the document's prelude names; `mountView` mounts one
 * view without a map, the entry a per-view build would call.
 */
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { ToastProvider, ICON_STROKE } from "@miragon/pulse-ui"
import { LucideProvider } from "lucide-react"
import { readViewName } from "../protocol/view-name.js"
import { SHELL_VIEW_CONFIG } from "./display-mode-toggle.js"
import { HostDocument } from "./host-document.js"
import { HostWidgetsProvider, type HostWidgets } from "./host-widgets.js"
import { ExtAppsViewHost, useViewCall } from "./ext-apps-host.js"
import { LocaleGate } from "./locale-gate.js"
import { createViewQueryClient } from "./tool-query.js"
import { ViewErrorBoundary } from "./view-error-boundary.js"
import { ViewFrame } from "./view-frame.js"
import { createViewRuntime, type ViewRuntime } from "./view-runtime.js"
import type { ViewComponent, ViewMap } from "./views.js"

export interface MountViewOptions {
  /** The view's name (= its show tool's name); the stripped-result recovery re-runs it. */
  name: string | undefined
  view: ViewComponent | undefined
  hostWidgets?: HostWidgets
}

export interface MountViewsOptions {
  views: ViewMap
  hostWidgets?: HostWidgets
}

const NO_WIDGETS: HostWidgets = {}

/** One view, no map: the handlers sit on the `App` before it connects, so none misses a notification. */
export function mountView(options: MountViewOptions): void {
  const runtime = createViewRuntime(SHELL_VIEW_CONFIG)
  void runtime.connect().catch((error: unknown) => {
    console.error("[pulse] Failed to connect the view runtime:", error)
  })
  let container = document.getElementById("root")
  if (!container) {
    container = document.createElement("div")
    container.id = "root"
    document.body.appendChild(container)
  }
  createRoot(container).render(
    <ViewErrorBoundary>
      <ViewRoot {...options} runtime={runtime} />
    </ViewErrorBoundary>,
  )
}

/** The view the document's prelude names; an unknown name renders the "can't show" state. */
export function mountViews({ views, hostWidgets }: MountViewsOptions): void {
  const name = readViewName()
  const view = name !== undefined && Object.hasOwn(views, name) ? views[name] : undefined
  mountView({ name, view, hostWidgets })
}

function RootViewFrame({ name, view }: Omit<MountViewOptions, "hostWidgets">) {
  return <ViewFrame call={useViewCall(name)} view={view} />
}

/**
 * The provider order is load-bearing: the host first (every hook below reads it), ONE query client
 * per document, the document layer (theme, fonts, the inline budget box), the gate that resolves
 * the locale from the host context, then the kit's icon stroke and toasts.
 */
export function ViewRoot({
  name,
  view,
  hostWidgets,
  runtime,
}: MountViewOptions & { runtime: ViewRuntime }) {
  const [client] = useState(createViewQueryClient)
  return (
    <StrictMode>
      <ExtAppsViewHost runtime={runtime}>
        <QueryClientProvider client={client}>
          <HostDocument>
            <LocaleGate>
              <LucideProvider strokeWidth={ICON_STROKE}>
                <ToastProvider>
                  <HostWidgetsProvider widgets={hostWidgets ?? NO_WIDGETS}>
                    <RootViewFrame name={name} view={view} />
                  </HostWidgetsProvider>
                </ToastProvider>
              </LucideProvider>
            </LocaleGate>
          </HostDocument>
        </QueryClientProvider>
      </ExtAppsViewHost>
    </StrictMode>
  )
}
