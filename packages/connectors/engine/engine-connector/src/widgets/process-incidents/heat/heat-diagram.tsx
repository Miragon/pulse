import { useEffect, useRef } from "react"
import { ErrorState } from "@miragon/pulse-ui"
import { BpmnZoomControls, useBpmnViewer } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../../messages/use-t.js"
import {
  buildGradientLut,
  buildHeatPoints,
  drawHeatLayer,
  HEAT_GRADIENT_CSS,
  HEAT_PEAK_ALPHA,
  readHeatRamp,
  weightRange,
  type HeatPoint,
} from "./heat-utils.js"

/** The blob radius in diagram units: about half a task. */
const HEAT_RADIUS = 55

export interface BpmnHeatmapProps {
  bpmnXml: string
  /** The value per element id; elements without one stay cold. */
  values: Readonly<Record<string, number>>
  ariaLabel: string
}

/**
 * The diagram with a heat layer over it. The viewer mounts once per `bpmnXml`; new values only
 * repaint the layer, and a resize keeps the operator's pan and zoom. One hue, never red (red is for
 * incidents); the frame is a forced-light island like every BPMN canvas.
 */
export function BpmnHeatmap({ bpmnXml, values, ariaLabel }: BpmnHeatmapProps) {
  const t = useT()
  const heatCanvasRef = useRef<HTMLCanvasElement>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  // Synced in an effect, not during render, so a discarded render cannot leak into the ref;
  // declared before the repaint effect so redraw() sees this commit's values.
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  })

  const { containerRef, height, importError, zoomIn, zoomOut, fit } = useBpmnViewer({
    bpmnXml,
    onImported: (imported) => {
      const ramp = containerRef.current ? readHeatRamp(containerRef.current) : null
      const gradientLut = ramp ? buildGradientLut(ramp) : null
      const canvas = imported.get("canvas")
      const elementRegistry = imported.get("elementRegistry")
      const eventBus = imported.get("eventBus")

      const redraw = () => {
        const heatCanvas = heatCanvasRef.current
        const container = containerRef.current
        if (!heatCanvas || !container) return
        const rect = container.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const rawWidth = Math.round(rect.width * dpr)
        const rawHeight = Math.round(rect.height * dpr)
        if (heatCanvas.width !== rawWidth || heatCanvas.height !== rawHeight) {
          heatCanvas.width = rawWidth
          heatCanvas.height = rawHeight
        }
        const ctx = heatCanvas.getContext("2d")
        if (!ctx || !gradientLut) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        const points = buildHeatPoints(elementRegistry.getAll(), valuesRef.current)
        const range = weightRange(points.map((p) => p.weight)) ?? { min: 0, max: 0 }
        const vb = canvas.viewbox()
        const onScreen: HeatPoint[] = points.map((p) => ({
          x: (p.x - vb.x) * vb.scale,
          y: (p.y - vb.y) * vb.scale,
          weight: p.weight,
        }))
        const size = { width: rect.width, height: rect.height, rawWidth, rawHeight }
        const radiusPx = Math.max(20, HEAT_RADIUS * vb.scale)
        drawHeatLayer(ctx, size, onScreen, range, radiusPx, gradientLut)
      }

      redrawRef.current = redraw
      redraw()
      eventBus.on("canvas.viewbox.changed", redraw)
      eventBus.on("canvas.resized", redraw)
      const ro = new ResizeObserver(redraw)
      if (containerRef.current) ro.observe(containerRef.current)
      return () => {
        eventBus.off("canvas.viewbox.changed", redraw)
        eventBus.off("canvas.resized", redraw)
        ro.disconnect()
        redrawRef.current = null
      }
    },
  })

  useEffect(() => {
    redrawRef.current?.()
  }, [values])

  return (
    <div data-theme-mode="light" className="relative">
      <div
        ref={containerRef}
        role="img"
        aria-label={ariaLabel}
        className="border-border rounded-md border"
        style={{ height: `${height}px`, width: "100%" }}
      />
      <canvas
        ref={heatCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md"
        style={{ width: "100%", height: "100%", mixBlendMode: "multiply" }}
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

/**
 * The ramp with the values its ends encode: the layer maps the range linearly onto the swatch;
 * one value for every element shows once, at the full end.
 */
export function HeatmapLegend({ min, max }: { min: string; max: string }) {
  const t = useT()
  const single = min === max
  return (
    <span className="text-small flex items-center gap-2">
      <span className="sr-only">{single ? max : t("procIncFlow.heatRange", { min, max })}</span>
      {!single && (
        <span aria-hidden="true" className="text-muted-foreground tabular-nums">
          {min}
        </span>
      )}
      <span
        aria-hidden="true"
        data-theme-mode="light"
        className="bg-background border-border inline-flex h-4 w-40 overflow-hidden rounded-sm border"
      >
        <span
          style={{
            width: "100%",
            height: "100%",
            background: HEAT_GRADIENT_CSS,
            opacity: HEAT_PEAK_ALPHA,
          }}
        />
      </span>
      <span aria-hidden="true" className="text-muted-foreground tabular-nums">
        {max}
      </span>
    </span>
  )
}
