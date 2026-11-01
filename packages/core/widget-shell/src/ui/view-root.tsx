/**
 * The bundle root (the second widget-shell file that imports `mcp-use/react`; the other is
 * `mcp-use-host.tsx`). `mountViews` picks the view the document's prelude names; `mountView`
 * mounts one view without a map, the entry a per-view build would call.
 */
import { StrictMode, useState } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { ToastProvider, ICON_STROKE } from "@miragon/pulse-ui"
import { LucideProvider } from "lucide-react"
import { bootstrapView } from "mcp-use/react"
import { readViewName } from "../view-name.js"
import { installCallObserver, type CallObserver } from "./call-observer.js"
import { SHELL_VIEW_CONFIG } from "./display-mode-toggle.js"
import { HostDocument } from "./host-document.js"
import { HostWidgetsProvider, type HostWidgets } from "./host-widgets.js"
import { McpUseViewHost, useMcpUseViewCall } from "./mcp-use-host.js"
import { ProfileGate } from "./profile-gate.js"
import { createViewQueryClient } from "./tool-query.js"
import { ViewFrame } from "./view-frame.js"
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

/** One view, no map: the observer listens BEFORE the runtime connects, so it sees every notification. */
export function mountView(options: MountViewOptions): void {
  const observer = installCallObserver()
  bootstrapView({
    default: () => <ViewRoot {...options} observer={observer} />,
    viewConfig: SHELL_VIEW_CONFIG,
  })
}

/** The view the document's prelude names; an unknown name renders the "can't show" state. */
export function mountViews({ views, hostWidgets }: MountViewsOptions): void {
  const name = readViewName()
  const view = name !== undefined && Object.hasOwn(views, name) ? views[name] : undefined
  mountView({ name, view, hostWidgets })
}

function McpUseViewFrame({
  name,
  view,
  observer,
}: Omit<MountViewOptions, "hostWidgets"> & { observer: CallObserver | null }) {
  return <ViewFrame call={useMcpUseViewCall(name, observer)} view={view} />
}

/**
 * The provider order is load-bearing: the host first (every hook below reads it), ONE query client
 * per document, the document layer (theme, fonts, the inline budget box), the gate that resolves
 * the locale from the profile feed, then the kit's icon stroke and toasts.
 */
export function ViewRoot({
  name,
  view,
  hostWidgets,
  observer,
}: MountViewOptions & { observer: CallObserver | null }) {
  const [client] = useState(createViewQueryClient)
  return (
    <StrictMode>
      <McpUseViewHost>
        <QueryClientProvider client={client}>
          <HostDocument>
            <ProfileGate>
              <LucideProvider strokeWidth={ICON_STROKE}>
                <ToastProvider>
                  <HostWidgetsProvider widgets={hostWidgets ?? NO_WIDGETS}>
                    <McpUseViewFrame name={name} view={view} observer={observer} />
                  </HostWidgetsProvider>
                </ToastProvider>
              </LucideProvider>
            </ProfileGate>
          </HostDocument>
        </QueryClientProvider>
      </McpUseViewHost>
    </StrictMode>
  )
}
