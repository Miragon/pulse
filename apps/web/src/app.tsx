import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react"
import type { InstanceListFilterData, ProcessFilterData } from "@miragon/pulse-screens"
import { PageView, type ViewLocation, type ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { cockpitAfterFailedStart } from "@miragon/pulse-engine-connector/widgets"
import { PAGE_CHROME } from "./frame/drawer.js"
import { SessionFrame } from "./frame/session-frame.js"
import type { SessionPage } from "./frame/session-page.js"
import { useT } from "./messages/index.js"
import type { PageRouter } from "./router/router.js"
import { screenOf, screenUrlOf, type InstanceTab, type PageScreen } from "./router/routes.js"
import { EngineRoute } from "./screens/engine/engine-route.js"
import { IncidentRoute, InstanceRoute } from "./screens/instance/instance-route.js"
import { ProcessRoute } from "./screens/process/process-route.js"
import type { VersionMove } from "./screens/process/process-screen.js"
import { useScreenShown } from "./screens/screen-shown.js"
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
 * too, and the page's chrome its own (`PAGE_CHROME`: the page navigates itself, so the cockpit
 * leaves its head to the frame's navigation and shows the frame's menu first in its bar). A start
 * that failed for its engine keeps the cockpit on that engine over the route that says so
 * (`cockpitAfterFailedStart`), the navigation keeping the engine open with its sections; a refusal
 * no retry changes stays the frame's, and an engine's own address that names an engine the server
 * does not configure is refused in the view's place (`viewsAt`). Where the page shows the place
 * with a screen of its own (an engine's processes, a process, an instance, an incident under its
 * instance),
 * the screen stands in the view's place, the cockpit's view its fallback for an engine the screens
 * do not serve, and the frame fills the window's height for it from 64rem on (`fill`); its state
 * rides in the address (the router's `refine`: a filter, a tab), and the view names an engine's
 * processes in its trail by the navigation's word and the list of a process's instances, which
 * the page shows as the process's screen, by the process (`ViewLocation.nameOf`).
 */
function PageApp({ router, views, page }: PageAppParts) {
  const { route, shown, moves } = useSyncExternalStore(router.subscribe, router.state)
  const { start, screen, location, generation } = shown
  const t = useT()
  const named = useMemo<ViewLocation>(
    () => ({
      ...location,
      nameOf: (args) => {
        const screen = screenOf(args)
        if (screen?.kind === "engine") return t("nav.section.processes")
        // The list of a process's instances is the process's screen here: its trail names the process.
        return screen?.kind === "process" && args.view === "process-instances"
          ? screen.process
          : undefined
      },
    }),
    [location, t],
  )
  const failedStart = useCallback(
    (error: Error) => cockpitAfterFailedStart(start.args, error),
    [start],
  )
  const shownViews = useMemo(() => viewsAt(views, start), [views, start])
  // A screen of the page's fills the window from 64rem on; the cockpit's view in its place does not.
  const fill =
    useScreenShown(screen?.engine, screen?.kind === "incident" ? "incidents" : "processes") !==
    "fallback"
  const view = (
    <PageView
      key={generation}
      views={shownViews}
      view={start.view}
      args={start.args}
      location={named}
      chrome={PAGE_CHROME}
      failedStart={failedStart}
    />
  )
  return (
    <SessionFrame
      page={page}
      place={route.place}
      title={route.title}
      moves={moves}
      navigate={router.navigate}
      fill={fill}
    >
      {screen === undefined ? (
        view
      ) : (
        <PageScreenAt key={generation} screen={screen} router={router} fallback={view} />
      )}
    </SessionFrame>
  )
}

/**
 * The page's own screen at its place (`screen`), each deciding on the frame's one read of the engine
 * list whether it serves the engine, else the cockpit's view the page starts there (`fallback`): an
 * engine's processes, its filter the address's; an instance, its tab the address's and one of its
 * root incidents in focus at the address of that incident; an incident known by its id alone, which
 * the page leads on to the instance that holds its root; a process in one version, its version and its
 * list's filter the address's, another version a new entry of the page's history (a pick in the
 * picker keeps the focus there, the older versions' notice moves it to the heading).
 */
function PageScreenAt({
  screen,
  router,
  fallback,
}: {
  screen: PageScreen
  router: PageRouter
  fallback: ReactNode
}) {
  switch (screen.kind) {
    case "engine":
      return (
        <EngineRoute
          engine={screen.engine}
          navigate={router.navigate}
          filter={screen.filter}
          onFilter={(filter: ProcessFilterData) => {
            router.refine(screenUrlOf({ ...screen, filter }))
          }}
          fallback={fallback}
        />
      )
    case "process":
      return (
        <ProcessRoute
          engine={screen.engine}
          process={screen.process}
          {...(screen.version === undefined ? {} : { version: screen.version })}
          filter={screen.filter}
          navigate={router.navigate}
          onFilter={(filter: InstanceListFilterData) => {
            router.refine(screenUrlOf({ ...screen, filter }))
          }}
          onVersion={(version: number, filter: InstanceListFilterData, move: VersionMove) => {
            const url = screenUrlOf({ ...screen, version, filter })
            // A pick keeps the reader at the picker; the notice's way leads to the new heading.
            if (move === "pick") router.refine(url, "push")
            else router.navigate(url)
          }}
          fallback={fallback}
        />
      )
    case "instance":
      return (
        <InstanceRoute
          engine={screen.engine}
          instance={screen.instance}
          {...(screen.tab === undefined ? {} : { tab: screen.tab })}
          {...(screen.incident === undefined ? {} : { incident: screen.incident })}
          navigate={router.navigate}
          onTab={(tab: InstanceTab) => {
            router.refine(screenUrlOf({ ...screen, tab }))
          }}
          fallback={fallback}
        />
      )
    case "incident":
      return (
        <IncidentRoute
          engine={screen.engine}
          incident={screen.incident}
          navigate={router.navigate}
          fallback={fallback}
        />
      )
  }
}

/** The page's app for `mountApp`. */
export function pageApp(parts: PageAppParts): ComponentType {
  return function Page() {
    return <PageApp {...parts} />
  }
}
