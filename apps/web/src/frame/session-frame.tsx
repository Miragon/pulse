import { useSyncExternalStore, type ReactNode } from "react"
import { StatusStrip } from "@miragon/pulse-ui"
import { useT } from "../messages/index.js"
import type { PageNotice } from "../notices.js"
import type { Navigate } from "../router/page-link.js"
import { signInUrl, type PageTitle, type Place } from "../router/routes.js"
import { Account } from "./account.js"
import { Drawer, PAGE_MENU } from "./drawer.js"
import { SessionLayout } from "./layout.js"
import { PageNavigation } from "./navigation.js"
import type { SessionPage } from "./session-page.js"

/**
 * The notice above the view's bar: the session ended (sign in again, back here), or a sign-out
 * failed. Its sign-in, the page's one way out, has no icon, so its label shows at every width: a
 * strip's action with an icon collapses to it in a narrow strip.
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
 * The side of the page: the product's name, the navigation (`navigate` follows an entry in the
 * page) and, at its foot, who is signed in and the sign-out (`onSignOutFailed` before its notice
 * shows).
 */
function PageSide({
  page,
  place,
  navigate,
  product = true,
  onSignOutFailed,
}: {
  page: SessionPage
  place: Place
  navigate: Navigate
  /** Its first row names the product: the drawer's own first row does in the drawer. */
  product?: boolean
  onSignOutFailed?: () => void
}) {
  const t = useT()
  return (
    <div data-slot="page-side-panel" className="flex min-h-0 flex-1 flex-col">
      {product && (
        <p className="min-h-bar px-gutter text-dense text-foreground flex items-center font-semibold">
          {t("frame.product")}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <PageNavigation place={place} navigate={navigate} />
      </div>
      <div className="border-border border-t">
        <Account page={page} onFailed={onSignOutFailed} />
      </div>
    </div>
  )
}

/**
 * The frame of a page with a session, in the editors' look: the side navigation (the start page,
 * the engines with the open one's sections, the boards, who is signed in and the sign-out), a
 * drawer under 64rem behind the menu every view bar shows first (closed where a sign-out from it
 * did not go through, so its notice shows), the session's notice once above the view's bar, and
 * the view, whose heading titles the document (`title` until it shows one) and
 * takes focus at each of the page's moves (`moves`). A call that finds the session gone shows the
 * notice, and no silent redirect takes the page away: the sign-in it offers comes back to the page.
 */
export function SessionFrame({
  page,
  place,
  title,
  moves,
  navigate,
  fill = false,
  children,
}: {
  page: SessionPage
  /** Where the page is: the navigation marks its entry. */
  place: Place
  title: PageTitle
  /** How often the page moved itself (a link of the page, Back, Forward): focus follows. */
  moves: number
  navigate: Navigate
  /** Whether the view fills the window's height from 64rem on (a screen of the page's). */
  fill?: boolean
  children?: ReactNode
}) {
  const t = useT()
  const notice = useSyncExternalStore(page.notices.subscribe, page.notices.current)
  return (
    <Drawer
      navigation={({ moveOn, close }) => (
        <PageSide
          page={page}
          place={place}
          product={false}
          navigate={(url) => {
            moveOn()
            navigate(url)
          }}
          onSignOutFailed={close}
        />
      )}
    >
      <SessionLayout
        side={<PageSide page={page} place={place} navigate={navigate} />}
        notice={notice !== undefined && <Notice notice={notice} page={page} />}
        menu={PAGE_MENU}
        focusKey={String(moves)}
        fallbackTitle={routeTitle(t, title)}
        fill={fill}
      >
        {children}
      </SessionLayout>
    </Drawer>
  )
}
