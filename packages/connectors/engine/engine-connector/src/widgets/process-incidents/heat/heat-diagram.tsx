import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react"
import { ErrorState } from "@miragon/pulse-ui"
import {
  BPMN_CANVAS_SLOT,
  BpmnZoomControls,
  injectBpmnOverlayCss,
  useBpmnViewer,
} from "@miragon/pulse-ui/bpmn"
import { useDiagramMaxHeight } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../../messages/use-t.js"
import {
  buildGradientLut,
  buildHeatPoints,
  drawHeatLayer,
  HEAT_BLEND_CSS,
  HEAT_GRADIENT_CSS,
  HEAT_PEAK_ALPHA,
  readHeatPaint,
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

/** The document's attributes that carry the theme: widget-shell's `.dark` and `data-theme`, a page's `data-cd-theme`. */
const THEME_ATTRIBUTES = ["class", "data-theme", "data-cd-theme"]

/**
 * The diagram with a heat layer over it. The viewer mounts once per `bpmnXml`; new values only
 * repaint the layer, and a resize keeps the operator's pan and zoom. One hue, never red (red is for
 * incidents); the canvas follows the theme like every BPMN canvas, and the layer repaints in the
 * ramp and blend of the mode it finds.
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
    // The canvas alone is the image; the heat layer above it is a drawing (aria-hidden).
    ariaLabel,
    // Inline in a chat card, the host's budget caps it, as every diagram of the cockpit.
    maxHeight: useDiagramMaxHeight(),
    onImported: (imported) => {
      const canvas = imported.get("canvas")
      const elementRegistry = imported.get("elementRegistry")
      const eventBus = imported.get("eventBus")
      /** The table of the ramp last painted, built anew only when the mode's ramp differs. */
      let lut: { ramp: string; table: Uint8ClampedArray } | null = null

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
        const paint = readHeatPaint(container)
        if (!ctx || !paint) return
        const ramp = JSON.stringify(paint.ramp)
        const table = lut?.ramp === ramp ? lut.table : buildGradientLut(paint.ramp)
        lut = { ramp, table }
        // The blend with the colours it was made for: a theme change repaints both at once.
        heatCanvas.style.mixBlendMode = paint.blend
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
        drawHeatLayer(ctx, size, onScreen, range, radiusPx, table)
      }

      redrawRef.current = redraw
      redraw()
      eventBus.on("canvas.viewbox.changed", redraw)
      eventBus.on("canvas.resized", redraw)
      const ro = new ResizeObserver(redraw)
      if (containerRef.current) ro.observe(containerRef.current)
      const themes = new MutationObserver(redraw)
      themes.observe(document.documentElement, {
        attributes: true,
        attributeFilter: THEME_ATTRIBUTES,
      })
      return () => {
        eventBus.off("canvas.viewbox.changed", redraw)
        eventBus.off("canvas.resized", redraw)
        ro.disconnect()
        themes.disconnect()
        redrawRef.current = null
      }
    },
  })

  useEffect(() => {
    redrawRef.current?.()
  }, [values])

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="border-border rounded-md border"
        style={{ height: `${height}px`, width: "100%" }}
      />
      <canvas
        ref={heatCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md"
        style={{ width: "100%", height: "100%" }}
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

/** A variable, which React's types do not name among the blend modes. */
const LEGEND_BLEND = HEAT_BLEND_CSS as CSSProperties["mixBlendMode"]

/**
 * The ramp with the values its ends encode: the layer maps the range linearly onto the swatch;
 * one value for every element shows once, at the full end. The swatch takes the canvas's paper,
 * ramp and blend (pulse-ui's `BPMN_CANVAS_SLOT`), so it shows the heat as the diagram does in
 * either mode. It declares the canvas's stylesheet itself, before it paints: the view shows it
 * where no diagram mounts (no version to draw, an XML read that failed).
 */
export function HeatmapLegend({ min, max }: { min: string; max: string }) {
  const t = useT()
  useLayoutEffect(() => {
    injectBpmnOverlayCss()
  }, [])
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
        data-slot={BPMN_CANVAS_SLOT}
        className="border-border inline-flex h-4 w-40 overflow-hidden rounded-sm border"
      >
        <span
          data-part="heat-ramp"
          style={{
            width: "100%",
            height: "100%",
            background: HEAT_GRADIENT_CSS,
            opacity: HEAT_PEAK_ALPHA,
            mixBlendMode: LEGEND_BLEND,
          }}
        />
      </span>
      <span aria-hidden="true" className="text-muted-foreground tabular-nums">
        {max}
      </span>
    </span>
  )
}
