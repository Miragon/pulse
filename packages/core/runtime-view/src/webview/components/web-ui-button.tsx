import { ExternalLinkIcon } from "lucide-react"
import type { WebUiLink } from "../../core/protocol/index.js"
import { HeaderButton } from "./header-button.js"

export function WebUiButton({ link }: { readonly link: WebUiLink | undefined }) {
  if (link === undefined) {
    return null
  }
  return (
    <HeaderButton
      icon={ExternalLinkIcon}
      label={link.label}
      title={link.title}
      intent={{ type: "openWebUi" }}
    />
  )
}
