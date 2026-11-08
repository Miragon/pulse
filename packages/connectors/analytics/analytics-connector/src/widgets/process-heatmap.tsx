import { useEffect } from "react"
import { Alert, AlertDescription } from "@miragon/pulse-ui"
import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/use-t.js"
import { ANALYTICS_BPMN_HEATMAP_DATA } from "../tool-names.js"
import { BpmnHeatmap, HeatmapLegend } from "./heatmap/heat-diagram.js"
import type { BpmnHeatmapData, HeatMode } from "./heatmap/bpmn-heatmap-widget.js"

/**
 * The heat of one process definition on another module's diagram, rendered by raw id
 * (`HostWidgetSlot`): the legend in the caller's toolbar and the heatmap below it. The engine
 * module's process flow no longer renders them. The ids and their props are the contract, so keep
 * them stable: `process-heatmap.test.tsx` pins them.
 */
export const PROCESS_HEATMAP_WIDGET = "analytics:process-heatmap"
export const PROCESS_HEATMAP_LEGEND_WIDGET = "analytics:process-heatmap-legend"

/** The window the caption names ("30 days"). */
const PERIOD = "30d"

export interface ProcessHeatmapProps {
  processDefinitionKey: string
  /** Without it the feed aggregates across the whole fleet. */
  engine: string
  mode: HeatMode
  /** The diagram the caller draws: undefined while it loads, null when there is none. */
  bpmnXml: string | null | undefined
  /** The feed failed (analytics inactive, Prometheus down): the caller hides the heat modes. */
  onUnavailable: () => void
}

function isHeatMode(value: unknown): value is HeatMode {
  return value === "frequency" || value === "duration"
}

/** The props another module passes by raw id; null when they are not the contract's. */
export function readProcessHeatmapProps(
  props: Record<string, unknown>,
): ProcessHeatmapProps | null {
  const { processDefinitionKey, engine, mode, bpmnXml, onUnavailable } = props
  if (typeof processDefinitionKey !== "string" || typeof engine !== "string") return null
  if (!isHeatMode(mode) || typeof onUnavailable !== "function") return null
  if (bpmnXml !== undefined && bpmnXml !== null && typeof bpmnXml !== "string") return null
  return {
    processDefinitionKey,
    engine,
    mode,
    bpmnXml,
    // Passed through, not wrapped: a fresh identity per render would re-run the effect below.
    onUnavailable: onUnavailable as () => void,
  }
}

/** Mounted only once the operator leaves "Incidents", so the metrics query never runs on first paint. */
function ProcessHeatmap({
  processDefinitionKey,
  engine,
  mode,
  bpmnXml,
  onUnavailable,
}: ProcessHeatmapProps) {
  const t = useT()
  const q = useToolQuery<Pick<BpmnHeatmapData, "frequency" | "durationMs">>(
    // Without engine + key the cache would leak one view's heatmap into another; the
    // `analytics:` root keeps it under the cockpit's Refresh.
    ["analytics:process-heatmap", engine, processDefinitionKey],
    ANALYTICS_BPMN_HEATMAP_DATA,
    { processDefinitionKey, period: PERIOD, engine },
  )
  const unavailable = q.isError
  useEffect(() => {
    if (unavailable) onUnavailable()
  }, [unavailable, onUnavailable])
  if (unavailable) return null
  if (bpmnXml === null) {
    return (
      <Alert>
        <AlertDescription>{t("aProcessHeatmap.noDiagram")}</AlertDescription>
      </Alert>
    )
  }
  if (!q.data || !bpmnXml) {
    return (
      <div className="text-muted-foreground text-dense p-6">{t("aProcessHeatmap.loading")}</div>
    )
  }
  const values = mode === "frequency" ? q.data.frequency : q.data.durationMs
  return (
    <BpmnHeatmap
      bpmnXml={bpmnXml}
      nodeFrequencies={values}
      diagramAriaLabel={t("aProcessHeatmap.diagramAria")}
      errorTitle={t("aProcessHeatmap.errorTitle")}
      errorHint={t("aProcessHeatmap.errorHint")}
      noHeatLabel={t("aProcessHeatmap.noValues")}
    />
  )
}

/**
 * `analytics:process-heatmap`. Props outside the contract (a caller that drifted from it) render
 * nothing and report to the caller's fallback when it passed one, as a failing feed does, so the
 * caller shows its incidents again instead of an empty area.
 */
export function ProcessHeatmapHostWidget(props: Record<string, unknown>) {
  const parsed = readProcessHeatmapProps(props)
  const refused = parsed === null
  const fallback =
    typeof props.onUnavailable === "function" ? (props.onUnavailable as () => void) : undefined
  useEffect(() => {
    if (refused) fallback?.()
  }, [refused, fallback])
  return parsed ? <ProcessHeatmap {...parsed} /> : null
}

/** `analytics:process-heatmap-legend`, `{ mode }`: the caption and the ramp next to the caller's mode switch. */
export function ProcessHeatmapLegendHostWidget(props: Record<string, unknown>) {
  const t = useT()
  if (!isHeatMode(props.mode)) return null
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-small">
        {props.mode === "frequency"
          ? t("aProcessHeatmap.captionFrequency")
          : t("aProcessHeatmap.captionDuration")}
      </span>
      <HeatmapLegend />
    </div>
  )
}
