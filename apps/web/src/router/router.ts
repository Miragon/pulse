import type { ViewLocation, ViewPlace } from "@miragon/pulse-widget-shell/widgets"
import {
  placeKey,
  routeOf,
  urlOf,
  viewRouteOf,
  type PageLocation,
  type PageStart,
  type ViewRoute,
} from "./routes.js"

/** What the page uses of the browser's history: the entry's state and the two writes. */
interface PageHistory {
  readonly state: unknown
  pushState(data: unknown, unused: string, url: string): void
  replaceState(data: unknown, unused: string, url: string): void
}

/** The browser's hands the router takes: its location, its history, Back and Forward. */
export interface RouterEnv {
  /** Read whenever the address moved, so the live one (`window.location`). */
  readonly location: PageLocation
  readonly history: PageHistory
  /** Subscribes to Back and Forward (`popstate`); returns the unsubscribe. */
  readonly onPopState: (listener: () => void) => () => void
  /** Loads the address anew: one that names no view of the page. */
  readonly reload: () => void
}

/** How a move enters the browser's history: a new entry, or the current one named anew. */
type Entry = "push" | "replace"

/**
 * One start of the page's view: where it starts, the address it keeps (`ViewHost.location`, its
 * `start` the start's place) and its count, which every start raises, so the page mounts the view
 * anew even where it starts at the same place again.
 */
interface ShownView {
  readonly start: PageStart
  readonly location: ViewLocation
  readonly generation: number
}

/** What the page shows: the route its address names now, and the start of the view it shows. */
interface RouterState {
  readonly route: ViewRoute
  readonly shown: ShownView
}

/** The web app's own router: the page navigates itself, every view at its canonical address. */
export interface PageRouter {
  /** The state now: stable until the address moves, as `useSyncExternalStore` needs it. */
  readonly state: () => RouterState
  /** Tells `listener` of each move; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void
  /**
   * Goes to `url`, an address of the page, in a new entry of the browser's history (default) or
   * naming the current one anew: the view goes there itself where it can, else the page starts it
   * there. A link of the page follows it so, without loading the page anew.
   */
  readonly navigate: (url: string, entry?: Entry) => void
  /** Lets go of Back and Forward, with the page. */
  readonly stop: () => void
}

/**
 * The router of a page whose address names `first`. The view reports each place it reaches, which
 * becomes its canonical address (`urlOf`; the same place keeps the address the reader is on, an
 * incident's under its instance say): a drill or a section a new entry of the browser's history,
 * its first place and a move inside a view the current one, the view's memo of its trail kept with
 * the entry. When the address moves under the page (Back, Forward, a link of the page), the view
 * gets the entry's place and memo and goes there itself where it can; where it does not, the page
 * starts its view at the entry's start, without loading anew. An address that names no view (the
 * signed-out page's) loads anew. An old address is replaced by its canonical one in its entry.
 */
export function createPageRouter(env: RouterEnv, first: ViewRoute): PageRouter {
  const listeners = new Set<() => void>()
  const followers = new Set<(place: ViewPlace) => boolean>()
  const here = (): string => `${env.location.pathname}${env.location.search}`

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const report: ViewLocation["report"] = ({ args, memo }, entry) => {
    const { route } = state
    const url = placeKey(args) === placeKey(route.place) ? route.url : urlOf(args)
    const kept = memo ?? null
    // One entry per address: the same place again names the entry the reader is on.
    if (entry === "push" && url !== here()) env.history.pushState(kept, "", url)
    else env.history.replaceState(kept, "", url)
    state = { ...state, route: viewRouteOf(env.location) }
    notify()
  }

  const subscribe: ViewLocation["subscribe"] = (go) => {
    followers.add(go)
    return () => {
      followers.delete(go)
    }
  }

  const shownAt = (start: PageStart, generation: number): ShownView => ({
    start,
    generation,
    location: {
      ...(start.place === undefined ? {} : { start: { args: start.place } }),
      report,
      subscribe,
    },
  })

  let state: RouterState = { route: first, shown: shownAt(first.start, 0) }

  /** The address moved under the page: its view goes to the entry, else starts there anew. */
  const follow = (): void => {
    const route = routeOf(env.location)
    if (route.kind === "signed-out") {
      env.reload()
      return
    }
    if (route.url !== here()) env.history.replaceState(env.history.state, "", route.url)
    const place: ViewPlace = { args: route.place, memo: env.history.state }
    const goes = [...followers].some((go) => go(place))
    state = goes
      ? { ...state, route }
      : { route, shown: shownAt(route.start, state.shown.generation + 1) }
    notify()
  }

  const stop = env.onPopState(follow)

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    navigate: (url, entry = "push") => {
      if (entry === "push" && url !== here()) env.history.pushState(null, "", url)
      else env.history.replaceState(null, "", url)
      follow()
    },
    stop,
  }
}
