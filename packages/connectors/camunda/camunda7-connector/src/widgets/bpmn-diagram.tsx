import { useEffect } from "react"
import { ErrorState, Skeleton, useToolQuery } from "@miragon/mcp-toolkit-ui"
import {
  BpmnZoomControls,
  QueryFallback,
  injectBpmnOverlayCss,
  useBpmnViewer,
  useHostDisplayMode,
} from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/use-t.js"
import { CAMUNDA7_BPMN_XML_DATA } from "../tool-names.js"
import { applyHighlights, type BpmnHighlight } from "./bpmn-highlights.js"

// Re-exported so callers import the diagram and its highlight type from one place.
export { applyHighlights, dedupe, HIGHLIGHT_COLORS, type BpmnHighlight } from "./bpmn-highlights.js"

export interface BpmnDiagramProps {
  /** Its XML is read by id from `camunda7_bpmn_xml_data`, never carried in the payload. */
  definitionId: string
  /** The engine the view reads (its payload's `engineId`); the caller's default when absent. */
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
    ["camunda7:bpmn-xml", engineId ?? null, definitionId],
    CAMUNDA7_BPMN_XML_DATA,
    { processDefinitionId: definitionId, ...(engineId ? { engine: engineId } : {}) },
    { staleTime: Infinity },
  )
}

export function BpmnDiagram({ definitionId, engineId, height, highlights }: BpmnDiagramProps) {
  const t = useT()
  const xml = useDefinitionXml(definitionId, engineId)
  const bpmnXml = xml.data?.bpmnXml
  if (bpmnXml) return <BpmnCanvas bpmnXml={bpmnXml} height={height} highlights={highlights} />
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
    // A changed highlight set redecorates via a full re-import — bpmn-js
    // markers/overlays are only ever added, never removed.
    reimportKey: highlights,
    fitOnResize: true,
    onImported: (imported) => {
      injectBpmnOverlayCss()
      applyHighlights(imported.get("canvas"), imported.get("overlays"), highlights)
    },
  })

  // Host layout switches (inline ↔ fullscreen) resize the container — refit.
  useEffect(() => {
    fit()
  }, [displayMode, fit])

  // The paper, its zoom bar and its error stay light in a dark host (CI §10).
  return (
    <div data-theme-mode="light" className="relative">
      <div
        ref={containerRef}
        role="img"
        aria-label={t("bpmnDiagram.ariaLabel")}
        className="border-border rounded-md border"
        style={{ height: `${height ?? autoHeight}px`, width: "100%" }}
      />
      {importError !== null && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <ErrorState variant="inline" title={t("bpmnDiagram.renderError")} details={importError} />
        </div>
      )}
      <BpmnZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
    </div>
  )
}
