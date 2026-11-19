import type { ViewLocation, ViewPlace } from "@miragon/pulse-widget-shell/widgets"
import { routeOf, urlOf, type PageLocation } from "./routes.js"

/** What the page uses of the browser's history: the entry's state and the two writes. */
export interface PageHistory {
  readonly state: unknown
  pushState(data: unknown, unused: string, url: string): void
  replaceState(data: unknown, unused: string, url: string): void
}

/** The browser's hands the page's address takes: its location, its history, Back and Forward. */
export interface AddressEnv {
  /** Read when the reader goes Back or Forward, so the live one (`window.location`). */
  readonly location: PageLocation
  readonly history: PageHistory
  /** Subscribes to Back and Forward (`popstate`); returns the unsubscribe. */
  readonly onPopState: (listener: () => void) => () => void
  /** Loads the address anew: an entry no view goes to itself. */
  readonly reload: () => void
}

/**
 * The page's address, which follows the cockpit (N1): each place it reports becomes the address
 * `routeOf` reads back to it (`urlOf`), a drill a new entry of the browser's history, the first
 * place and a move inside a view the current one, the cockpit's memo of its trail kept with the
 * entry. Back and Forward hand the view the entry's place and memo; an entry no view goes to itself
 * (a page that shows a failure, a place the cockpit does not have) loads anew, and the server says
 * what it says to that address. `start` is where the address put the view beyond the view tool's
 * arguments (the cross-engine overview's page). Returns the address and its unsubscribe.
 */
export function pageAddress(
  env: AddressEnv,
  start?: Readonly<Record<string, unknown>>,
): { location: ViewLocation; stop: () => void } {
  const followers = new Set<(place: ViewPlace) => boolean>()
  const stop = env.onPopState(() => {
    const route = routeOf(env.location)
    if (route.kind === "view") {
      const place: ViewPlace = { args: route.place ?? route.args, memo: env.history.state }
      for (const go of followers) if (go(place)) return
    }
    env.reload()
  })
  const location: ViewLocation = {
    ...(start === undefined ? {} : { start: { args: start } }),
    report: ({ args, memo }, entry) => {
      const url = urlOf(args)
      const kept = memo ?? null
      const here = `${env.location.pathname}${env.location.search}`
      // One entry per address: the same place again names the entry the reader is on.
      if (entry === "push" && url !== here) env.history.pushState(kept, "", url)
      else env.history.replaceState(kept, "", url)
    },
    subscribe: (go) => {
      followers.add(go)
      return () => {
        followers.delete(go)
      }
    },
  }
  return { location, stop }
}
