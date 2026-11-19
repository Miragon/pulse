/**
 * The app root: a page's own app outside a chat (the web app), without ext-apps' `App`. The page
 * brings its app (its frame, its router, what it shows) and its caller of the server's tools; the
 * app runs under the browser adapter of the view host and the providers every root shares, and
 * shows a view where it wants one with `PageView`. The root itself calls no tool.
 */
import { StrictMode, type ComponentType } from "react"
import { createRoot } from "react-dom/client"
import { BrowserViewHost, type BrowserHostOptions, type ToolCaller } from "./browser-view-host.js"
import { ViewErrorBoundary } from "./view-error-boundary.js"
import { rootElement, ViewProviders } from "./view-providers.js"

export interface MountAppOptions extends Omit<BrowserHostOptions, "callTool"> {
  /**
   * The page's caller of the server's tools. A page without one (a signed-out page, say) calls
   * none: a tool its app asks for anyway is refused.
   */
  callTool?: ToolCaller
  /** Where the page mounts its app; default: the document's `#root`, created where it has none. */
  container?: HTMLElement
}

/** The caller of a page that calls no tool: it says so to an app that asks. */
const NO_CALLS: ToolCaller = () =>
  Promise.reject(new Error("This page shows no view, so it calls no tool."))

/** The provider order is `ViewRoot`'s: the host first, then the providers every root shares. */
function AppRoot({ App, host }: { App: ComponentType; host: BrowserHostOptions }) {
  return (
    <StrictMode>
      <BrowserViewHost options={host}>
        <ViewProviders>
          <App />
        </ViewProviders>
      </BrowserViewHost>
    </StrictMode>
  )
}

/**
 * Mounts the page's app `App` outside a chat: under the browser adapter (its tools through
 * `options.callTool`, the theme from the document or the OS, the page's locale, no model context,
 * no write) and one query client for the whole page, so what the app reads beside a view shares the
 * view's cache. Returns the unmount.
 */
export function mountApp(App: ComponentType, options: MountAppOptions = {}): () => void {
  const { container, callTool, ...rest } = options
  const host: BrowserHostOptions = { ...rest, callTool: callTool ?? NO_CALLS }
  const root = createRoot(container ?? rootElement())
  root.render(
    <ViewErrorBoundary>
      <AppRoot App={App} host={host} />
    </ViewErrorBoundary>,
  )
  return () => root.unmount()
}
