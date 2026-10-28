import { Skeleton, useToolQuery } from "@miragon/mcp-toolkit-ui"
import {
  BpmnHeatmapWidget,
  QueryFallback,
  ViewMeta,
  formatLookback,
  type BpmnHeatmapData,
} from "@miragon/pulse-widget-shell/widgets"

import type { BpmnMissingReason } from "../heatmap-data.js"
import { useT } from "../messages/use-t.js"
import { ANALYTICS_BPMN_XML_DATA } from "../tool-names.js"
import { enginesMeta } from "./view-meta.js"

/** The diagram is NOT in it (read from `analytics_bpmn_xml_data`), so the model never sees the XML. */
export interface AnalyticsBpmnHeatmapData extends Omit<BpmnHeatmapData, "bpmnXml"> {
  engines: string[]
  /** Absent in payloads recorded before it existed. */
  asOf?: string
  /** Absent when a diagram exists. */
  bpmnMissing?: BpmnMissingReason
}

interface HeatmapDiagram {
  bpmnXml: string | null
  bpmnMissing?: BpmnMissingReason
}

/** The widget never guesses why the diagram is missing. */
const BPMN_MISSING_KEY: Record<BpmnMissingReason, string> = {
  "no-camunda7": "aHeatmap.bpmnNoCamunda7",
  "not-loaded": "aHeatmap.bpmnNotLoaded",
}

function bpmnMissingKey(data: Pick<AnalyticsBpmnHeatmapData, "bpmnMissing"> | null) {
  const reason = data?.bpmnMissing
  return reason && Object.hasOwn(BPMN_MISSING_KEY, reason)
    ? BPMN_MISSING_KEY[reason]
    : "aHeatmap.bpmnUnavailable"
}

/** The shell carries no module i18n, so this binds `useT()` to it. */
function useHeatmapWithDiagram(data: AnalyticsBpmnHeatmapData | null) {
  const hasDiagram = data !== null && data.bpmnMissing === undefined
  const diagram = useToolQuery<HeatmapDiagram>(
    ["analytics:bpmn-xml", data?.processDefinitionKey ?? null, data?.engines ?? null],
    ANALYTICS_BPMN_XML_DATA,
    { processDefinitionKey: data?.processDefinitionKey ?? "", engine: data?.engines },
    { enabled: hasDiagram },
  )
  const full: (BpmnHeatmapData & Pick<AnalyticsBpmnHeatmapData, "bpmnMissing">) | null = data && {
    ...data,
    bpmnXml: diagram.data?.bpmnXml ?? null,
    bpmnMissing: data.bpmnMissing ?? diagram.data?.bpmnMissing,
  }
  return { diagram, pending: hasDiagram && !diagram.data, full }
}

export function AnalyticsBpmnHeatmap({ data }: { data: AnalyticsBpmnHeatmapData | null }) {
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
        data && (
          <ViewMeta
            period={formatLookback(data.period)}
            engines={enginesMeta(data.engines)}
            asOf={data.asOf}
          />
        )
      }
      labels={{
        title: t("aHeatmap.title"),
        window: t("aHeatmap.window"),
        frequency: t("aHeatmap.frequency"),
        duration: t("aHeatmap.duration"),
        frequencyLegend: t("aHeatmap.frequencyLegend"),
        durationLegend: t("aHeatmap.durationLegend"),
        noData: t("aHeatmap.noData"),
        noHeat: t("aHeatmap.noHeat"),
        bpmnUnavailable: t(bpmnMissingKey(full)),
        less: t("aHeatmap.less"),
        more: t("aHeatmap.more"),
        diagramAriaLabel: t("aHeatmap.diagramAria"),
        errorTitle: t("aHeatmap.errorTitle"),
        errorHint: t("aHeatmap.errorHint"),
      }}
    />
  )
}
