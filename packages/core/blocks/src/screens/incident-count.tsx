import { CountFigure, formatCount } from "@miragon/pulse-ui"

/**
 * A count that alarms above 0 (instances with incident, open root incidents): a neutral figure, its
 * alarm icon and words (`alarm`) above 0, a count the engine stopped at as a lower bound
 * (`≥ 10,000`), marked by its part for a surface's tests.
 */
export function IncidentCount({
  count,
  atLeast = false,
  part,
  alarm,
}: {
  readonly count: number
  readonly atLeast?: boolean | undefined
  readonly part: string
  readonly alarm: string
}) {
  const text = formatCount(atLeast ? { atLeast: count } : count)
  return (
    <span data-part={part} data-tone={count > 0 ? "danger" : undefined}>
      {count > 0 ? (
        <CountFigure situation="openIncident" label={alarm}>
          {text}
        </CountFigure>
      ) : (
        <CountFigure>{text}</CountFigure>
      )}
    </span>
  )
}
