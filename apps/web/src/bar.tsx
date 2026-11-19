import { useCallback, type ReactNode, type RefCallback } from "react"
import { cn, FOCUS_RING } from "@miragon/pulse-ui"
import { WEB_PATHS } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "./messages/index.js"

/**
 * The page's bar, the app's own chrome above every page: 40 px with its rule, the product's name as
 * its chrome title (13 px at 600; the Komet stays on the app level, the cockpit's landing), and at
 * its end what the page puts there (who is signed in and the sign-out). Its container is `bar`, so
 * a toolbar button's label hides visually under 36rem. On a page with a session the name leads to
 * the start page (`home`), the way back to the boards and engines a page's words name.
 */
export function PageBar({ home = false, children }: { home?: boolean; children?: ReactNode }) {
  const t = useT()
  const product = "text-dense text-foreground shrink-0 font-semibold"
  return (
    <div
      data-slot="page-bar"
      className="border-border min-h-bar px-gutter @container/bar flex min-w-0 items-center gap-3 border-b"
    >
      {home ? (
        <a
          href={WEB_PATHS.app}
          className={cn(product, "rounded-sm hover:underline", FOCUS_RING)}
          aria-label={t("frame.home")}
        >
          {t("frame.product")}
        </a>
      ) : (
        <p className={product}>{t("frame.product")}</p>
      )}
      {children !== undefined && (
        <div className="ms-auto flex min-w-0 items-center gap-3">{children}</div>
      )}
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
 * whose heading titles the document (`fallback` until it has one).
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
      <div ref={titled} data-slot="page-content" className="flex flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}
