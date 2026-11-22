import { CircleQuestionMarkIcon } from "lucide-react"
import { useId } from "react"
import { Button, Icon } from "@miragon/pulse-ui"
import type { ScreenWordKey } from "../messages/screen-en.js"
import { useScreenWords } from "../messages/screen-words.js"

const ENTRIES: readonly ScreenWordKey[] = [
  "processes.legend.running",
  "processes.legend.withIncident",
  "processes.legend.incidents",
]

/**
 * The legend of an engine's process list behind a button: that each count covers every version,
 * and what each column counts, so "With incident" beside a lower "Incidents" reads as meant (a
 * caller waiting for an incident in an instance it called is an instance with incident, while the
 * incident counts at the process it was raised in), and so does a higher one (an incident outside
 * any instance, a failed timer start, counts though no instance holds it). It opens under the bar
 * and closes on Escape.
 */
export function ProcessCountsLegend() {
  const t = useScreenWords()
  const legendId = useId()
  return (
    <div className="text-muted-foreground flex flex-none items-center" data-part="counts-legend">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground [anchor-name:--pulse-counts-legend]"
        popoverTarget={legendId}
        aria-label={t("processes.legend.label")}
        title={t("processes.legend.label")}
      >
        <Icon icon={CircleQuestionMarkIcon} className="size-4" />
      </Button>
      <div
        id={legendId}
        popover="auto"
        className="border-border bg-popover text-dense text-popover-foreground shadow-2 inset-auto m-0 mt-1.5 max-w-[min(28rem,calc(100vw-2rem))] rounded-md border px-3 py-2 leading-6 [position-anchor:--pulse-counts-legend] [position-area:bottom_span-left]"
      >
        <p className="font-semibold">{t("processes.legend.scope")}</p>
        {ENTRIES.map((word) => (
          <p key={word}>{t(word)}</p>
        ))}
      </div>
    </div>
  )
}
