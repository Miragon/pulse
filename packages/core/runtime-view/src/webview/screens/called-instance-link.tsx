import { ArrowUpRightIcon } from "lucide-react"
import type { ComponentProps } from "react"
import type { CalledInstanceLink as CalledInstance } from "../../core/protocol/index.js"
import { cn, FOCUS_RING, Icon } from "@miragon/pulse-ui"
import { useHost } from "../host/host-context.js"

const LINK_BUTTON = cn(
  "text-link inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-sm text-left whitespace-nowrap underline decoration-1 underline-offset-3 hover:decoration-2",
  "my-[min(0px,calc((1lh-24px)/2))] in-[td]:focus-visible:ring-offset-0",
  FOCUS_RING,
)

export function LinkButton({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" {...props} className={cn(LINK_BUTTON, className)} />
}

export function CalledInstanceLink({ link }: { readonly link: CalledInstance }) {
  const host = useHost()
  return (
    <LinkButton
      data-part="called-instance-link"
      title={`Open called instance ${link.instanceId}`}
      onClick={(event) => {
        event.stopPropagation()
        host.post({
          type: "openInstance",
          instanceId: link.instanceId,
          toSide: event.metaKey || event.ctrlKey,
        })
      }}
    >
      {link.bpmnProcessId} <code className="font-mono">{link.shortId}</code>
      <Icon icon={ArrowUpRightIcon} dense />
    </LinkButton>
  )
}
