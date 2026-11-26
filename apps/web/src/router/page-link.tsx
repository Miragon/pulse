import type { AnchorHTMLAttributes, MouseEvent } from "react"

/** Goes to an address of the page, in a new entry of the browser's history (`PageRouter.navigate`). */
export type Navigate = (url: string) => void

/**
 * Whether a click on a link is the page's to follow: the main button with no key, which leaves a new
 * tab (Ctrl or Cmd, the middle button), a new window (Shift) and a download (Alt) to the browser.
 */
function isPageClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}

/**
 * A link to an address of the page: a real `<a href>`, which a click follows in the page, without
 * loading it anew, and which the browser opens in a new tab or window where the click asks it to.
 */
export function PageLink({
  href,
  navigate,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "onClick"> & {
  readonly href: string
  readonly navigate: Navigate
}) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        if (!isPageClick(event)) return
        event.preventDefault()
        navigate(href)
      }}
    />
  )
}
