import type { ReactNode } from "react"
import { CountFigure } from "@miragon/pulse-ui"
import { useT } from "../../messages/use-t.js"

/** Each alarm the cockpit's counts raise: its situation (the tone and the icon's shape) and words. */
const ALARMS = {
  openIncidents: { situation: "openIncident", words: "countAlarm.openIncidents" },
  jobsWithoutRetries: { situation: "jobWithoutRetries", words: "countAlarm.jobsWithoutRetries" },
  noRetriesLeft: { situation: "jobWithoutRetries", words: "countAlarm.noRetriesLeft" },
  retriesLeft: { situation: "jobWithRetriesLeft", words: "countAlarm.retriesLeft" },
} as const

export type CountAlarm = keyof typeof ALARMS

/**
 * A count of the cockpit as a neutral figure (invariant 6, owner decision (d)): never a coloured
 * number, a tinted pill or tile. While it alarms (`alarm`: open incidents, jobs without retries)
 * it adds its tone's icon of its own shape and says why in words for a screen reader.
 */
export function AlarmCount({
  children,
  alarm,
  className,
}: {
  /** The figure, formatted. */
  children: ReactNode
  /** The alarm it raises now; nothing (`false`, `null`) for a count that does not alarm. */
  alarm?: CountAlarm | false | null
  className?: string
}) {
  const t = useT()
  if (!alarm) return <CountFigure className={className}>{children}</CountFigure>
  const { situation, words } = ALARMS[alarm]
  return (
    <CountFigure situation={situation} label={t(words)} className={className}>
      {children}
    </CountFigure>
  )
}
