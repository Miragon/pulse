import {
  mountApp,
  readWebSession,
  WEB_PATHS,
  webToolCaller,
  type MountAppOptions,
  type ViewMap,
  type WebSessionInfo,
} from "@miragon/pulse-widget-shell/widgets"
import { pageApp } from "./app.js"
import { engineLanes } from "./engine-lanes.js"
import { PageNotices } from "./notices.js"
import { endedFrame, unreachableFrame } from "./page-states.js"
import { createPageRouter, type RouterEnv } from "./router/router.js"
import { routeOf, type PageLocation } from "./router/routes.js"
import { signedOutFrame } from "./signed-out.js"
import { signOut } from "./sign-out.js"

/** What the page starts from: its views, its location and the browser's hands. */
export interface PageEnv extends RouterEnv {
  readonly views: ViewMap
  /** The live location (`window.location`): the address follows the view as the reader moves. */
  readonly location: PageLocation & { readonly origin: string }
  readonly fetch: typeof fetch
  readonly assign: (url: string) => void
  /** Where the page mounts; default: the document's `#root`. */
  readonly container?: HTMLElement
}

/**
 * What every page hands `mountApp`: Geist from the server's own origin, no hand-offs, and `/app`
 * as the start page a refused start links to.
 */
function pageBase(env: PageEnv): MountAppOptions {
  return {
    publicBase: env.location.origin,
    followUp: "none",
    startPage: WEB_PATHS.app,
    ...(env.container === undefined ? {} : { container: env.container }),
  }
}

/** The session, `undefined` without one, `null` where it could not be read. */
async function sessionOf(env: PageEnv): Promise<WebSessionInfo | undefined | null> {
  try {
    return await readWebSession({ fetch: env.fetch })
  } catch {
    return null
  }
}

/** The page and its query as the address names them now, where a sign-in comes back to. */
const hereOf = ({ pathname, search }: PageLocation): string => `${pathname}${search}`

/**
 * Starts the page at its location: the signed-out page needs no session; any other page names its
 * view canonically first (an old address gives way to the view's own, in the same entry of the
 * browser's history), reads the session and shows its view in the frame, its calls posted with the
 * session's CSRF token, the reads across engines one at a time per engine (`engineLanes`), the page
 * navigating itself (`createPageRouter`). A page that finds no session says so and offers the
 * sign-in back to its address, one that cannot read it offers to try again; neither shows a view,
 * so neither hands a caller. Returns the unmount.
 */
export async function startPage(env: PageEnv): Promise<() => void> {
  const route = routeOf(env.location)
  const base = pageBase(env)
  if (route.kind === "signed-out") return mountApp(signedOutFrame(route.reason), base)
  if (route.url !== hereOf(env.location)) {
    env.history.replaceState(env.history.state, "", route.url)
  }
  const session = await sessionOf(env)
  if (session === null) return mountApp(unreachableFrame(env.reload), base)
  if (session === undefined) return mountApp(endedFrame(route.url), base)
  const notices = new PageNotices()
  const callTool = engineLanes(
    webToolCaller(session, { fetch: env.fetch, onSignedOut: () => notices.show("ended") }),
  )
  const router = createPageRouter(env, route)
  const page = {
    session,
    notices,
    returnTo: () => hereOf(env.location),
    assign: env.assign,
    signOut: () => signOut(session.csrf, { ...env, origin: env.location.origin }),
  }
  const unmount = mountApp(pageApp({ router, views: env.views, page }), { ...base, callTool })
  return () => {
    router.stop()
    unmount()
  }
}
