import { WEB_CSRF_HEADER, WEB_PATHS, type WebSignOut } from "@miragon/pulse-widget-shell/widgets"

/** What a sign-out sends with and where it sends the browser. */
export interface SignOutEnv {
  readonly fetch: typeof fetch
  /** Leaves the page for `url` (the page's `location.assign`). */
  readonly assign: (url: string) => void
  /** The page's origin, against which the answer's next place is read. */
  readonly origin: string
}

/** The answer's next place, where it is a web address: never a script URL. */
function nextPlace(answer: Partial<WebSignOut>, origin: string): string | undefined {
  if (typeof answer.location !== "string") return undefined
  let url: URL
  try {
    url = new URL(answer.location, origin)
  } catch {
    return undefined
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined
}

/**
 * Signs out: a POST of the page with the session's CSRF token to the logout route, which ends the
 * session and names where the browser goes next (the identity provider's end of its session, else
 * the signed-out page), then there. A session the server no longer holds goes to the signed-out
 * page too. Resolves false where the sign-out did not go through, and the page stays.
 */
export async function signOut(csrf: string, env: SignOutEnv): Promise<boolean> {
  let response: Response
  try {
    response = await env.fetch(WEB_PATHS.logout, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", [WEB_CSRF_HEADER]: csrf },
    })
  } catch {
    return false
  }
  if (response.status === 401) {
    env.assign(WEB_PATHS.signedOut)
    return true
  }
  if (!response.ok) return false
  const answer = (await response.json().catch(() => ({}))) as Partial<WebSignOut>
  const next = nextPlace(answer, env.origin)
  if (next === undefined) return false
  env.assign(next)
  return true
}
