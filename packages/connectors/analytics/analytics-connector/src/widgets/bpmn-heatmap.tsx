import { Skeleton } from "@miragon/pulse-ui"
import {
  QueryFallback,
  ViewMeta,
  formatLookback,
  useToolQuery,
} from "@miragon/pulse-widget-shell/widgets"

import type { BpmnMissingReason } from "../heatmap-data.js"
import { useT } from "../messages/use-t.js"
import { ANALYTICS_BPMN_XML_DATA } from "../tool-names.js"
import { BpmnHeatmapWidget, type BpmnHeatmapData } from "./heatmap/bpmn-heatmap-widget.js"
import { enginesMeta } from "./view-meta.js"

/** The diagram is NOT in it (read from `analytics_bpmn_xml_data`), so the model never sees the XML. */
export interface AnalyticsBpmnHeatmapData extends Omit<BpmnHeatmapData, "bpmnXml"> {
  engines: string[]
  asOf: string
  /** Absent when a diagram exists. */
  bpmnMissing?: BpmnMissingReason
}

interface HeatmapDiagram {
  bpmnXml: string | null
  bpmnMissing?: BpmnMissingReason
}

/** The widget never guesses why the diagram is missing. */
const BPMN_MISSING_KEY: Record<BpmnMissingReason, string> = {
  "no-engine-module": "aHeatmap.bpmnNoEngineModule",
  "not-loaded": "aHeatmap.bpmnNotLoaded",
}

function bpmnMissingKey(data: Pick<AnalyticsBpmnHeatmapData, "bpmnMissing">) {
  const reason = data.bpmnMissing
  return reason && Object.hasOwn(BPMN_MISSING_KEY, reason)
    ? BPMN_MISSING_KEY[reason]
    : "aHeatmap.bpmnUnavailable"
}

/** The diagram from its own feed, so the view's payload carries no XML. */
function useHeatmapWithDiagram(data: AnalyticsBpmnHeatmapData) {
  const hasDiagram = data.bpmnMissing === undefined
  const diagram = useToolQuery<HeatmapDiagram>(
    ["analytics:bpmn-xml", data.processDefinitionKey, data.engines],
    ANALYTICS_BPMN_XML_DATA,
    { processDefinitionKey: data.processDefinitionKey, engine: data.engines },
    { enabled: hasDiagram },
  )
  const full: BpmnHeatmapData & Pick<AnalyticsBpmnHeatmapData, "bpmnMissing"> = {
    ...data,
    bpmnXml: diagram.data?.bpmnXml ?? null,
    bpmnMissing: data.bpmnMissing ?? diagram.data?.bpmnMissing,
  }
  return { diagram, pending: hasDiagram && !diagram.data, full }
}

export function AnalyticsBpmnHeatmap({ data }: { data: AnalyticsBpmnHeatmapData }) {
  const t = useT()
  const { diagram, pending, full } = useHeatmapWithDiagram(data)
  if (pending) {
    return (
      <QueryFallback
        isError={diagram.isError}
        error={diagram.error}
        onRetry={() => void diagram.refetch()}
        errorTitle={t("aHeatmap.errorTitle")}
        skeleton={<Skeleton className="h-60 w-full rounded-md" />}
      />
    )
  }
  return (
    <BpmnHeatmapWidget
      data={full}
      meta={
        <ViewMeta
          period={formatLookback(data.period)}
          engines={enginesMeta(data.engines)}
          asOf={data.asOf}
        />
      }
      bpmnUnavailable={t(bpmnMissingKey(full))}
    />
  )
}
