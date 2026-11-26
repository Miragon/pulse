import { useMemo, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { CalledInstanceMenu, type InstanceSlots } from "@miragon/pulse-blocks"
import type { CallLinkData, MarkerData, ScreenTarget } from "@miragon/pulse-screens"
import { cn, FOCUS_RING, Icon, shortId } from "@miragon/pulse-ui"
import { BpmnZoomControls, useBpmnViewer, type BpmnViewerWithGet } from "@miragon/pulse-ui/bpmn"
import { ArrowUpRight } from "lucide-react"
import { useT } from "../../messages/index.js"
import { PageLink, type Navigate } from "../../router/page-link.js"
import { targetUrl } from "../slots.js"

/**
 * The class each marker of the screen paints its element's outline with: the kit's marker of an
 * element that waits (`highlight-running`) and of an incident (`highlight-incident`), and the page's
 * own two (`src/styles.css`): an incident in an instance it called, and an element already done.
 */
const MARKER_CLASS: Readonly<Record<MarkerData["kind"], string>> = {
  waiting: "highlight-running",
  incident: "highlight-incident",
  incidentInCalledInstance: "pulse-incident-called",
  completed: "pulse-completed",
}

/** The class of the element in focus (an incident's): a ring in the interaction's colour. */
const SELECTED_CLASS = "pulse-selected"

/**
 * Where a call activity's control sits on its element: a button at its bottom right corner, inside
 * the shape, and a menu below it.
 */
const CALL_POSITION = { bottom: 24, right: 24 }
const MENU_POSITION = { bottom: -6, left: 0 }

/** A call activity's control on the diagram and the element it is drawn on. */
interface CallHost {
  readonly call: CallLinkData
  readonly host: HTMLElement
}

export interface InstanceDiagramProps {
  readonly engine: string
  /** The version's diagram's XML; null where the engine has none. */
  readonly xml: string
  readonly markers: readonly MarkerData[]
  readonly calls: readonly CallLinkData[]
  /** The element in focus: selected, and centred on the canvas. */
  readonly focus?: string
  /** The diagram's name: the process and its version. */
  readonly label: string
  /** An element's name, as the screen knows it. */
  readonly nameOf: (elementId: string) => string
  /** The height the frame takes: the room its pane leaves it, or the diagram's own. */
  readonly fill: boolean
  readonly navigate: Navigate
  readonly slots: Pick<InstanceSlots, "Link">
}

/** Runs `paint` on the drawing, where its element exists in it. */
function safely(paint: () => void): void {
  try {
    paint()
  } catch {
    // The element is not in the drawing (a stale marker of an older version): nothing to paint.
  }
}

/** Moves the canvas so `elementId` sits in its middle, at the scale the fit gave it. */
function centre(viewer: BpmnViewerWithGet, elementId: string): void {
  const element = viewer
    .get("elementRegistry")
    .getAll()
    .find(({ id }) => id === elementId)
  const { x, y, width = 0, height = 0 } = element ?? {}
  if (x === undefined || y === undefined) return
  const canvas = viewer.get("canvas")
  const box = canvas.viewbox()
  canvas.viewbox({
    x: x + width / 2 - box.width / 2,
    y: y + height / 2 - box.height / 2,
    width: box.width,
    height: box.height,
  })
}

/**
 * A call activity's way to what it called: the one instance it called (or, where it has called none,
 * the version it starts), a link of the page; several instances behind the blocks' menu. A process
 * the engine lacks has none.
 */
function CallControl({
  engine,
  call,
  nameOf,
  navigate,
  slots,
}: {
  readonly engine: string
  readonly call: CallLinkData
  readonly nameOf: (elementId: string) => string
  readonly navigate: Navigate
  readonly slots: Pick<InstanceSlots, "Link">
}) {
  const t = useT()
  const element = nameOf(call.elementId)
  if (call.kind === "missing") return null
  if (call.kind === "definition") {
    const { definition } = call
    const target: ScreenTarget = {
      kind: "version",
      engine,
      bpmnProcessId: definition.bpmnProcessId,
      version: definition.version,
      definitionId: definition.id,
    }
    const process = definition.name ?? definition.bpmnProcessId
    const label = t("diagram.callVersion", { process, version: definition.version, element })
    return <CallLink href={targetUrl(target)} label={label} call={call} navigate={navigate} />
  }
  const [only, ...more] = call.instances
  if (only === undefined) return null
  if (more.length > 0) {
    return (
      <CalledInstanceMenu
        engine={engine}
        elementName={element}
        instances={call.instances}
        slots={slots}
      />
    )
  }
  const label = t("diagram.callInstance", { id: shortId(only.id), element })
  const href = targetUrl({ kind: "instance", engine, instanceId: only.id })
  return <CallLink href={href} label={label} call={call} navigate={navigate} />
}

/** A call activity's link to the one thing it leads to, a 24 px button on its element's corner. */
function CallLink({
  href,
  label,
  call,
  navigate,
}: {
  readonly href: string
  readonly label: string
  readonly call: CallLinkData
  readonly navigate: Navigate
}) {
  return (
    <PageLink
      href={href}
      navigate={navigate}
      aria-label={label}
      title={label}
      data-part="call-button"
      data-call-for={call.elementId}
      className={cn(
        "border-border bg-card text-foreground hover:bg-accent shadow-1 inline-flex size-6 items-center justify-center rounded-sm border",
        FOCUS_RING,
      )}
    >
      <Icon icon={ArrowUpRight} />
    </PageLink>
  )
}

/**
 * The instance's diagram on the page's canvas, which follows the theme (owner decision D10, point
 * 7): the version's drawing with the screen's markers (waiting here, an incident here, an incident
 * in a called instance, already done), each call activity's way to what it called, the element in
 * focus selected and in the middle, and the kit's zoom bar at its top right (bpmn.io's link takes
 * the bottom right). It draws again when the markers, the calls or the focus change.
 */
export function InstanceDiagram(props: InstanceDiagramProps) {
  const { engine, xml, markers, calls, focus, label, nameOf, fill, navigate, slots } = props
  const t = useT()
  const [hosts, setHosts] = useState<readonly CallHost[]>([])
  const decorations = useMemo(
    () => JSON.stringify([markers, calls.map(({ elementId }) => elementId), focus ?? null]),
    [markers, calls, focus],
  )
  const marked = useMemo(() => (focus === undefined ? [] : [focus]), [focus])
  const { containerRef, height, importError, zoomIn, zoomOut, fit } = useBpmnViewer({
    bpmnXml: xml,
    reimportKey: decorations,
    // A pane that resizes fits the drawing anew, unless an element is in focus, whose middle stays.
    fitOnResize: fill && focus === undefined,
    markedIds: marked,
    ariaLabel: label,
    onImported: (drawn) => {
      const canvas = drawn.get("canvas")
      const overlays = drawn.get("overlays") as unknown as {
        add: (id: string, overlay: { position: object; html: HTMLElement }) => void
      }
      for (const { elementId, kind } of markers) {
        safely(() => canvas.addMarker(elementId, MARKER_CLASS[kind]))
      }
      if (focus !== undefined) {
        safely(() => canvas.addMarker(focus, SELECTED_CLASS))
        centre(drawn, focus)
      }
      const made = calls.flatMap((call): CallHost[] => {
        const host = document.createElement("div")
        const many = call.kind === "instances" && call.instances.length > 1
        const position = many ? MENU_POSITION : CALL_POSITION
        safely(() => overlays.add(call.elementId, { position, html: host }))
        return host.isConnected ? [{ call, host }] : []
      })
      setHosts(made)
      return () => setHosts([])
    },
  })
  const style: CSSProperties = fill ? {} : { height: `${String(height)}px` }
  return (
    <div className="relative h-full min-h-0 w-full" data-slot="instance-diagram" style={style}>
      <div ref={containerRef} className="h-full w-full" />
      {importError !== null && (
        <p className="text-muted-foreground absolute inset-0 grid place-items-center p-4">
          {t("diagram.drawFailed")}
        </p>
      )}
      <BpmnZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
      {hosts.map(({ call, host }) =>
        createPortal(
          <CallControl
            engine={engine}
            call={call}
            nameOf={nameOf}
            navigate={navigate}
            slots={slots}
          />,
          host,
          call.elementId,
        ),
      )}
    </div>
  )
}
