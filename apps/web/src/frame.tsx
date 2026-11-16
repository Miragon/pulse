import { useEffect, useState, useSyncExternalStore } from "react"
import { Button, Icon, StatusStrip } from "@miragon/pulse-ui"
import type { PageFrame, WebSessionInfo } from "@miragon/pulse-widget-shell/widgets"
import { LogIn, LogOut } from "lucide-react"
import { PageBar, PageLayout } from "./bar.js"
import { useT } from "./messages/index.js"
import type { PageNotice, PageNotices } from "./notices.js"
import { signInUrl, type PageTitle } from "./routes.js"

/** What a page with a session puts into its frame. */
export interface SessionPage {
  readonly session: WebSessionInfo
  readonly notices: PageNotices
  /** What the document's title names, in the page's language. */
  readonly title: PageTitle
  /** The page and its query, where a sign-in from the notice comes back to. */
  readonly returnTo: string
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

/** The notice under the bar: the session ended (sign in again, back here), or a sign-out failed. */
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
        {
          label: t("notice.signInAgain"),
          icon: LogIn,
          onClick: () => page.assign(signInUrl(page.returnTo)),
        },
      ]}
    />
  )
}

/** The document's title in the page's language: a board's page names the board, any other Pulse. */
function useDocumentTitle(title: PageTitle): void {
  const t = useT()
  const text =
    title.kind === "board" ? t("title.board", { board: title.board }) : t("frame.product")
  useEffect(() => {
    document.title = text
  }, [text])
}

/**
 * The frame of a page with a session: the bar with who is signed in and the sign-out, the notice
 * of the session under it, and the view, the document titled for the page. A call that finds the
 * session gone shows the notice, and no silent redirect takes the page away: the sign-in it offers
 * comes back to the page.
 */
export function sessionFrame(page: SessionPage): PageFrame {
  return function SessionFrame({ children }) {
    useDocumentTitle(page.title)
    const notice = useSyncExternalStore(page.notices.subscribe, page.notices.current)
    const banner = (
      <>
        <PageBar>
          <Account page={page} />
        </PageBar>
        {notice !== undefined && <Notice notice={notice} page={page} />}
      </>
    )
    return (
      <PageLayout banner={banner}>
        <div data-slot="page-view" className="flex-1">
          {children}
        </div>
      </PageLayout>
    )
  }
}
