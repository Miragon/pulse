import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { BadgeCluster, CallButton, useCallLabel } from "@miragon/pulse-blocks"
import type {
  CallLinkData,
  ElementBadgeData,
  ElementDecorationData,
  InstanceScopeCode,
} from "@miragon/pulse-screens"
import {
  BpmnZoomControls,
  useBpmnViewer,
  type BpmnCanvas,
  type BpmnViewerWithGet,
} from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../messages/index.js"
import { targetUrl } from "../slots.js"
import { CanvasBadge } from "./canvas-badge.js"

/** The class of an element whose outline marks a root incident: the kit's incident marker. */
const INCIDENT_CLASS = "highlight-incident"

/** The class of the element the list is filtered to: the page's ring in the interaction's colour. */
const SELECTED_CLASS = "pulse-selected"

/**
 * Where an element's overlays sit: its counts over its top right corner (a zero-sized anchor the
 * cluster grows from to the left, as in the webview), its call button inside its bottom right
 * corner, bpmn-js's own place for a drill-down.
 */
const BADGE_POSITION = { top: -10, right: -6 }
const CALL_POSITION = { bottom: 22, right: 22 }

/**
 * Where an overlay of the diagram sits: an element's counts, or a call activity's button, and its
 * host. The data it draws is read at each render from the props (`clusterOf`, `callOf`), so a count
 * that changes in place shows its new number without drawing the diagram again.
 */
interface OverlayHost {
  readonly part: "badges" | "call"
  readonly key: string
  readonly elementId: string
  readonly host: HTMLElement
}

/** The canvas's markers, its removal among them (bpmn-js has it; the kit's type names the add). */
type MarkedCanvas = BpmnCanvas & { removeMarker(elementId: string, marker: string): void }

export interface ProcessDiagramProps {
  readonly engine: string
  readonly xml: string
  /** What each element shows: its counts, its incident outline, its call target. */
  readonly decorations: readonly ElementDecorationData[]
  /** The counts of each element as the process screen reads them, which a cluster draws. */
  readonly badges: readonly ElementBadgeData[]
  /** The element the instance list is filtered to: ringed on the canvas. */
  readonly selected: string | undefined
  /** The counts are older than the list under them (a refresh runs). */
  readonly stale: boolean
  /** The diagram's name: the process and its version. */
  readonly label: string
  readonly nameOf: (elementId: string) => string
  /** The height the frame takes: the room its pane leaves it, else the height the screen gives. */
  readonly fill: boolean
  /** A count's click: the list filtered to the element and the count's scope. */
  readonly onSelect: (elementId: string, scope: InstanceScopeCode) => void
  /**
   * A call link's plain click: the address of the version the call activity calls (Ctrl or Cmd,
   * Shift, Alt and the middle button leave the link to the browser).
   */
  readonly onOpenCall: (href: string) => void
}

/** Runs `paint` on the drawing, where its element exists in it. */
function safely(paint: () => void): void {
  try {
    paint()
  } catch {
    // The element is not in the drawing (a stale count of another version): nothing to paint.
  }
}

/** Places a zero-sized host on `elementId` at `position`, or none where the drawing lacks it. */
function hostOn(viewer: BpmnViewerWithGet, elementId: string, position: object, className: string) {
  const overlays = viewer.get("overlays") as unknown as {
    add: (id: string, overlay: { position: object; html: HTMLElement }) => void
  }
  const host = document.createElement("div")
  host.className = className
  safely(() => overlays.add(elementId, { position, html: host }))
  return host.isConnected ? host : undefined
}

/**
 * The overlays of the drawing: a host for the cluster on each element the decorations give counts,
 * one for the button on each call activity, none on an element the drawing lacks.
 */
function hostsOf(
  viewer: BpmnViewerWithGet,
  decorations: readonly ElementDecorationData[],
): OverlayHost[] {
  const clusters = decorations.flatMap(({ elementId, counts }): OverlayHost[] => {
    if (counts.length === 0) return []
    const host = hostOn(viewer, elementId, BADGE_POSITION, "pulse-badge-anchor")
    return host === undefined
      ? []
      : [{ part: "badges", key: `badges:${elementId}`, elementId, host }]
  })
  const buttons = decorations.flatMap(({ elementId, call }): OverlayHost[] => {
    if (call === null) return []
    const host = hostOn(viewer, elementId, CALL_POSITION, "")
    return host === undefined ? [] : [{ part: "call", key: `call:${elementId}`, elementId, host }]
  })
  return [...clusters, ...buttons]
}

/** The address of what a call activity calls: the version it starts; none for a process the engine lacks. */
function callHref(engine: string, call: CallLinkData): string | undefined {
  if (call.kind !== "definition") return undefined
  const { definition } = call
  return targetUrl({
    kind: "version",
    engine,
    bpmnProcessId: definition.bpmnProcessId,
    version: definition.version,
    definitionId: definition.id,
  })
}

/** What an overlay draws now: the element's counts or its call target, as the props give them. */
function drawnOf(
  overlay: OverlayHost,
  badges: readonly ElementBadgeData[],
  decorations: readonly ElementDecorationData[],
): { readonly badge: ElementBadgeData } | { readonly call: CallLinkData } | undefined {
  if (overlay.part === "badges") {
    const badge = badges.find(({ elementId }) => elementId === overlay.elementId)
    return badge === undefined ? undefined : { badge }
  }
  const call = decorations.find(({ elementId }) => elementId === overlay.elementId)?.call ?? null
  return call === null ? undefined : { call }
}

/**
 * A process's diagram in one version on the page's canvas, which follows the theme (owner decision
 * D10, point 7): the version's drawing with the blocks' decorations, each element's counts apart
 * (its root incidents, the incidents in the instances it called, its running instances; the blocks'
 * `BadgeCluster` with the page's badge), each a button that filters the list to the element and the
 * count's scope, the outline of an element with a root incident marked, each call activity's
 * link to the version it calls (the blocks' `CallButton` with its address), the element the list is
 * filtered to ringed,
 * and the kit's zoom bar at its top right (bpmn.io's link takes the bottom right). It draws again
 * when the elements it decorates change; a count, a call target or the ring changes in place (each
 * overlay reads what it draws from the props at each render), so a click or a Refresh keeps the
 * reader's zoom.
 */
export function ProcessDiagram(props: ProcessDiagramProps) {
  const { engine, xml, decorations, badges, selected, stale, label, nameOf, fill } = props
  const { onSelect, onOpenCall } = props
  const t = useT()
  const callLabel = useCallLabel()
  const [hosts, setHosts] = useState<readonly OverlayHost[]>([])
  const [viewer, setViewer] = useState<BpmnViewerWithGet | null>(null)
  const drawnKey = useMemo(
    () =>
      JSON.stringify(
        decorations.map(({ elementId, counts, incident, call }) => [
          elementId,
          counts.length > 0,
          incident,
          call === null ? null : call.kind,
        ]),
      ),
    [decorations],
  )
  const { containerRef, height, importError, zoomIn, zoomOut, fit } = useBpmnViewer({
    bpmnXml: xml,
    reimportKey: drawnKey,
    fitOnResize: fill,
    ariaLabel: label,
    onImported: (drawn) => {
      const canvas = drawn.get("canvas")
      for (const { elementId, incident } of decorations) {
        if (incident) safely(() => canvas.addMarker(elementId, INCIDENT_CLASS))
      }
      setHosts(hostsOf(drawn, decorations))
      setViewer(drawn)
      return () => {
        setHosts([])
        setViewer(null)
      }
    },
  })
  useEffect(() => {
    if (viewer === null || selected === undefined) return undefined
    const canvas = viewer.get("canvas") as MarkedCanvas
    safely(() => canvas.addMarker(selected, SELECTED_CLASS))
    return () => {
      safely(() => canvas.removeMarker(selected, SELECTED_CLASS))
    }
  }, [viewer, selected])
  const style: CSSProperties = fill ? {} : { height: `${String(height)}px` }
  return (
    <div className="relative h-full min-h-0 w-full" data-slot="process-diagram" style={style}>
      <div ref={containerRef} className="h-full w-full" />
      {importError !== null && (
        <p className="text-muted-foreground absolute inset-0 grid place-items-center p-4">
          {t("diagram.drawFailed")}
        </p>
      )}
      <BpmnZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
      {hosts.map((overlay) => {
        const drawn = drawnOf(overlay, badges, decorations)
        if (drawn === undefined) return null
        return createPortal(
          "badge" in drawn ? (
            <BadgeCluster
              badge={drawn.badge}
              elementName={nameOf(overlay.elementId)}
              stale={stale}
              onSelect={(elementId, scope) => {
                onSelect(elementId, scope)
              }}
              Badge={CanvasBadge}
            />
          ) : (
            <CallLink
              elementId={overlay.elementId}
              label={callLabel(drawn.call, engine)}
              call={drawn.call}
              href={callHref(engine, drawn.call)}
              onOpen={onOpenCall}
            />
          ),
          overlay.host,
          overlay.key,
        )
      })}
    </div>
  )
}

/**
 * A call activity's way to the version it calls: the blocks' `CallButton` as a link to its address,
 * a process the engine lacks a button that opens nothing (its label says why).
 */
function CallLink({
  elementId,
  label,
  call,
  href,
  onOpen,
}: {
  readonly elementId: string
  readonly label: string
  readonly call: CallLinkData
  readonly href: string | undefined
  readonly onOpen: (href: string) => void
}) {
  return (
    <CallButton
      elementId={elementId}
      label={label}
      missing={call.kind === "missing"}
      href={href}
      onOpen={
        href === undefined
          ? undefined
          : () => {
              onOpen(href)
            }
      }
    />
  )
}
