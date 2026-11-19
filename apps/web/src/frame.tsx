import { useState, useSyncExternalStore, type ReactNode } from "react"
import { Button, Icon, StatusStrip } from "@miragon/pulse-ui"
import type { WebSessionInfo } from "@miragon/pulse-widget-shell/widgets"
import { LogOut } from "lucide-react"
import { PageBar, PageLayout } from "./bar.js"
import { useT } from "./messages/index.js"
import type { PageNotice, PageNotices } from "./notices.js"
import type { Navigate } from "./router/page-link.js"
import { signInUrl, type PageTitle } from "./router/routes.js"

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

/** Who is signed in, and the sign-out, which says it runs until the browser leaves. */
function Account({ page }: { page: SessionPage }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const signedInAs = t("frame.signedInAs", { name: page.session.name })
  const run = () => {
    setBusy(true)
    void page.signOut().then((left) => {
      if (left) return
      setBusy(false)
      page.notices.show("sign-out-failed")
    })
  }
  return (
    <>
      <p className="text-small text-muted-foreground min-w-0 truncate" title={signedInAs}>
        <span className="sr-only">{signedInAs}</span>
        <span aria-hidden="true">{page.session.name}</span>
      </p>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        aria-disabled={busy || undefined}
        onClick={busy ? undefined : run}
      >
        <Icon icon={LogOut} />
        {busy ? t("frame.signingOut") : t("frame.signOut")}
      </Button>
    </>
  )
}

/**
 * The notice under the bar: the session ended (sign in again, back here), or a sign-out failed.
 * Its sign-in, the page's one way out, has no icon, so its label shows at every width: a strip's
 * action with an icon collapses to it in a narrow strip.
 */
function Notice({ notice, page }: { notice: PageNotice; page: SessionPage }) {
  const t = useT()
  if (notice === "sign-out-failed") {
    return (
      <StatusStrip
        tone="danger"
        title={t("notice.signOutFailed.title")}
        detail={t("notice.signOutFailed.detail")}
      />
    )
  }
  return (
    <StatusStrip
      tone="warning"
      title={t("notice.ended.title")}
      detail={t("notice.ended.detail")}
      actions={[
        { label: t("notice.signInAgain"), onClick: () => page.assign(signInUrl(page.returnTo())) },
      ]}
    />
  )
}

/**
 * The route's document title in the page's language, before its view shows its heading: a board's
 * page names the board's id from the URL (the board's title arrives with the view), any other Pulse.
 */
function routeTitle(t: ReturnType<typeof useT>, title: PageTitle): string {
  return title.kind === "board" ? t("title.board", { board: title.board }) : t("frame.product")
}

/**
 * The frame of a page with a session: the bar with the way to the start page (in the page, through
 * its router's `navigate`), who is signed in and the sign-out, the notice of the session under it,
 * and the view, whose heading titles the document (`title` until it shows one). A call that finds
 * the session gone shows the notice, and no silent redirect takes the page away: the sign-in it
 * offers comes back to the page.
 */
export function SessionFrame({
  page,
  title,
  navigate,
  children,
}: {
  page: SessionPage
  title: PageTitle
  navigate: Navigate
  children?: ReactNode
}) {
  const t = useT()
  const notice = useSyncExternalStore(page.notices.subscribe, page.notices.current)
  const banner = (
    <>
      <PageBar navigate={navigate}>
        <Account page={page} />
      </PageBar>
      {notice !== undefined && <Notice notice={notice} page={page} />}
    </>
  )
  return (
    <PageLayout banner={banner} fallbackTitle={routeTitle(t, title)}>
      <div data-slot="page-view" className="flex-1">
        {children}
      </div>
    </PageLayout>
  )
}
