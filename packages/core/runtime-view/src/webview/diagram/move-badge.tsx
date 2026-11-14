import { RotateCcwIcon } from "lucide-react"
import { cn, Icon } from "@miragon/pulse-ui"

export type MoveBadgeKind = "from" | "to" | "again"

const TEXTS: Readonly<Record<MoveBadgeKind, { readonly text: string; readonly label: string }>> = {
  from: { text: "−1", label: "The token leaves here" },
  to: { text: "+1", label: "The token goes here" },
  again: { text: "runs again", label: "The element runs again" },
}

export function MoveBadge({ kind }: { readonly kind: MoveBadgeKind }) {
  const { text, label } = TEXTS[kind]
  return (
    <span
      className={cn("move-badge", `move-badge--${kind}`)}
      data-part="move-badge"
      data-kind={kind}
      role="img"
      aria-label={label}
      title={label}
    >
      {kind === "again" && <Icon icon={RotateCcwIcon} dense />}
      {text}
    </span>
  )
}
