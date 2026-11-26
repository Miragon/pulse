import type { ReactNode } from "react"
import { ErrorState, Skeleton } from "@miragon/pulse-ui"
import {
  BpmnDiagram as Diagram,
  type DiagramDecoration,
  type DiagramMarker,
} from "@miragon/pulse-ui/bpmn"
import {
  QueryFallback,
  useDiagramMaxHeight,
  useToolQuery,
} from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/use-t.js"
import { ENGINE_BPMN_XML_DATA } from "../tool-names.js"

/**
 * What the cockpit draws on a diagram, in the one badge scheme of pulse-ui's `BpmnDiagram` (owner
 * decision 2026-11-24, the shared screens'): the counts of each element (`decorations`, a badge
 * each over its top right corner, an own root incident outlined) and the outlines an instance's
 * state gives without a count (`markers`).
 */
export interface DiagramMarks {
  decorations?: ReadonlyArray<DiagramDecoration>
  markers?: ReadonlyArray<DiagramMarker>
}

export interface BpmnDiagramProps extends DiagramMarks {
  /** Its XML is read by id from `engine_bpmn_xml_data`, never carried in the payload. */
  definitionId: string
  /** The engine the view reads (its payload's `engineId`); the default engine when absent. */
  engineId?: string
  /** A fixed frame height; default: the diagram's own (240–560 px, the kit's `diagramHeight`). */
  height?: number
}

interface DefinitionXml {
  processDefinitionId: string
  bpmnXml: string | null
}

/** The frame a loading diagram holds, so the view does not jump when it lands. */
const LOADING_HEIGHT = 240

/** Kept for good (`staleTime` Infinity): a redeploy mints a new id, so an id never answers differently. */
export function useDefinitionXml(definitionId: string, engineId?: string) {
  return useToolQuery<DefinitionXml>(
    ["engine:bpmn-xml", engineId ?? null, definitionId],
    ENGINE_BPMN_XML_DATA,
    { processDefinitionId: definitionId, ...(engineId ? { engine: engineId } : {}) },
    { staleTime: Infinity },
  )
}

export function BpmnDiagram({
  definitionId,
  engineId,
  height,
  decorations,
  markers,
}: BpmnDiagramProps) {
  return (
    <WithDefinitionXml definitionId={definitionId} engineId={engineId} height={height}>
      {(bpmnXml) => (
        <BpmnCanvas bpmnXml={bpmnXml} height={height} decorations={decorations} markers={markers} />
      )}
    </WithDefinitionXml>
  )
}

/**
 * Reads a version's diagram by id (`engine_bpmn_xml_data`) and draws it with `children`; while it
 * loads it holds the frame, and a failed or XML-less read says so.
 */
export function WithDefinitionXml({
  definitionId,
  engineId,
  height,
  children,
}: Pick<BpmnDiagramProps, "definitionId" | "engineId" | "height"> & {
  children: (bpmnXml: string) => ReactNode
}) {
  const t = useT()
  const xml = useDefinitionXml(definitionId, engineId)
  const bpmnXml = xml.data?.bpmnXml
  if (bpmnXml) return children(bpmnXml)
  if (xml.data) return <ErrorState variant="inline" title={t("bpmnDiagram.unavailable")} />
  return (
    <QueryFallback
      isError={xml.isError}
      error={xml.error}
      onRetry={() => void xml.refetch()}
      errorTitle={t("bpmnDiagram.loadError")}
      loadingText={t("bpmnDiagram.loading")}
      skeleton={
        <Skeleton
          className="w-full rounded-md"
          style={{ height: `${height ?? LOADING_HEIGHT}px` }}
        />
      }
    />
  )
}

/**
 * The cockpit's diagram: pulse-ui's `BpmnDiagram` on the canvas that follows the theme, as the
 * editors' canvas (D10, point 7), capped inline by the host's budget (320 px in a chat card) and
 * refitted whenever its frame resizes (inline to fullscreen). Its counts are a drawing beside the
 * canvas image: each view says them in words (its values per activity, its tables).
 */
export function BpmnCanvas({
  bpmnXml,
  height,
  decorations,
  markers,
}: DiagramMarks & { bpmnXml: string; height?: number }) {
  const t = useT()
  const maxHeight = useDiagramMaxHeight()
  return (
    <Diagram
      xml={bpmnXml}
      ariaLabel={t("bpmnDiagram.ariaLabel")}
      decorations={decorations}
      markers={markers}
      height={height}
      maxHeight={maxHeight}
      drawFailed={t("bpmnDiagram.renderError")}
    />
  )
}
