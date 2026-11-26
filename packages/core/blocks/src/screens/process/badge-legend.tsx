import { CircleQuestionMarkIcon } from "lucide-react"
import { useId, type ComponentType } from "react"
import { Button, Icon } from "@miragon/pulse-ui"
import type { BadgeCountKind } from "@miragon/pulse-screens"
import type { ProcessWordKey } from "../../messages/process-en.js"
import { useProcessWords } from "../../messages/process-words.js"
import type { CountBadgeProps } from "../slots.js"

const ENTRIES: readonly (readonly [BadgeCountKind, ProcessWordKey])[] = [
  ["running", "legend.running"],
  ["incidents", "legend.incidents"],
  ["incidentsInCalledInstances", "legend.incidentsInCalledInstances"],
]

export interface BadgeLegendProps {
  /** The version whose diagram the badges count on. */
  readonly version: number
  /** The surface's count badge, as its diagram draws one, shown as each entry's sample. */
  readonly Badge: ComponentType<CountBadgeProps>
}

/**
 * The legend of a process's diagram behind a button: which version the badges count, and what each
 * badge says (waiting here, a root incident here, an incident in a called instance), with the
 * surface's sample of each. It opens over the diagram and closes on Escape.
 */
export function BadgeLegend({ version, Badge }: BadgeLegendProps) {
  const t = useProcessWords()
  const legendId = useId()
  return (
    <div className="text-muted-foreground ml-auto flex flex-none items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground [anchor-name:--pulse-legend]"
        popoverTarget={legendId}
        aria-label={t("legend.label")}
        title={t("legend.label")}
      >
        <Icon icon={CircleQuestionMarkIcon} className="size-4" />
      </Button>
      <div
        id={legendId}
        popover="auto"
        className="border-border bg-popover text-dense text-popover-foreground shadow-2 inset-auto m-0 mb-1.5 rounded-md border px-3 py-2 leading-6 [position-anchor:--pulse-legend] [position-area:top_span-left]"
      >
        <p className="font-semibold">{t("legend.scope", { version })}</p>
        {ENTRIES.map(([kind, word]) => (
          <p key={kind} className="flex items-center gap-1.5">
            <Badge kind={kind} legend />
            {t(word)}
          </p>
        ))}
      </div>
    </div>
  )
}
