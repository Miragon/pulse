// Replaced by the public BPMN diagram of @miragon/pulse-ui once Miragon/pulse#662 lands.
// The web app's apps/web/src/screens/process/process-diagram.tsx without its routing, its call
// links and its selection ring; its props are shaped as #662 proposes, so the swap is an import.
import { useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { BadgeCluster } from "@miragon/pulse-blocks"
import {
  DiagramDecorations,
  type BadgeCountKind,
  type ElementBadgeData,
  type ElementDecorationData,
} from "@miragon/pulse-screens"
import { formatCount } from "@miragon/pulse-ui"
import { BpmnZoomControls, useBpmnViewer, type BpmnViewerWithGet } from "@miragon/pulse-ui/bpmn"
import { useT } from "../messages.ts"
import { CanvasBadge } from "./canvas-badge.tsx"

/** The class of an element whose outline marks a root incident: the kit's incident marker. */
const INCIDENT_CLASS = "highlight-incident"

/**
 * Where an element's counts sit: over its top right corner, a zero-sized anchor the cluster grows
 * from to the left, as in the web app and the webview.
 */
const BADGE_POSITION = { top: -10, right: -6 }

/** An element of the drawing as a count's click names it: its id and its BPMN type. */
export interface DrawnElement {
  readonly id: string
  /** The element's BPMN type as bpmn-js reads it (`bpmn:UserTask`). */
  readonly type: string
}

interface OverlayHost {
  readonly key: string
  readonly element: DrawnElement
  readonly host: HTMLElement
}

export interface ProcessDiagramProps {
  readonly xml: string
  /** What each element shows: its counts and its incident outline (`DiagramDecorations.of`). */
  readonly decorations: readonly ElementDecorationData[]
  /** The counts of each element, which a cluster draws. */
  readonly badges: readonly ElementBadgeData[]
  /** The diagram's name: the process and its version. */
  readonly ariaLabel: string
  readonly nameOf: (elementId: string) => string
  /** The words when the XML could not be drawn. */
  readonly drawFailed: string
  /**
   * Whether a count leads somewhere on the page; one that leads nowhere is drawn without a button.
   * Default: every count does.
   */
  readonly selectable?: (element: DrawnElement, kind: BadgeCountKind) => boolean
  /** A count's click: the element and the kind of count clicked. */
  readonly onSelect: (element: DrawnElement, kind: BadgeCountKind) => void
}

/** Runs `paint` on the drawing, where its element exists in it. */
function safely(paint: () => void): void {
  try {
    paint()
  } catch {
    // The element is not in the drawing (a count of an older version's element): nothing to paint.
  }
}

/** The hosts of the counts: one on each element the decorations give counts, none it lacks. */
function hostsOf(
  viewer: BpmnViewerWithGet,
  decorations: readonly ElementDecorationData[],
): OverlayHost[] {
  const overlays = viewer.get("overlays") as unknown as {
    add: (id: string, overlay: { position: object; html: HTMLElement }) => void
  }
  const registry = viewer.get("elementRegistry") as unknown as {
    get: (id: string) => { type?: string } | undefined
  }
  return decorations.flatMap(({ elementId, counts }): OverlayHost[] => {
    if (counts.length === 0) return []
    const host = document.createElement("div")
    host.className = "pulse-badge-anchor"
    safely(() => {
      overlays.add(elementId, { position: BADGE_POSITION, html: host })
    })
    if (!host.isConnected) return []
    const element = { id: elementId, type: registry.get(elementId)?.type ?? "" }
    return [{ key: `badges:${elementId}`, element, host }]
  })
}

export interface ElementBadgesProps {
  /** The element's counts. */
  readonly badge: ElementBadgeData
  /** The element's name, as the page knows it (else its id). */
  readonly elementName: string
  /** Whether a count leads somewhere on the page: one that leads nowhere is no button. */
  readonly selectable: (kind: BadgeCountKind) => boolean
  /** A count's click, by the kind of count clicked. */
  readonly onSelect: (kind: BadgeCountKind) => void
}

/** The kind of the count a click hit: its badge's `data-kind` (`CanvasBadge`). */
function kindHit(target: EventTarget): BadgeCountKind | null {
  if (!(target instanceof Element)) return null
  const kind = target
    .closest('[data-part="badge-count"]')
    ?.querySelector("[data-kind]")
    ?.getAttribute("data-kind")
  return kind === "running" || kind === "incidents" || kind === "incidentsInCalledInstances"
    ? kind
    : null
}

/**
 * An element's counts on the canvas in the one badge scheme: the counts that lead somewhere on the
 * page as the blocks' `BadgeCluster`, each a button; after them each count that leads nowhere (the
 * running instances at an element no list on the page shows) as the same badge without a button,
 * its words for a screen reader and as its tooltip, so no button promises what the page cannot
 * show. The cluster names a click by its scope, which both kinds of incidents share, so the
 * click's kind is read from the badge it hit.
 */
export function ElementBadges({ badge, elementName, selectable, onSelect }: ElementBadgesProps) {
  const t = useT()
  const hit = useRef<BadgeCountKind | null>(null)
  const counts = DiagramDecorations.of({ badges: [badge], calls: [] })[0]?.counts ?? []
  const plain = counts.filter(({ kind }) => !selectable(kind))
  const linked: ElementBadgeData = {
    ...badge,
    ...Object.fromEntries(plain.map(({ kind }) => [kind, 0])),
  }
  return (
    <span
      className="pulse-badge-row"
      onClickCapture={(event) => {
        hit.current = kindHit(event.target)
      }}
    >
      {plain.length < counts.length && (
        <BadgeCluster
          badge={linked}
          elementName={elementName}
          onSelect={(_elementId, scope) => {
            onSelect(
              hit.current ??
                (scope === "running"
                  ? "running"
                  : linked.incidents > 0
                    ? "incidents"
                    : "incidentsInCalledInstances"),
            )
          }}
          Badge={CanvasBadge}
        />
      )}
      {plain.map(({ kind, count }) => {
        const words = t(`badge.${kind}`, { element: elementName, count: formatCount(count) })
        return (
          <span key={kind} className="pulse-badge-plain" data-part="badge-plain" title={words}>
            <CanvasBadge kind={kind} count={count} />
            <span className="sr-only">{words}</span>
          </span>
        )
      })}
    </span>
  )
}

const EVERY_COUNT = () => true

/**
 * A process's diagram on the kit's themed canvas: the drawing with the blocks' decorations, each
 * element's counts apart (its root incidents, the incidents in the instances it called, its
 * running instances; `ElementBadges` with the page's badge), each a button where it leads
 * somewhere on the page, the outline of an element with a root incident marked, and the kit's
 * zoom bar at its top right (bpmn.io's link takes the bottom right). An element the drawing lacks
 * is skipped without an error.
 */
export function ProcessDiagram(props: ProcessDiagramProps) {
  const { xml, decorations, badges, ariaLabel, nameOf, drawFailed, onSelect } = props
  const selectable = props.selectable ?? EVERY_COUNT
  const [hosts, setHosts] = useState<readonly OverlayHost[]>([])
  const drawnKey = useMemo(
    () =>
      JSON.stringify(
        decorations.map(({ elementId, counts, incident }) => [
          elementId,
          counts.length > 0,
          incident,
        ]),
      ),
    [decorations],
  )
  const { containerRef, height, importError, zoomIn, zoomOut, fit } = useBpmnViewer({
    bpmnXml: xml,
    reimportKey: drawnKey,
    fitOnResize: true,
    ariaLabel,
    markedIds: decorations.filter(({ incident }) => incident).map(({ elementId }) => elementId),
    onImported: (drawn) => {
      const canvas = drawn.get("canvas")
      for (const { elementId, incident } of decorations) {
        if (incident) {
          safely(() => {
            canvas.addMarker(elementId, INCIDENT_CLASS)
          })
        }
      }
      setHosts(hostsOf(drawn, decorations))
      return () => {
        setHosts([])
      }
    },
  })
  return (
    <div
      className="relative w-full"
      data-slot="process-diagram"
      style={{ height: `${String(height)}px` }}
    >
      <div ref={containerRef} className="h-full w-full" />
      {importError !== null && (
        <p className="text-muted-foreground absolute inset-0 grid place-items-center p-4">
          {drawFailed}
        </p>
      )}
      <BpmnZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
      {hosts.map(({ key, element, host }) => {
        const badge = badges.find(({ elementId }) => elementId === element.id)
        if (badge === undefined) return null
        return createPortal(
          <ElementBadges
            badge={badge}
            elementName={nameOf(element.id)}
            selectable={(kind) => selectable(element, kind)}
            onSelect={(kind) => {
              onSelect(element, kind)
            }}
          />,
          host,
          key,
        )
      })}
    </div>
  )
}
