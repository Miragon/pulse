import { useCallback, useMemo, useState } from "react"
import {
  Alert,
  AlertDescription,
  SectionHeading,
  SegmentedControl,
  formatNumber,
  type SegmentedControlOption,
} from "@miragon/pulse-ui"
import {
  HostWidgetSlot,
  ViewDataState,
  WidgetShell,
  useHostWidget,
} from "@miragon/pulse-widget-shell/widgets"
import type { ProcessIncidentsData } from "../../view-models.js"
import { BpmnDiagram, useDefinitionXml, type BpmnHighlight } from "../bpmn-diagram.js"
import { useT } from "../../messages/use-t.js"
import { useAnalyticsActive } from "../cockpit-app/analytics-probe.js"
import { diagramActivityFraction } from "./activity-scope.js"
import { useDefinitionData, type DefinitionScope } from "./feed.js"

type FlowMode = "incidents" | "frequency" | "duration"
type HeatMode = Exclude<FlowMode, "incidents">

/**
 * Analytics' widgets by their raw ids, without a module-to-module import: the heat of this
 * process on the diagram, and its legend in the toolbar. They fetch the heat themselves; the app's
 * `view-registry.test.ts` holds each id to a registered host widget, and
 * `process-definition-flow.test.tsx` pins the props passed here.
 */
export const PROCESS_HEATMAP_WIDGET = "analytics:process-heatmap"
export const PROCESS_HEATMAP_LEGEND_WIDGET = "analytics:process-heatmap-legend"

/**
 * Mounted only when the operator leaves "Incidents", so the metrics query never runs on first
 * paint. The diagram is this module's (the version the flow draws); a failing heat feed calls
 * `onUnavailable`, which hides the heatmap modes instead of erroring.
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
  engine: string
  mode: HeatMode
  onUnavailable: () => void
}) {
  const xml = useDefinitionXml(definitionId, engine)
  // undefined while the diagram loads, null when there is none.
  const bpmnXml = xml.isError || xml.data?.bpmnXml === null ? null : xml.data?.bpmnXml
  return (
    <HostWidgetSlot
      id={PROCESS_HEATMAP_WIDGET}
      props={{ processDefinitionKey, engine, mode, bpmnXml, onUnavailable }}
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
        <HostWidgetSlot id={PROCESS_HEATMAP_LEGEND_WIDGET} props={{ mode }} />
      )}
    </div>
  )
}

/**
 * Leads with incidents; the heatmap modes join only once analytics is confirmed active and its
 * heatmap widgets are in this bundle.
 */
export function ProcessDefinitionFlow(scope: DefinitionScope) {
  const t = useT()
  const { engine } = scope
  const { data, loading, error, refetch } = useDefinitionData(scope)
  const [chosenMode, setMode] = useState<FlowMode>("incidents")
  const [heatmapUnavailable, setHeatmapUnavailable] = useState(false)
  const heatmapWidget = useHostWidget(PROCESS_HEATMAP_WIDGET)
  const legendWidget = useHostWidget(PROCESS_HEATMAP_LEGEND_WIDGET)
  const analyticsActive = useAnalyticsActive()
  const heatmapOffered =
    analyticsActive &&
    heatmapWidget !== undefined &&
    legendWidget !== undefined &&
    !heatmapUnavailable
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
                engineId={engine}
                highlights={highlights}
              />
            ) : (
              <ProcessHeatmap
                processDefinitionKey={data.processDefinitionKey}
                definitionId={data.diagramDefinitionId}
                // Without it the feed aggregates across the whole fleet.
                engine={engine}
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
