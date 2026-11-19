import type { MouseEvent } from "react"
import { buttonVariants, useLocale, Icon, MENU_ITEM } from "@miragon/pulse-ui"
import { ExternalLink } from "lucide-react"
import { kitLabels } from "./kit-labels.js"
import { useViewHost } from "./view-host.js"

/** Named after the vendor, not "Cockpit", which is this app's own name. */
export function OpenInCockpitLink({
  url,
  vendor,
  label,
  variant = "outline",
}: {
  url: string
  /** `provider.branding.displayName`. */
  vendor?: string
  label?: string
  /**
   * `outline`: the kit's outline button. `toolbar`: the toolbar button of a view's bar, the icon
   * first and the label at 400, hidden visually in a narrow bar (the link keeps its name).
   * `menuitem`: an entry of a row's menu.
   */
  variant?: "outline" | "toolbar" | "menuitem"
}) {
  const { openExternal } = useViewHost()
  const labels = kitLabels(useLocale())
  const text = label ?? labels.openInVendor(vendor)
  const link = {
    href: url,
    target: "_blank",
    rel: "noopener noreferrer",
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault()
      openExternal(url)
    },
    "aria-label": labels.opensInNewTab(text),
  }
  if (variant === "menuitem") {
    return (
      <a {...link} role="menuitem" tabIndex={-1} className={MENU_ITEM}>
        <Icon icon={ExternalLink} />
        {text}
      </a>
    )
  }
  if (variant === "toolbar") {
    return (
      <a {...link} title={text} className={buttonVariants({ variant: "toolbar", size: "sm" })}>
        <Icon icon={ExternalLink} />
        <span data-slot="button-label">{text}</span>
      </a>
    )
  }
  return (
    <a {...link} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {text}
      <Icon icon={ExternalLink} />
    </a>
  )
}
