import { useMemo, type ReactNode } from "react"
import {
  Alert,
  AlertDescription,
  TableEmptyState,
  formatDate,
  formatNumber,
  formatTime,
} from "@miragon/pulse-ui"
import { HostModelContext, ViewDataState, useToolQuery } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../messages/use-t.js"
import { ENGINE_ACTIVITY_STATISTICS_DATA } from "../../tool-names.js"
import type { ActivityThroughputActivity, ActivityThroughputData } from "../../view-models.js"
import { WithDefinitionXml } from "../bpmn-diagram.js"
import { useHandOff } from "../lib/hand-off.js"
import { ActivityValues } from "./activity-values.js"
import { BpmnHeatmap, HeatmapLegend } from "./heat/heat-diagram.js"
import { weightRange } from "./heat/heat-utils.js"
import { describeThroughputFlow, passesByElement, THROUGHPUT_QUERY_ROOT } from "./throughput.js"

const NO_SECONDS = { seconds: false }

/**
 * Read once per mount and kept: no stale refetch, no automatic retry (a timed-out read keeps
 * running in the engine's database), and outside the cockpit's Refresh.
 */
function useThroughputData(processDefinitionKey: string, engine: string) {
  return useToolQuery<ActivityThroughputData>(
    [THROUGHPUT_QUERY_ROOT, engine, processDefinitionKey],
    ENGINE_ACTIVITY_STATISTICS_DATA,
    { processDefinitionKey, source: "history", engine },
    { staleTime: Infinity, retry: false },
  )
}

/**
 * The flow's "Throughput": what the instances started in the window passed at each element, read
 * from the engine's history, as heat on the latest diagram. Mounted only once the operator picks
 * it; an engine without history, or one that keeps none of the process, says so instead of
 * drawing a cold diagram.
 */
export function ThroughputFlow({
  processDefinitionKey,
  engine,
  toolbar,
}: {
  processDefinitionKey: string
  engine: string
  /** The flow's mode switch with this mode's caption. */
  toolbar: (caption: string) => ReactNode
}) {
  const t = useT()
  const { context } = useHandOff()
  const query = useThroughputData(processDefinitionKey, engine)
  const data = query.data
  const values = useMemo(() => passesByElement(data?.activities ?? []), [data?.activities])

  if (!data) {
    return (
      <>
        {toolbar(t("procIncFlow.loading"))}
        <ViewDataState
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          loadingText={t("procIncFlow.loading")}
          errorTitle={t("procIncFlow.throughputLoadError")}
          emptyText={t("procIncFlow.noDataAvailable")}
        />
      </>
    )
  }

  const since = {
    date: formatDate(data.startedAfter),
    time: formatTime(data.startedAfter, NO_SECONDS),
  }
  const range = weightRange(Object.values(values))
  return (
    <>
      <HostModelContext content={context(describeThroughputFlow(data))}>{null}</HostModelContext>
      {toolbar(
        t("procIncFlow.throughputCaption", {
          version: data.diagramVersion,
          count: formatNumber(data.instanceCount),
          ...since,
          versions: formatNumber(data.versionsRead),
        }),
      )}
      {data.historyRecorded === false || data.windowDays === 0 ? (
        <Alert>
          <AlertDescription>
            {t(
              data.historyRecorded === false
                ? "procIncFlow.noHistory"
                : "procIncFlow.historyNotKept",
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {data.diagramDefinitionId && (
            <WithDefinitionXml definitionId={data.diagramDefinitionId} engineId={engine}>
              {(bpmnXml) => (
                <BpmnHeatmap
                  bpmnXml={bpmnXml}
                  values={values}
                  ariaLabel={t("procIncFlow.heatAria")}
                />
              )}
            </WithDefinitionXml>
          )}
          {/* The window: a cut by the history time to live, the read's time, the ramp's ends. */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground text-small">
              {data.cappedByHistoryTimeToLive &&
                `${t("procIncFlow.throughputCapped", { days: formatNumber(data.windowDays) })} `}
              {data.uncountedInstances > 0 &&
                `${t("procIncFlow.throughputUncounted", { count: formatNumber(data.uncountedInstances) })} `}
              {t("procIncFlow.throughputNote", { time: formatTime(data.readAt, NO_SECONDS) })}
            </span>
            {range && <HeatmapLegend min={formatNumber(range.min)} max={formatNumber(range.max)} />}
          </div>
          {data.activities.length === 0 ? (
            <TableEmptyState>{t("procIncFlow.noneStarted", since)}</TableEmptyState>
          ) : (
            <ActivityValues<ActivityThroughputActivity>
              activities={data.activities}
              columns={[
                { label: t("procIncFlow.valuesColPassed"), value: (a) => a.passed },
                { label: t("procIncFlow.valuesColRunning"), value: (a) => a.running },
                {
                  label: t("procIncFlow.valuesColCanceled"),
                  value: (a) => a.canceled,
                  hideBelow: "sm",
                },
              ]}
            />
          )}
        </>
      )}
    </>
  )
}
