import {
  mountPage,
  readWebSession,
  WEB_PATHS,
  webToolCaller,
  type MountPageOptions,
  type ViewMap,
  type WebSessionInfo,
} from "@miragon/pulse-widget-shell/widgets"
import { cockpitAfterFailedStart } from "@miragon/pulse-engine-connector/widgets"
import { sessionFrame } from "./frame.js"
import { PageNotices } from "./notices.js"
import { endedFrame, unreachableFrame } from "./page-states.js"
import { routeOf, type PageLocation } from "./routes.js"
import { signedOutFrame } from "./signed-out.js"
import { signOut } from "./sign-out.js"

/** What the page starts from: its views, its location and the browser's hands. */
export interface PageEnv {
  readonly views: ViewMap
  readonly location: PageLocation & { readonly origin: string }
  readonly fetch: typeof fetch
  readonly assign: (url: string) => void
  readonly reload: () => void
  /** Where the page mounts; default: the document's `#root`. */
  readonly container?: HTMLElement
}

/**
 * What every page hands `mountPage`: Geist from the server's own origin, no hand-offs, and `/app`
 * as the start page a refused start links to.
 */
function pageBase(
  env: PageEnv,
): Pick<MountPageOptions, "publicBase" | "followUp" | "startPage" | "container"> {
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

/**
 * Starts the page at its location: the signed-out page needs no session; any other page reads the
 * session first and shows its view in the frame, its calls posted with the session's CSRF token. A
 * page that finds no session says so and offers the sign-in back to it, one that cannot read it
 * offers to try again; neither shows a view, so neither hands a caller. A start that failed for
 * its engine keeps the cockpit's head over the route that says so (`cockpitAfterFailedStart`).
 * Returns the unmount.
 */
export async function startPage(env: PageEnv): Promise<() => void> {
  const route = routeOf(env.location)
  const base = pageBase(env)
  if (route.kind === "signed-out") {
    return mountPage(env.views, { ...base, frame: signedOutFrame(route.reason) })
  }
  const returnTo = `${env.location.pathname}${env.location.search}`
  const session = await sessionOf(env)
  if (session === null) {
    return mountPage(env.views, { ...base, frame: unreachableFrame(env.reload) })
  }
  if (session === undefined) {
    return mountPage(env.views, { ...base, frame: endedFrame(returnTo) })
  }
  const notices = new PageNotices()
  const callTool = webToolCaller(session, {
    fetch: env.fetch,
    onSignedOut: () => notices.show("ended"),
  })
  const frame = sessionFrame({
    session,
    notices,
    title: route.title,
    returnTo,
    assign: env.assign,
    signOut: () => signOut(session.csrf, { ...env, origin: env.location.origin }),
  })
  return mountPage(env.views, {
    ...base,
    view: route.view,
    args: route.args,
    callTool,
    frame,
    failedStart: (error) => cockpitAfterFailedStart(route.args, error),
  })
}
