import { formatCount } from "@miragon/pulse-ui"
import { DEFAULT_CAP, type Cut } from "../engine/engine.ts"
import { useT } from "../messages.ts"

/**
 * Why a section's sums may be too low, above them, in a quiet line: the cap stopped a read
 * (`cap`), or a list changed while the page read it (`changed`, which a Refresh reads anew).
 * Nothing for a section whose reads are whole.
 */
export function CutNote({ cut }: { readonly cut: Cut | null }) {
  const t = useT()
  if (cut === null) return null
  return (
    <p className="text-muted-foreground m-0">
      {cut === "cap" ? t("section.cut", { count: formatCount(DEFAULT_CAP) }) : t("section.changed")}
    </p>
  )
}
