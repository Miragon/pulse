import type { WebSessionInfo } from "@miragon/pulse-widget-shell/widgets"
import type { PageNotices } from "../notices.js"

/** What a page with a session puts into its frame, whichever view it shows. */
export interface SessionPage {
  readonly session: WebSessionInfo
  readonly notices: PageNotices
  /** The page and its query as the address names them now, where a sign-in from the notice comes back to. */
  readonly returnTo: () => string
  /** Signs out; false where it did not go through. */
  readonly signOut: () => Promise<boolean>
  /** Leaves the page for `url`. */
  readonly assign: (url: string) => void
}
