import { Badge, formatNumber, formatTimestamp } from "@miragon/pulse-ui"
import type { PeriodCompareKpi, PeriodCompareResult } from "@miragon/pulse-analytics-client"
import { HandOffButton, ViewMeta } from "@miragon/pulse-widget-shell/widgets"
import { useT, type T } from "../messages/use-t.js"
import {
  ComparisonCard,
  SuppressedBadge,
  buildComparisonMetrics,
  deltaFacts,
} from "./comparison-shared.js"
import { engineIdsOf, useHandOff, type HandOff } from "./hand-off.js"
import { enginesMeta } from "./view-meta.js"

/** The ids re-run the comparison as asked; the periods actually measured are facts (#336). */
export function periodCompareHandOff(data: PeriodCompareResult): HandOff {
  const [a, b] = data.kpis
  return {
    intent: "askAi.periodCompare",
    ids: {
      engine: engineIdsOf(data.engines),
      periodAFrom: data.periodAFrom,
      periodATo: data.periodATo,
      periodBFrom: data.periodBFrom,
      periodBTo: data.periodBTo,
      processDefinitionKey: data.processDefinitionKey,
      activityId: data.activityId,
    },
    facts: {
      measuredADays: a.days,
      measuredBDays: b.days,
      partial: data.partial || undefined,
      ...deltaFacts(data.delta, data.suppressed),
    },
  }
}

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type MeasuredPeriod = Pick<PeriodCompareKpi, "from" | "to">

/**
 * A short period reads "2 Stunden", never "0,1 Tage": the length comes from the measured bounds,
 * since `days` (0.01 d, ~14 min) is too coarse for a period cut short at now.
 */
function windowLength(t: T, measured: MeasuredPeriod): string {
  const seconds = (Date.parse(measured.to) - Date.parse(measured.from)) / 1000
  if (seconds >= DAY) {
    return t("aCommon.days", { count: formatNumber(seconds / DAY, { maximumFractionDigits: 1 }) })
  }
  if (seconds >= HOUR) {
    return t("aCommon.hours", { count: formatNumber(Math.round(seconds / HOUR)) })
  }
  if (seconds >= MINUTE) {
    return t("aCommon.minutes", { count: formatNumber(Math.round(seconds / MINUTE)) })
  }
  return t("aCommon.underOneMinute")
}

function RangeBadge({ label, period }: { label: string; period: MeasuredPeriod }) {
  const t = useT()
  return (
    <Badge variant="secondary">
      {t("aPeriodCompare.rangeBadge", {
        label,
        from: formatTimestamp(period.from),
        to: formatTimestamp(period.to),
      })}
    </Badge>
  )
}

export function PeriodCompareWidget({ data }: { data: PeriodCompareResult }) {
  const t = useT()
  const { ask } = useHandOff()
  const [a, b] = data.kpis
  const metrics = buildComparisonMetrics(t, a, b, data.delta)

  return (
    <ComparisonCard
      title={t("aPeriodCompare.title")}
      tableLabel={t("aPeriodCompare.tableLabel")}
      beforeLabel={t("aPeriodCompare.columnA")}
      afterLabel={t("aPeriodCompare.columnB")}
      metrics={metrics}
      suppressed={data.suppressed}
      actions={
        <HandOffButton action="assess" prompt={ask(periodCompareHandOff(data))} variant="primary" />
      }
      meta={
        <ViewMeta
          period={t("aPeriodCompare.lengths", { a: windowLength(t, a), b: windowLength(t, b) })}
          engines={enginesMeta(data.engines)}
          asOf={data.asOf}
        />
      }
      badges={
        <>
          <RangeBadge label="A" period={a} />
          <RangeBadge label="B" period={b} />
          {data.partial && <Badge variant="outline">{t("aPeriodCompare.partialBadge")}</Badge>}
          {data.processDefinitionKey && <Badge>{data.processDefinitionKey}</Badge>}
          {data.activityId && (
            <Badge variant="outline">
              {t("aComparison.elementBadge", { id: data.activityId })}
            </Badge>
          )}
          {data.suppressed && (
            <SuppressedBadge>
              {t("aPeriodCompare.insufficientSignal", {
                minBucketSize: formatNumber(data.minBucketSize),
              })}
            </SuppressedBadge>
          )}
        </>
      }
    />
  )
}
