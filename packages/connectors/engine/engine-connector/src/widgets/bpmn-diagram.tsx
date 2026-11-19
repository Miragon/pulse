import { useEffect, type ReactNode } from "react"
import { ErrorState, Skeleton } from "@miragon/pulse-ui"
import {
  BpmnZoomControls,
  QueryFallback,
  useBpmnViewer,
  useHostDisplayMode,
  useToolQuery,
} from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/use-t.js"
import { ENGINE_BPMN_XML_DATA } from "../tool-names.js"
import { applyHighlights, type BpmnHighlight } from "./bpmn-highlights.js"

// Re-exported so callers import the diagram and its highlight type from one place.
export { applyHighlights, dedupe, HIGHLIGHT_COLORS, type BpmnHighlight } from "./bpmn-highlights.js"

export interface BpmnDiagramProps {
  /** Its XML is read by id from `engine_bpmn_xml_data`, never carried in the payload. */
  definitionId: string
  /** The engine the view reads (its payload's `engineId`); the default engine when absent. */
  engineId?: string
  /** A fixed frame height; default: the diagram's own (240–560 px, the kit's `diagramHeight`). */
  height?: number
  highlights?: ReadonlyArray<BpmnHighlight>
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

export function BpmnDiagram({ definitionId, engineId, height, highlights }: BpmnDiagramProps) {
  return (
    <WithDefinitionXml definitionId={definitionId} engineId={engineId} height={height}>
      {(bpmnXml) => <BpmnCanvas bpmnXml={bpmnXml} height={height} highlights={highlights} />}
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

// Stable default: an inline `[]` would force a bpmn-js re-import on every render via `reimportKey`.
const NO_HIGHLIGHTS: ReadonlyArray<BpmnHighlight> = []

/** The marks the first zoom in centres, by the markers' own priority; running counts mark none. */
const MARK_ORDER = ["incident", "open-task", "active", "failed-jobs"] as const

/** Where the first zoom in centres: the elements of the first kind the view marks. */
export function markedIdsOf(highlights: ReadonlyArray<BpmnHighlight>): ReadonlyArray<string> {
  for (const kind of MARK_ORDER) {
    const marked = highlights.flatMap((h) => {
      if (h.kind !== kind) return []
      return "activityIds" in h ? h.activityIds : h.counts.map((c) => c.activityId)
    })
    if (marked.length > 0) return marked
  }
  return []
}

export function BpmnCanvas({
  bpmnXml,
  height,
  highlights = NO_HIGHLIGHTS,
}: {
  bpmnXml: string
  height?: number
  highlights?: ReadonlyArray<BpmnHighlight>
}) {
  const t = useT()
  const displayMode = useHostDisplayMode()

  const {
    containerRef,
    height: autoHeight,
    importError,
    zoomIn,
    zoomOut,
    fit,
  } = useBpmnViewer({
    bpmnXml,
    // A changed highlight set redecorates via a full re-import: bpmn-js
    // markers/overlays are only ever added, never removed.
    reimportKey: highlights,
    fitOnResize: true,
    markedIds: markedIdsOf(highlights),
    // The canvas alone is the image: the zoom controls, bpmn.io's link and the badges lie beside it.
    ariaLabel: t("bpmnDiagram.ariaLabel"),
    onImported: (imported) => {
      applyHighlights(imported.get("canvas"), imported.get("overlays"), highlights)
    },
  })

  // Host layout switches (inline ↔ fullscreen) resize the container: refit.
  useEffect(() => {
    fit()
  }, [displayMode, fit])

  // The paper, its zoom bar and its error follow the theme, as the editors' canvas (D10, point 7).
  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="border-border rounded-md border"
        style={{ height: `${height ?? autoHeight}px`, width: "100%" }}
      />
      {importError !== null && (
        <div className="p-gutter absolute inset-0 grid place-items-center">
          <ErrorState variant="inline" title={t("bpmnDiagram.renderError")} details={importError} />
        </div>
      )}
      <BpmnZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
    </div>
  )
}
