import type { ViewLocation, ViewPlace } from "@miragon/pulse-widget-shell/widgets"
import {
  placeKey,
  routeOf,
  screenOf,
  urlOf,
  viewRouteOf,
  type PageLocation,
  type PageScreen,
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
 * One start of the page's view: where it starts, the page's own screen where it shows one there
 * (`screen`, the start then the cockpit's for an engine the screen does not serve), the address it
 * keeps (`ViewHost.location`, its `start` the start's place, its `claims` the places the page shows
 * itself) and its count, which every start raises, so the page mounts the view anew even where it
 * starts at the same place again.
 */
interface ShownView {
  readonly start: PageStart
  readonly screen?: PageScreen
  readonly location: ViewLocation
  readonly generation: number
}

/**
 * What the page shows: the route its address names now, the start of the view it shows, and how
 * often the page moved itself (`moves`: a link of the page, Back, Forward, and a drill of the view
 * to a place the page claims; never another move the view reported, nor a screen's own state),
 * which the frame's focus follows.
 */
interface RouterState {
  readonly route: ViewRoute
  readonly shown: ShownView
  readonly moves: number
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
  /**
   * Names the current entry anew with `url`, the page's own screen in another state of its own (a
   * filter, a search): the screen stays, and so does the focus, at the control the reader used.
   */
  readonly refine: (url: string) => void
  /** Lets go of Back and Forward, with the page. */
  readonly stop: () => void
}

/** Whether the page shows the place `args` names with a screen of its own. */
const claims = (args: ViewPlace["args"]): boolean => screenOf(args) !== undefined

/** Whether `other` is the screen `one` is, whatever state of its own each is in. */
const sameScreen = (one: PageScreen, other: PageScreen | undefined): boolean =>
  other !== undefined && one.kind === other.kind && one.engine === other.engine

/**
 * The router of a page whose address names `first`. The view reports each place it reaches, which
 * becomes its canonical address (`urlOf`; the same place keeps the address the reader is on, an
 * incident's under its instance say): a drill or a section a new entry of the browser's history,
 * its first place and a move inside a view the current one, the view's memo of its trail kept with
 * the entry. A place the page shows with a screen of its own (`claims`: an engine's processes)
 * the page takes over where the view reports it, the view rendering nothing there. When the address
 * moves under the page (Back, Forward, a link of the page), the view gets the entry's place and
 * memo and goes there itself where it can, never to a place of the page's own screen; where it does
 * not, the page starts its view or its screen at the entry, without loading anew. The screen's
 * state of its own (its list's filter) rides in the address's query: a change names the current
 * entry anew (`refine`), and a move between two entries of the screen the page shows keeps it,
 * which takes the entry's state. An address that names no view (the signed-out page's) loads anew.
 * An old address is replaced by its canonical one in its entry.
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
    const reached = viewRouteOf(env.location)
    // A place of the page's own screen: the page takes over, the focus on its heading after a drill.
    state = claims(args)
      ? {
          route: reached,
          shown: shownAt(reached, state.shown.generation + 1),
          moves: entry === "push" ? state.moves + 1 : state.moves,
        }
      : { ...state, route: reached }
    notify()
  }

  const subscribe: ViewLocation["subscribe"] = (go) => {
    followers.add(go)
    return () => {
      followers.delete(go)
    }
  }

  const shownAt = ({ start, screen }: ViewRoute, generation: number): ShownView => ({
    start,
    ...(screen === undefined ? {} : { screen }),
    generation,
    location: {
      ...(start.place === undefined ? {} : { start: { args: start.place } }),
      report,
      subscribe,
      claims,
    },
  })

  let state: RouterState = { route: first, shown: shownAt(first, 0), moves: 0 }

  /**
   * The address moved under the page: its view goes to the entry, else starts there anew. The
   * page's own screen, shown at the entry before and still, stays and takes the entry's state of
   * its own (its filter). `moved`: a move of the page, which the focus follows.
   */
  const follow = (moved = true): void => {
    const route = routeOf(env.location)
    if (route.kind === "signed-out") {
      env.reload()
      return
    }
    if (route.url !== here()) env.history.replaceState(env.history.state, "", route.url)
    const moves = moved ? state.moves + 1 : state.moves
    const { shown } = state
    const { screen } = route
    if (
      screen !== undefined &&
      sameScreen(screen, shown.screen) &&
      sameScreen(screen, state.route.screen)
    ) {
      state = { route, shown: { ...shown, screen }, moves }
      notify()
      return
    }
    const place: ViewPlace = { args: route.place, memo: env.history.state }
    // The page's own screen starts anew; another place the view goes to itself where it can.
    const goes = route.screen === undefined && [...followers].some((go) => go(place))
    state = goes
      ? { ...state, route, moves }
      : { route, shown: shownAt(route, shown.generation + 1), moves }
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
    refine: (url) => {
      env.history.replaceState(env.history.state, "", url)
      follow(false)
    },
    stop,
  }
}
