import { useCallback, useMemo, useSyncExternalStore, type ComponentType } from "react"
import { PageView, type ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { cockpitAfterFailedStart } from "@miragon/pulse-engine-connector/widgets"
import { SessionFrame, type SessionPage } from "./frame.js"
import type { PageRouter } from "./router/router.js"
import { viewsAt } from "./unknown-engine.js"

/** What the page with a session is made of: its router, its views and what its frame shows. */
export interface PageAppParts {
  readonly router: PageRouter
  readonly views: ViewMap
  readonly page: SessionPage
}

/**
 * The page with a session: its frame around the view its address names, at the start its router
 * gives (`PageView`, mounted anew at each start of the router's), the view's address the router's
 * too. A start that failed for its engine keeps the cockpit's head over the route that says so
 * (`cockpitAfterFailedStart`); a refusal no retry changes stays the frame's, and an engine's own
 * address that names an engine the server does not configure is refused in the view's place
 * (`viewsAt`).
 */
function PageApp({ router, views, page }: PageAppParts) {
  const { route, shown } = useSyncExternalStore(router.subscribe, router.state)
  const { start, location, generation } = shown
  const failedStart = useCallback(
    (error: Error) => cockpitAfterFailedStart(start.args, error),
    [start],
  )
  const shownViews = useMemo(() => viewsAt(views, start), [views, start])
  return (
    <SessionFrame page={page} title={route.title} navigate={router.navigate}>
      <PageView
        key={generation}
        views={shownViews}
        view={start.view}
        args={start.args}
        location={location}
        failedStart={failedStart}
      />
    </SessionFrame>
  )
}

/** The page's app for `mountApp`. */
export function pageApp(parts: PageAppParts): ComponentType {
  return function Page() {
    return <PageApp {...parts} />
  }
}
