import { ClipboardListIcon, CornerLeftUpIcon } from "lucide-react"
import type { InstanceHeader } from "../../core/protocol/index.js"
import { HeaderButton } from "../components/header-button.js"
import { cn, Icon } from "@miragon/pulse-ui"
import { IdText } from "../components/id-text.js"
import { LinkButton, type OpenLinkProps } from "./called-instance-link.js"

const SHRINK = "max-w-full min-w-[4ch] flex-[0_1_auto]"

export function DefinitionLink({ title, onOpen, children }: OpenLinkProps) {
  return (
    <LinkButton
      className={cn(SHRINK, "inline-block truncate")}
      title={title}
      onClick={(event) => {
        onOpen(event.metaKey || event.ctrlKey)
      }}
    >
      {children}
    </LinkButton>
  )
}

export function CallerLink({ title, onOpen, children }: OpenLinkProps) {
  return (
    <LinkButton
      className={cn(SHRINK, "max-w-[24ch] overflow-hidden")}
      data-part="caller-link"
      title={title}
      onClick={(event) => {
        onOpen(event.metaKey || event.ctrlKey)
      }}
    >
      <Icon icon={CornerLeftUpIcon} dense />
      <span className="min-w-0 truncate">{children}</span>
    </LinkButton>
  )
}

export function InstanceId({ instance }: { readonly instance: InstanceHeader }) {
  return <IdText id={instance.id} shortId={instance.shortId} label="instance ID" />
}

export function InstanceHeaderActions() {
  return (
    <HeaderButton
      icon={ClipboardListIcon}
      label="Copy handover"
      title="Copy a Markdown handover of this instance, without variables"
      intent={{ type: "copyHandover" }}
    />
  )
}
