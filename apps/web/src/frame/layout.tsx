import { useCallback, type MouseEvent, type ReactNode, type RefCallback } from "react"
import { cn, FOCUS_RING, NavigationFocus } from "@miragon/pulse-ui"
import { useT } from "../messages/index.js"

/** The page's content, which the skip link leads to. */
const CONTENT_ID = "content"

/**
 * The view's sheet: the card's surface on the app's ground, 16 px off the window and the
 * navigation from 40rem on, its 1 px rule, radius `lg` and the faint shadow, as wide as the room
 * beside the navigation (no 72rem cap) and as high as the window. Under 40rem it runs from edge to
 * edge, as every pixel counts on a phone. It clips what it holds to its corners, since a view
 * paints its own surface up to its edges; what floats over a view (a menu, a dialog) renders
 * outside it.
 */
const SHEET =
  "bg-card border-border sm:shadow-1 flex flex-1 flex-col overflow-clip border-b sm:rounded-lg sm:border"

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

/** The first stop of the page (WCAG 2.4.1): seen only while it has focus, over the page's corner. */
function SkipLink() {
  const t = useT()
  return (
    <a
      href={`#${CONTENT_ID}`}
      onClick={skipToContent}
      className={cn(
        "text-dense text-foreground focus:bg-card focus:shadow-2 sr-only rounded-sm focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:px-3 focus:py-1.5",
        FOCUS_RING,
      )}
    >
      {t("frame.skipToContent")}
    </a>
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
 * The bar of a page without a session (the signed-out page, a session that ended before its
 * first read or could not be read): 40 px on the card's surface with its rule across the window,
 * the product's name as its chrome title (13 px at 600; the Komet stays on the app level).
 */
function PageBar() {
  const t = useT()
  return (
    <div data-slot="page-bar" className="border-border bg-card border-b">
      <div className="min-h-bar px-gutter flex min-w-0 items-center">
        <p className="text-dense text-foreground shrink-0 font-semibold">{t("frame.product")}</p>
      </div>
    </div>
  )
}

/**
 * A page without a session: its bar above its content on the sheet, whose heading titles the
 * document (`fallbackTitle` until it has one).
 */
export function PageLayout({
  fallbackTitle,
  children,
}: {
  fallbackTitle: string
  children?: ReactNode
}) {
  const titled = useHeadingTitle(fallbackTitle)
  return (
    <div data-slot="page-frame" className="flex min-h-dvh shrink-0 flex-col">
      <header>
        <PageBar />
      </header>
      <div className="flex flex-1 flex-col sm:p-4">
        <div ref={titled} id={CONTENT_ID} data-slot="page-content" className={SHEET}>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * The page's frame with a session, in the editors' look: the side navigation (`side`, 15rem on
 * the card's surface along the window's height, its rule at its inner edge, from 64rem on; under
 * that the page's drawer holds it), then the view's sheet beside it. The banner holds the skip
 * link first (the page's tab order: the skip link, the navigation, the content) and the
 * navigation. The sheet says the page's `notice` once, above the view's bar; where the view shows
 * no bar (a state of its own, its frame's while it loads or fails) a row holds `menu` under 64rem,
 * so the navigation stays one step away. Each of the page's moves (`focusKey`: a link of the page,
 * Back, Forward) hands focus to the new view's `h1`; a move inside a view (a filter, a tab) leaves
 * it where it is. The content's heading titles the document (`fallbackTitle` until it has one).
 * The navigation stays in place while a longer page scrolls (sticky at the window's top): the
 * frame grows with its content and never shrinks to the window in the view host's column, whose
 * height is the window's, or the navigation would scroll away at the end of its 100dvh.
 */
export function SessionLayout({
  side,
  notice,
  menu,
  focusKey,
  fallbackTitle,
  fill = false,
  children,
}: {
  side: ReactNode
  notice?: ReactNode
  menu: ReactNode
  focusKey: string
  fallbackTitle: string
  /**
   * The view fills the window's height from 64rem on (a screen of the page's), so what
   * it scrolls scrolls in its own region; under 64rem, and for every other view, the page scrolls.
   */
  fill?: boolean
  children?: ReactNode
}) {
  const titled = useHeadingTitle(fallbackTitle)
  return (
    <div
      data-slot="page-frame"
      data-fill={fill || undefined}
      className={cn("flex min-h-dvh shrink-0", fill && "lg:h-dvh")}
    >
      <header
        data-slot="page-side"
        className="lg:border-border lg:bg-card lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-e"
      >
        <SkipLink />
        <div className="hidden min-h-0 flex-1 flex-col lg:flex">{side}</div>
      </header>
      <div className={cn("flex min-w-0 flex-1 flex-col sm:p-4", fill && "lg:min-h-0")}>
        <div
          ref={titled}
          id={CONTENT_ID}
          data-slot="page-content"
          className={cn("group/content", SHEET, fill && "lg:min-h-0")}
        >
          {notice}
          <div
            data-slot="page-menu-row"
            className="min-h-bar px-gutter border-border flex items-center border-b group-has-[[data-slot=view-bar]]/content:hidden lg:hidden"
          >
            {menu}
          </div>
          <NavigationFocus
            viewKey={focusKey}
            className={fill ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" : undefined}
          >
            {children}
          </NavigationFocus>
        </div>
      </div>
    </div>
  )
}
