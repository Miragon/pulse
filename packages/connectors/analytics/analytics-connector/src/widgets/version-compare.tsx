import { Badge, formatNumber } from "@miragon/pulse-ui"
import type { VersionCompareResult } from "@miragon/pulse-analytics-client"
import { HandOffButton, ViewMeta, formatLookback } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/use-t.js"
import {
  ComparisonCard,
  SuppressedBadge,
  buildComparisonMetrics,
  deltaFacts,
} from "./comparison-shared.js"
import { engineIdsOf, useHandOff, type HandOff } from "./hand-off.js"
import { enginesMeta } from "./view-meta.js"

/** Process-wide: the tool takes no element scope (#336). */
export function versionCompareHandOff(data: VersionCompareResult): HandOff {
  return {
    intent: "askAi.versionCompare",
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: data.processDefinitionKey,
      versionA: data.versionA,
      versionB: data.versionB,
      windowDays: data.windowDays,
    },
    facts: deltaFacts(data.delta, data.suppressed),
  }
}

export function VersionCompareWidget({ data }: { data: VersionCompareResult }) {
  const t = useT()
  const { ask } = useHandOff()
  const [a, b] = data.kpis
  const metrics = buildComparisonMetrics(t, a, b, data.delta)

  return (
    <ComparisonCard
      title={t("aVersionCompare.title")}
      tableLabel={t("aVersionCompare.tableLabel")}
      beforeLabel={`v${data.versionA}`}
      afterLabel={`v${data.versionB}`}
      metrics={metrics}
      suppressed={data.suppressed}
      actions={
        <HandOffButton
          action="assess"
          prompt={ask(versionCompareHandOff(data))}
          variant="primary"
        />
      }
      meta={
        <ViewMeta
          period={formatLookback(`${data.windowDays}d`)}
          engines={enginesMeta(data.engines)}
          asOf={data.asOf}
        />
      }
      badges={
        <>
          <Badge>{data.processDefinitionKey}</Badge>
          <Badge variant="secondary">
            {t("aVersionCompare.versionsBadge", {
              versionA: data.versionA,
              versionB: data.versionB,
            })}
          </Badge>
          {data.suppressed && (
            <SuppressedBadge>
              {t("aVersionCompare.badgeInsufficientSignal", {
                min: formatNumber(data.minBucketSize),
              })}
            </SuppressedBadge>
          )}
        </>
      }
    />
  )
}
