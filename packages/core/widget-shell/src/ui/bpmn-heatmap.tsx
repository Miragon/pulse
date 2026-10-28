import { useEffect, useRef } from "react"
import { ErrorState, useLocale } from "@miragon/mcp-toolkit-ui"
import {
  buildGradientLut,
  buildHeatPoints,
  drawHeatLayer,
  HEAT_GRADIENT_CSS,
  HEAT_PEAK_ALPHA,
  weightRange,
  type HeatPoint,
} from "./bpmn-heatmap/heat-utils.js"
import { DEFAULT_HEATMAP_LABELS, type BpmnHeatmapLabels } from "./bpmn-heatmap-labels.js"
import { BpmnZoomControls } from "./bpmn-zoom-controls.js"
import { kitLabels } from "./kit-labels.js"
import { useBpmnViewer } from "./use-bpmn-viewer.js"

// A `= {}` parameter default would be a fresh identity per render and re-trigger the repaint effect.
const EMPTY_EDGES: Record<string, number> = {}

export type { BpmnHeatmapLabels }

export interface BpmnHeatmapProps {
  bpmnXml: string
  nodeFrequencies: Record<string, number>
  /** Per-edge value keyed by `${sourceId}->${targetId}`. Metrics carry none → `{}`. */
  edgeFrequencies?: Record<string, number>
  /** A fixed frame height; default: the diagram's own (240–560 px, `diagramHeight`). */
  height?: number
  diagramRadius?: number
  /** Accessible name for the diagram (localize per module; English fallback). */
  diagramAriaLabel?: string
  errorTitle?: string
  /** No fallback, so a caller without a localized hint shows no English sentence. */
  errorHint?: string
  /** Without it an empty result (no traffic, or a mismatched metrics `engine_id`) looks like a rendered heatmap. */
  noHeatLabel?: string
}

/** The viewer mounts once per `bpmnXml`; new heat values only repaint the overlay. One hue, never red (red is for incidents); the frame is a forced-light island. */
export function BpmnHeatmap({
  bpmnXml,
  nodeFrequencies,
  edgeFrequencies = EMPTY_EDGES,
  height,
  diagramRadius = 55,
  diagramAriaLabel = DEFAULT_HEATMAP_LABELS.diagramAriaLabel,
  errorTitle = DEFAULT_HEATMAP_LABELS.errorTitle,
  errorHint,
  noHeatLabel = DEFAULT_HEATMAP_LABELS.noHeat,
}: BpmnHeatmapProps) {
  const heatCanvasRef = useRef<HTMLCanvasElement>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  // Synced in an effect, not during render, so a discarded render cannot leak into the ref; declared before the repaint effect so redraw() sees this commit's values.
  const dataRef = useRef({ nodeFrequencies, edgeFrequencies, diagramRadius })
  useEffect(() => {
    dataRef.current = { nodeFrequencies, edgeFrequencies, diagramRadius }
  })

  const {
    containerRef,
    height: autoHeight,
    importError,
    zoomIn,
    zoomOut,
    fit,
  } = useBpmnViewer({
    bpmnXml,
    onImported: (imported) => {
      const gradientLut = buildGradientLut()
      const canvas = imported.get("canvas")
      const elementRegistry = imported.get("elementRegistry")
      const eventBus = imported.get("eventBus")

      const redraw = () => {
        const heatCanvas = heatCanvasRef.current
        const container = containerRef.current
        if (!heatCanvas || !container) return
        const rect = container.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        if (
          heatCanvas.width !== Math.round(rect.width * dpr) ||
          heatCanvas.height !== Math.round(rect.height * dpr)
        ) {
          heatCanvas.width = Math.round(rect.width * dpr)
          heatCanvas.height = Math.round(rect.height * dpr)
          heatCanvas.style.width = `${rect.width}px`
          heatCanvas.style.height = `${rect.height}px`
        }
        const ctx = heatCanvas.getContext("2d")
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        const { nodeFrequencies: nf, edgeFrequencies: ef, diagramRadius: dr } = dataRef.current
        const heatPoints = buildHeatPoints(elementRegistry.getAll(), nf, ef)
        const range = weightRange(heatPoints.map((p) => p.weight)) ?? { min: 0, max: 0 }
        const vb = canvas.viewbox()
        const scale = vb.scale
        const screenPoints: HeatPoint[] = heatPoints.map((p) => ({
          x: (p.x - vb.x) * scale,
          y: (p.y - vb.y) * scale,
          weight: p.weight,
        }))
        const radiusPx = Math.max(20, dr * scale)
        drawHeatLayer(
          ctx,
          rect.width,
          rect.height,
          heatCanvas.width,
          heatCanvas.height,
          screenPoints,
          range,
          radiusPx,
          gradientLut,
        )
      }

      redrawRef.current = redraw
      redraw()
      const onChange = () => redraw()
      eventBus.on("canvas.viewbox.changed", onChange)
      eventBus.on("canvas.resized", onChange)
      // Resize only repaints the overlay — the operator's pan/zoom is kept.
      const ro = new ResizeObserver(() => redraw())
      if (containerRef.current) ro.observe(containerRef.current)
      return () => {
        eventBus.off("canvas.viewbox.changed", onChange)
        eventBus.off("canvas.resized", onChange)
        ro.disconnect()
        redrawRef.current = null
      }
    },
  })

  useEffect(() => {
    redrawRef.current?.()
  }, [nodeFrequencies, edgeFrequencies, diagramRadius])

  // Mirrors buildHeatPoints' `weight > 0`: a map of zeros must read as "no data" too.
  const hasHeat =
    Object.values(nodeFrequencies).some((v) => v > 0) ||
    Object.values(edgeFrequencies).some((v) => v > 0)

  return (
    <div
      data-theme-mode="light"
      className="relative w-full"
      style={{ height: `${height ?? autoHeight}px` }}
    >
      <div
        ref={containerRef}
        role="img"
        aria-label={diagramAriaLabel}
        className="border-border absolute inset-0 size-full rounded-md border"
      />
      <canvas
        ref={heatCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full rounded-md"
        style={{ mixBlendMode: "multiply" }}
      />
      {importError ? (
        <div className="absolute inset-x-3 top-3">
          <ErrorState
            variant="inline"
            title={errorTitle}
            description={errorHint}
            details={importError}
          />
        </div>
      ) : (
        <>
          {hasHeat ? null : (
            <div
              role="status"
              className="border-border bg-card text-muted-foreground text-small shadow-1 pointer-events-none absolute top-3 left-3 rounded-sm border px-2 py-1"
            >
              {noHeatLabel}
            </div>
          )}
          <BpmnZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
        </>
      )}
    </div>
  )
}

/** The layer maps the range linearly onto the swatch, so the ends are the values they encode; one value for every element shows once, at the full end. */
export function HeatmapLegend({
  min,
  max,
  lessLabel = DEFAULT_HEATMAP_LABELS.less,
  moreLabel = DEFAULT_HEATMAP_LABELS.more,
}: {
  min?: string
  max?: string
  lessLabel?: string
  moreLabel?: string
}) {
  const labels = kitLabels(useLocale())
  const range = min !== undefined && max !== undefined
  const single = range && min === max
  const start = range ? (single ? null : min) : lessLabel
  const end = range ? max : moreLabel
  return (
    <div className="text-small flex items-center gap-2">
      {range && <span className="sr-only">{single ? max : labels.heatmapRange({ min, max })}</span>}
      {start !== null && (
        <span aria-hidden={range || undefined} className="text-muted-foreground tabular-nums">
          {start}
        </span>
      )}
      <span
        aria-hidden="true"
        data-theme-mode="light"
        className="bg-background border-border inline-flex h-3 w-32 overflow-hidden rounded-sm border"
      >
        <span
          className="size-full"
          style={{ background: HEAT_GRADIENT_CSS, opacity: HEAT_PEAK_ALPHA }}
        />
      </span>
      <span aria-hidden={range || undefined} className="text-muted-foreground tabular-nums">
        {end}
      </span>
    </div>
  )
}
