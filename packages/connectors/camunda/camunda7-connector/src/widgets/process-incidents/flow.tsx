import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, AlertDescription, useToolQuery, SectionHeading } from "@miragon/mcp-toolkit-ui"
import {
  BpmnHeatmap,
  HeatmapLegend,
  SegmentedControl,
  ViewDataState,
  WidgetShell,
  formatNumber,
  type SegmentedControlOption,
} from "@miragon/pulse-widget-shell/widgets"
import type { ProcessIncidentsData } from "../../view-models.js"
import { BpmnDiagram, useDefinitionXml, type BpmnHighlight } from "../bpmn-diagram.js"
import { useT } from "../../messages/use-t.js"
import { useAnalyticsActive } from "../cockpit-app/analytics-probe.js"
import { diagramActivityFraction } from "./activity-scope.js"
import { useDefinitionData } from "./feed.js"

type FlowMode = "incidents" | "frequency" | "duration"

interface HeatValues {
  frequency: Record<string, number>
  durationSec: Record<string, number>
}

/**
 * Mounted only when the operator leaves "Incidents", so the metrics query never runs on
 * first paint. Tier-2 raw tool name; a failing feed hides the heatmap modes instead of erroring.
 */
function ProcessHeatmap({
  processDefinitionKey,
  definitionId,
  engine,
  mode,
  onUnavailable,
}: {
  processDefinitionKey: string
  definitionId: string
  engine?: string
  mode: "frequency" | "duration"
  onUnavailable: () => void
}) {
  const t = useT()
  const xml = useDefinitionXml(definitionId, engine)
  const q = useToolQuery<HeatValues>(
    // Without engine + key the cache would leak one view's heatmap into another.
    ["camunda7:heatmap", engine ?? null, processDefinitionKey],
    "analytics_bpmn_heatmap_data",
    { processDefinitionKey, period: "30d", engine },
  )
  const unavailable = q.isError
  useEffect(() => {
    if (unavailable) onUnavailable()
  }, [unavailable, onUnavailable])
  if (unavailable) return null
  if (xml.isError || xml.data?.bpmnXml === null) {
    return (
      <Alert>
        <AlertDescription>{t("procIncFlow.heatmapNoDiagram")}</AlertDescription>
      </Alert>
    )
  }
  if (!q.data || !xml.data?.bpmnXml) {
    return (
      <div className="text-muted-foreground text-dense p-6">{t("procIncFlow.heatmapLoading")}</div>
    )
  }
  const values = mode === "frequency" ? q.data.frequency : q.data.durationSec
  return (
    <BpmnHeatmap
      bpmnXml={xml.data.bpmnXml}
      nodeFrequencies={values}
      diagramAriaLabel={t("procIncFlow.heatmapDiagramAria")}
      errorTitle={t("procIncFlow.heatmapErrorTitle")}
      errorHint={t("procIncFlow.heatmapErrorHint")}
      noHeatLabel={t("procIncFlow.heatmapNoValues")}
    />
  )
}

function activityHint(t: ReturnType<typeof useT>, data: ProcessIncidentsData): string {
  const fraction = diagramActivityFraction(data)
  if (fraction) {
    return t("procIncFlow.hintOfTotal", {
      count: formatNumber(fraction.affected),
      total: formatNumber(fraction.total),
    })
  }
  return t("procIncFlow.hint", { count: formatNumber(data.activities.length) })
}

function FlowModeToolbar({
  options,
  mode,
  onChange,
  heatmapUnavailable,
  incidentsCaption,
}: {
  options: SegmentedControlOption<FlowMode>[]
  mode: FlowMode
  onChange: (mode: FlowMode) => void
  heatmapUnavailable: boolean
  incidentsCaption: string
}) {
  const t = useT()
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <SegmentedControl<FlowMode>
        options={options}
        value={mode}
        onChange={onChange}
        ariaLabel={t("procIncFlow.modeAria")}
      />
      {mode === "incidents" ? (
        <span className="text-muted-foreground text-small">
          {incidentsCaption}
          {heatmapUnavailable && ` · ${t("procIncFlow.heatmapUnavailable")}`}
        </span>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-small">
            {mode === "frequency"
              ? t("procIncFlow.heatmapCaptionFrequency")
              : t("procIncFlow.heatmapCaptionDuration")}
          </span>
          <HeatmapLegend
            lessLabel={t("procIncFlow.legendLess")}
            moreLabel={t("procIncFlow.legendMore")}
          />
        </div>
      )}
    </div>
  )
}

/** Leads with incidents; the heatmap modes join only once analytics is confirmed active. */
export function ProcessDefinitionFlow({
  data: initialData = null,
  processDefinitionKey,
  engine,
}: {
  data?: ProcessIncidentsData | null
  processDefinitionKey?: string
  engine?: string
}) {
  const t = useT()
  const { data, loading, error, refetch } = useDefinitionData(
    initialData,
    processDefinitionKey,
    engine,
  )
  const [chosenMode, setMode] = useState<FlowMode>("incidents")
  const [heatmapUnavailable, setHeatmapUnavailable] = useState(false)
  const heatmapOffered = useAnalyticsActive() && !heatmapUnavailable
  const mode: FlowMode = heatmapOffered ? chosenMode : "incidents"
  // Both halves in the handler: deriving the fallback in an effect would commit an empty heatmap first.
  const markHeatmapUnavailable = useCallback(() => {
    setHeatmapUnavailable(true)
    setMode("incidents")
  }, [])

  const highlights = useMemo<BpmnHighlight[]>(() => {
    const activities = data?.activities ?? []
    return [
      {
        kind: "incident",
        activityIds: activities.map((a) => a.activityId),
        counts: activities.map((a) => ({ activityId: a.activityId, count: a.incidentCount })),
      },
    ]
  }, [data?.activities])

  if (!data) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={loading}
          error={error}
          onRetry={refetch}
          loadingText={t("procIncFlow.loading")}
          emptyText={t("procIncFlow.noDataAvailable")}
        />
      </WidgetShell>
    )
  }

  const modeOptions: SegmentedControlOption<FlowMode>[] = heatmapOffered
    ? [
        { value: "incidents", label: t("procIncFlow.modeIncidents") },
        { value: "frequency", label: t("procIncFlow.modeFrequency") },
        { value: "duration", label: t("procIncFlow.modeDuration") },
      ]
    : [{ value: "incidents", label: t("procIncFlow.modeIncidents") }]

  return (
    <WidgetShell>
      <section>
        <SectionHeading title={t("procIncFlow.title")} hint={activityHint(t, data)} />
        {data.diagramDefinitionId ? (
          <>
            <FlowModeToolbar
              options={modeOptions}
              mode={mode}
              onChange={setMode}
              heatmapUnavailable={heatmapUnavailable}
              incidentsCaption={t("procIncFlow.diagramVersion", { version: data.diagramVersion })}
            />
            {mode === "incidents" ? (
              <BpmnDiagram
                definitionId={data.diagramDefinitionId}
                engineId={engine ?? data.engineId}
                highlights={highlights}
              />
            ) : (
              <ProcessHeatmap
                processDefinitionKey={data.processDefinitionKey}
                definitionId={data.diagramDefinitionId}
                // Without it the feed aggregates across the whole fleet.
                engine={engine ?? data.engineId}
                mode={mode}
                onUnavailable={markHeatmapUnavailable}
              />
            )}
          </>
        ) : (
          <Alert>
            <AlertDescription>{t("procIncFlow.noBpmnDiagram")}</AlertDescription>
          </Alert>
        )}
      </section>
    </WidgetShell>
  )
}
