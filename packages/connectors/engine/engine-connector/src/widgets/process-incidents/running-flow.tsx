import { useMemo, type ReactNode } from "react"
import { TableEmptyState, formatNumber } from "@miragon/pulse-ui"
import { HostModelContext, ViewDataState, useToolQuery } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../messages/use-t.js"
import { ENGINE_ACTIVITY_STATISTICS_DATA } from "../../tool-names.js"
import type { ActivityStatisticsActivity, ActivityStatisticsData } from "../../view-models.js"
import { BpmnDiagram } from "../bpmn-diagram.js"
import { useHandOff } from "../lib/hand-off.js"
import { ActivityValues } from "./activity-values.js"
import { describeRunningFlow, runningDecorations } from "./running.js"

/** Under the cockpit's Refresh (`engine:`), scoped to the route's engine and process. */
function useRunningData(
  processDefinitionKey: string,
  tenantId: string | undefined,
  engine: string,
) {
  return useToolQuery<ActivityStatisticsData>(
    ["engine:activity-statistics", engine, processDefinitionKey, tenantId ?? null],
    ENGINE_ACTIVITY_STATISTICS_DATA,
    {
      processDefinitionKey,
      ...(tenantId === undefined ? {} : { tenantId }),
      source: "runtime",
      engine,
    },
  )
}

/**
 * The flow's "Running": what runs at each element now, every version summed onto the latest
 * diagram. Mounted only once the operator picks it, so the first paint reads nothing more; it
 * draws its own feed's diagram, the one its counts name.
 */
export function RunningFlow({
  processDefinitionKey,
  tenantId,
  engine,
  toolbar,
}: {
  processDefinitionKey: string
  /** The process's tenant, where it has one. */
  tenantId?: string | undefined
  engine: string
  /** The flow's mode switch with this mode's caption. */
  toolbar: (caption: string) => ReactNode
}) {
  const t = useT()
  const { context } = useHandOff()
  const running = useRunningData(processDefinitionKey, tenantId, engine)
  const data = running.data
  const decorations = useMemo(() => runningDecorations(data?.activities ?? []), [data?.activities])

  if (!data) {
    return (
      <>
        {toolbar(t("procIncFlow.loading"))}
        <ViewDataState
          loading={running.isLoading}
          error={running.error}
          onRetry={() => void running.refetch()}
          loadingText={t("procIncFlow.loading")}
          errorTitle={t("procIncFlow.runningLoadError")}
          emptyText={t("procIncFlow.noDataAvailable")}
        />
      </>
    )
  }

  return (
    <>
      <HostModelContext content={context(describeRunningFlow(data))}>{null}</HostModelContext>
      {toolbar(
        t("procIncFlow.runningCaption", {
          version: data.diagramVersion,
          count: formatNumber(data.versionCount),
        }),
      )}
      {data.diagramDefinitionId && (
        <BpmnDiagram
          definitionId={data.diagramDefinitionId}
          engineId={engine}
          decorations={decorations}
        />
      )}
      {data.activities.length === 0 ? (
        <TableEmptyState>{t("procIncFlow.noneRunning")}</TableEmptyState>
      ) : (
        <ActivityValues<ActivityStatisticsActivity>
          activities={data.activities}
          columns={[
            { label: t("procIncFlow.valuesColRunning"), value: (a) => a.running },
            { label: t("procIncFlow.valuesColIncidents"), value: (a) => a.incidents },
            // The quiet badge's words, at every width: the canvas draws it as a hidden drawing,
            // so where an element has one this column is its text alternative.
            ...(data.activities.some((a) => a.incidentsInCalledInstances > 0)
              ? [
                  {
                    label: t("procIncFlow.valuesColCalledIncidents"),
                    value: (a: ActivityStatisticsActivity) => a.incidentsInCalledInstances,
                  },
                ]
              : []),
            {
              label: t("procIncFlow.valuesColFailedJobs"),
              value: (a) => a.failedJobs,
              hideBelow: "sm",
            },
          ]}
        />
      )}
    </>
  )
}
