// Replaced by the legend of the public BPMN diagram once Miragon/pulse#662 lands.
// The blocks' BadgeLegend with its scope in this page's words: the badges sum every version of
// the key onto the latest version's diagram, as the cockpit's process detail does, where the
// blocks' legend says they count one version.
import { useId } from "react"
import { CircleQuestionMarkIcon } from "lucide-react"
import type { BadgeCountKind } from "@miragon/pulse-screens"
import { Button, Icon } from "@miragon/pulse-ui"
import { useT, type MessageKey } from "../messages.ts"
import { CanvasBadge } from "./canvas-badge.tsx"

const ENTRIES: readonly (readonly [BadgeCountKind, MessageKey])[] = [
  ["running", "legend.running"],
  ["incidents", "legend.incidents"],
  ["incidentsInCalledInstances", "legend.incidentsInCalledInstances"],
]

/**
 * The diagram's legend behind a button: what the badges count (every version, drawn on the
 * latest) and what each badge says, with the canvas badge's sample of each. It opens over the
 * diagram and closes on Escape.
 */
export function DiagramLegend({ version }: { readonly version: number }) {
  const t = useT()
  const legendId = useId()
  return (
    <div className="text-muted-foreground flex flex-none items-center">
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
        className="border-border bg-popover text-dense text-popover-foreground shadow-2 inset-auto m-0 mt-1.5 rounded-md border px-3 py-2 leading-6 [position-anchor:--pulse-legend] [position-area:bottom_span-left]"
      >
        <p className="m-0 font-semibold">{t("legend.scope", { version })}</p>
        {ENTRIES.map(([kind, word]) => (
          <p key={kind} className="m-0 flex items-center gap-1.5">
            <CanvasBadge kind={kind} legend />
            {t(word)}
          </p>
        ))}
      </div>
    </div>
  )
}
