import { ArrowUpRightIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { cn, FOCUS_RING, Icon } from "@miragon/pulse-ui"

const LINK_BUTTON = cn(
  "text-link inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-sm text-left whitespace-nowrap underline decoration-1 underline-offset-3 hover:decoration-2",
  "my-[min(0px,calc((1lh-24px)/2))] in-[td]:focus-visible:ring-offset-0",
  FOCUS_RING,
)

export function LinkButton({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" {...props} className={cn(LINK_BUTTON, className)} />
}

export interface OpenLinkProps {
  readonly title: string
  readonly onOpen: (toSide: boolean) => void
  readonly children: ReactNode
}

export function CalledInstanceLink({ title, onOpen, children }: OpenLinkProps) {
  return (
    <LinkButton
      data-part="called-instance-link"
      title={title}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(event.metaKey || event.ctrlKey)
      }}
    >
      {children}
      <Icon icon={ArrowUpRightIcon} dense />
    </LinkButton>
  )
}
