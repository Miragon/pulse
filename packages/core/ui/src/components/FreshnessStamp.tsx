import { Clock } from "lucide-react"
import { formatClock, formatInstant } from "../format/index.js"
import { Icon } from "../kit/icon.js"
import { useUiMessages } from "../locale/locale-provider.js"

export interface FreshnessStampProps {
  /** When the numbers were read: an ISO timestamp or a `Date`. */
  readonly at: string | Date | null | undefined
}

/** The instant as ISO text, `undefined` for none or one that does not parse. */
function instantOf(at: FreshnessStampProps["at"]): string | undefined {
  if (at === null || at === undefined || at === "") return undefined
  const time = at instanceof Date ? at : new Date(at)
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString()
}

/**
 * When a view's or a page's numbers were read, for the freshness slot of its bar (`WidgetHeader`'s
 * and `ViewBar`'s `freshness`): a clock and "As of 14:32", the time without seconds and its day
 * before it on another day (`formatClock`), the whole instant in its title (`formatInstant`), in
 * the kit's words of the nearest `LocaleProvider`. The board's form, one for every view: at the
 * bar's end in tabular figures, never a fact and never a "Live" pill. Nothing for no time or one
 * that does not parse, never a guess. A page that reads several sources stamps the oldest read.
 */
export function FreshnessStamp({ at }: FreshnessStampProps) {
  const { freshness } = useUiMessages()
  const instant = instantOf(at)
  if (instant === undefined) return null
  return (
    <span
      data-slot="freshness-stamp"
      title={formatInstant(instant)}
      className="inline-flex items-center gap-1.5"
    >
      <Icon icon={Clock} />
      {freshness.asOf({ time: formatClock(instant, { seconds: false }) })}
    </span>
  )
}
