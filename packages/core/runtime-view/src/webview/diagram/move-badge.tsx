import { Icon } from "../components/icon.js"
import { glyphs } from "../components/lucide-glyphs.json"

export type MoveBadgeKind = "from" | "to" | "again"

const TEXTS: Readonly<Record<MoveBadgeKind, { readonly text: string; readonly label: string }>> = {
  from: { text: "−1", label: "The token leaves here" },
  to: { text: "+1", label: "The token goes here" },
  again: { text: "runs again", label: "The element runs again" },
}

export function MoveBadge({ kind }: { readonly kind: MoveBadgeKind }) {
  const { text, label } = TEXTS[kind]
  return (
    <span class={`move-badge move-badge--${kind}`} role="img" aria-label={label} title={label}>
      {kind === "again" && <Icon of={glyphs.RotateCcw} size={12} />}
      {text}
    </span>
  )
}
