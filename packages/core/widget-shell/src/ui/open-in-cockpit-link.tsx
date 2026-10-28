import type { MouseEvent } from "react"
import { buttonVariants, useLocale } from "@miragon/mcp-toolkit-ui"
import { ExternalLink } from "lucide-react"
import { useHostActions } from "@miragon/mcp-toolkit-ui/app"
import { Icon } from "./icon.js"
import { kitLabels } from "./kit-labels.js"
import { MENU_ITEM } from "./menu-item.js"

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
  variant?: "outline" | "menuitem"
}) {
  const host = useHostActions()
  const labels = kitLabels(useLocale())
  const text = label ?? labels.openInVendor(vendor)
  const link = {
    href: url,
    target: "_blank",
    rel: "noopener noreferrer",
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault()
      host.openLink(url)
    },
    "aria-label": labels.opensInNewTab(text),
  }
  if (variant === "menuitem") {
    return (
      <a {...link} role="menuitem" tabIndex={-1} className={MENU_ITEM}>
        <Icon icon={ExternalLink} dense />
        {text}
      </a>
    )
  }
  return (
    <a {...link} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {text}
      <Icon icon={ExternalLink} dense />
    </a>
  )
}
