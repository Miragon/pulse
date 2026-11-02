import { Badge, formatNumber } from "@miragon/pulse-ui"
import type { EngineCompareResult } from "@miragon/pulse-analytics-client"
import { HandOffButton, ViewMeta, formatLookback } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/use-t.js"
import {
  ComparisonCard,
  SuppressedBadge,
  buildComparisonMetrics,
  deltaFacts,
} from "./comparison-shared.js"
import { useHandOff, type HandOff } from "./hand-off.js"

/** The process is held fixed, so a real gap is the engine's (or its environment's). */
export function engineCompareHandOff(data: EngineCompareResult): HandOff {
  return {
    intent: "askAi.engineCompare",
    ids: {
      processDefinitionKey: data.processDefinitionKey,
      engineA: data.engineA,
      engineB: data.engineB,
      windowDays: data.windowDays,
      activityId: data.activityId,
    },
    facts: deltaFacts(data.delta, data.suppressed),
  }
}

export function EngineCompareWidget({ data }: { data: EngineCompareResult }) {
  const t = useT()
  const { ask } = useHandOff()
  const [a, b] = data.kpis
  const metrics = buildComparisonMetrics(t, a, b, data.delta)

  return (
    <ComparisonCard
      title={t("aEngineCompare.title")}
      tableLabel={t("aEngineCompare.tableLabel")}
      beforeLabel={data.engineA}
      afterLabel={data.engineB}
      metrics={metrics}
      suppressed={data.suppressed}
      actions={
        <HandOffButton action="assess" prompt={ask(engineCompareHandOff(data))} variant="primary" />
      }
      // The two engines head the columns; the line names the period and when.
      meta={<ViewMeta period={formatLookback(`${data.windowDays}d`)} asOf={data.asOf} />}
      badges={
        <>
          <Badge variant="secondary">
            {t("aEngineCompare.enginesBadge", { engineA: data.engineA, engineB: data.engineB })}
          </Badge>
          <Badge>{data.processDefinitionKey}</Badge>
          {data.activityId && (
            <Badge variant="outline">
              {t("aComparison.elementBadge", { id: data.activityId })}
            </Badge>
          )}
          {data.suppressed && (
            <SuppressedBadge>
              {t("aEngineCompare.suppressed", { min: formatNumber(data.minBucketSize) })}
            </SuppressedBadge>
          )}
        </>
      }
    />
  )
}
