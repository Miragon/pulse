import type { ReactNode } from "react"
import { useT } from "./messages/index.js"

/**
 * The page's bar, the app's own chrome above every page: 40 px with its rule, the product's name as
 * its chrome title (13 px at 600; the Komet stays on the app level, the cockpit's landing), and at
 * its end what the page puts there (who is signed in and the sign-out). Its container is `bar`, so
 * a toolbar button's label hides visually under 36rem.
 */
export function PageBar({ children }: { children?: ReactNode }) {
  const t = useT()
  return (
    <div
      data-slot="page-bar"
      className="border-border min-h-bar px-gutter @container/bar flex min-w-0 items-center gap-3 border-b"
    >
      <p className="text-dense text-foreground shrink-0 font-semibold">{t("frame.product")}</p>
      {children !== undefined && (
        <div className="ms-auto flex min-w-0 items-center gap-3">{children}</div>
      )}
    </div>
  )
}

/** The page's frame: the banner (the bar and what it adds below) above the page's main content. */
export function PageLayout({ banner, children }: { banner: ReactNode; children?: ReactNode }) {
  return (
    <div data-slot="page-frame" className="flex min-h-full flex-col">
      <header>{banner}</header>
      {children}
    </div>
  )
}
