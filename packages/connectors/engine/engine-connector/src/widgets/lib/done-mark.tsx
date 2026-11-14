import type { ReactNode } from "react"
import { Icon, TONE_ICON } from "@miragon/pulse-ui"
import { Check } from "lucide-react"

/**
 * A write done in a row or beside its action ("Retry scheduled"): the success tone's check and
 * the words in the foreground, as a state label reads, never a tinted pill (those are for a
 * header's badge) and never a dimmed row that reads as disabled (#322 U11).
 */
export function DoneMark({ children }: { children: ReactNode }) {
  return (
    <span
      data-slot="done-mark"
      className="text-dense inline-flex items-center gap-1.5 whitespace-nowrap"
    >
      <Icon icon={Check} className={TONE_ICON.success} />
      <span className="text-foreground">{children}</span>
    </span>
  )
}
