import { useCallback, type MouseEvent, type ReactNode, type RefCallback } from "react"
import { cn, FOCUS_RING } from "@miragon/pulse-ui"
import { WEB_PATHS } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "./messages/index.js"
import { PageLink, type Navigate } from "./router/page-link.js"

/**
 * The page's width and its margin on the ground: the guide's content width (72rem, 1152 px) with
 * its 24 px gutter around it from 40rem on; under that the sheet runs from edge to edge, as every
 * pixel counts on a phone. The bar's row and the sheet share it, so the product's name stands over
 * the sheet's content.
 */
const PAGE_WIDTH = "mx-auto w-full max-w-6xl"
const PAGE_MARGIN = "sm:px-6"

/** The page's content, which the skip link leads to. */
const CONTENT_ID = "content"

/**
 * Focus to the content's heading (a view's `h1`, a state page's), else the content itself, from
 * script only: the address keeps no fragment, so Back never stops at a skip.
 */
function skipToContent(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  const content = document.getElementById(CONTENT_ID)
  const target = content?.querySelector("h1") ?? content
  if (!target) return
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1
  target.focus()
}

/** The first stop of the page (WCAG 2.4.1): seen only while it has focus. */
function SkipLink() {
  const t = useT()
  return (
    <a
      href={`#${CONTENT_ID}`}
      onClick={skipToContent}
      className={cn("text-dense text-foreground sr-only rounded-sm focus:not-sr-only", FOCUS_RING)}
    >
      {t("frame.skipToContent")}
    </a>
  )
}

/**
 * The page's bar, the app's own chrome above every page: 40 px on the card's surface with its rule
 * across the window, on a page with a session a skip link to the content first (seen while it has
 * focus), the product's name
 * as its chrome title (13 px at 600; the Komet stays on the app level, the cockpit's landing), and
 * at its end what the page puts there (who is signed in and the sign-out), its row as wide as the
 * sheet below. Its row's container is `bar`, so a toolbar
 * button's label hides visually under 36rem. On a page with a session (`navigate`, its router's)
 * the name leads to the start page in the page, the way back to the boards and engines a page's
 * words name.
 */
export function PageBar({ navigate, children }: { navigate?: Navigate; children?: ReactNode }) {
  const t = useT()
  const home = navigate !== undefined
  const product = "text-dense text-foreground shrink-0 font-semibold"
  return (
    <div data-slot="page-bar" className={cn("border-border bg-card border-b", PAGE_MARGIN)}>
      <div
        className={cn(
          "min-h-bar px-gutter @container/bar flex min-w-0 items-center gap-3",
          PAGE_WIDTH,
        )}
      >
        {home && <SkipLink />}
        {home ? (
          <PageLink
            href={WEB_PATHS.app}
            navigate={navigate}
            className={cn(product, "rounded-sm hover:underline", FOCUS_RING)}
            aria-label={t("frame.home")}
          >
            {t("frame.product")}
          </PageLink>
        ) : (
          <p className={product}>{t("frame.product")}</p>
        )}
        {children !== undefined && (
          <div className="ms-auto flex min-w-0 items-center gap-3">{children}</div>
        )}
      </div>
    </div>
  )
}

/**
 * The document's title names what the page shows (WCAG 2.4.2): its one heading (a view's h1, the
 * board's title on a board's page, a failure in the view's place, a signed-out page's reason) with
 * the product after it, and `fallback` before the page has one. It follows the heading as the user
 * moves on inside the page, so it never names a view the page has left. A ref for the page's
 * content, which watches it while it is mounted.
 */
function useHeadingTitle(fallback: string): RefCallback<HTMLElement> {
  const t = useT()
  return useCallback(
    (content: HTMLElement) => {
      const update = () => {
        const heading = content.querySelector("h1")?.textContent?.trim()
        const next = heading ? t("title.page", { page: heading }) : fallback
        if (document.title !== next) document.title = next
      }
      update()
      const observer = new MutationObserver(update)
      observer.observe(content, { childList: true, subtree: true, characterData: true })
      return () => observer.disconnect()
    },
    [fallback, t],
  )
}

/**
 * The page's frame: the banner (the bar and what it adds below) above the page's main content,
 * whose heading titles the document (`fallback` until it has one). The content is a sheet on the
 * app's ground, the guide's card: the card's surface with its 1 px rule, radius `lg` and the faint
 * shadow, as high as what it holds. It clips what it holds to its corners, since a view paints its
 * own surface up to its edges; what floats over a view (a menu, a dialog) renders outside it.
 */
export function PageLayout({
  banner,
  fallbackTitle,
  children,
}: {
  banner: ReactNode
  fallbackTitle: string
  children?: ReactNode
}) {
  const titled = useHeadingTitle(fallbackTitle)
  return (
    <div data-slot="page-frame" className="flex min-h-full flex-col">
      <header>{banner}</header>
      <div className={cn("flex flex-1 flex-col sm:py-6", PAGE_MARGIN)}>
        <div
          ref={titled}
          id={CONTENT_ID}
          data-slot="page-content"
          className={cn(
            "bg-card border-border sm:shadow-1 flex flex-col overflow-clip border-b sm:rounded-lg sm:border",
            PAGE_WIDTH,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
