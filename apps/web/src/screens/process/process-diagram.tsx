import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { BadgeCluster, CallButton, useCallLabel } from "@miragon/pulse-blocks"
import type {
  CallLinkData,
  ElementBadgeData,
  ElementDecorationData,
  InstanceScopeCode,
} from "@miragon/pulse-screens"
import { cn } from "@miragon/pulse-ui"
import {
  BpmnDiagram,
  CanvasBadge,
  type BpmnCanvas,
  type BpmnViewerWithGet,
  type DiagramCountsProps,
} from "@miragon/pulse-ui/bpmn"
import { useT } from "../../messages/index.js"
import { targetUrl } from "../slots.js"
import { tenantFieldOf } from "./screen-process.js"

/** The class of the element the list is filtered to: the page's ring in the interaction's colour. */
const SELECTED_CLASS = "pulse-selected"

/** Where a call activity's button sits: inside its bottom right corner, bpmn-js's own place for a drill-down. */
const CALL_POSITION = { bottom: 22, right: 22 }

/**
 * A call activity's button on the drawing and its host. The target it draws is read at each render
 * from the props, so a call target that changes in place shows its new address without drawing
 * the diagram again.
 */
interface CallHost {
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

/** The hosts of the call buttons: one on each call activity the drawing has, none it lacks. */
function callHostsOf(
  viewer: BpmnViewerWithGet,
  decorations: readonly ElementDecorationData[],
): CallHost[] {
  const overlays = viewer.get("overlays") as unknown as {
    add: (id: string, overlay: { position: object; html: HTMLElement }) => void
  }
  return decorations.flatMap(({ elementId, call }): CallHost[] => {
    if (call === null) return []
    const host = document.createElement("div")
    safely(() => overlays.add(elementId, { position: CALL_POSITION, html: host }))
    return host.isConnected ? [{ key: `call:${elementId}`, elementId, host }] : []
  })
}

/** The address of what a call activity calls: the version it starts; none for a process the engine lacks. */
function callHref(engine: string, call: CallLinkData): string | undefined {
  if (call.kind !== "definition") return undefined
  const { definition } = call
  return targetUrl({
    kind: "version",
    engine,
    bpmnProcessId: definition.bpmnProcessId,
    ...tenantFieldOf(definition.tenantId),
    version: definition.version,
    definitionId: definition.id,
  })
}

/**
 * A process's diagram in one version: pulse-ui's `BpmnDiagram` on the canvas that follows the
 * theme (owner decision D10, point 7), the shared screens' badge scheme. Each element's counts sit
 * apart (its root incidents, the incidents in the instances it called, its running instances; the
 * blocks' `BadgeCluster` with the kit's `CanvasBadge`), each a button that filters the list to the
 * element and the count's scope; the outline of an element with a root incident marked; each call
 * activity's link to the version it calls (the blocks' `CallButton` with its address); the element
 * the list is filtered to ringed. It draws again when the elements it decorates change; a count, a
 * call target or the ring changes in place, so a click or a Refresh keeps the reader's zoom.
 */
export function ProcessDiagram(props: ProcessDiagramProps) {
  const { engine, xml, decorations, badges, selected, stale, label, nameOf, fill } = props
  const { onSelect, onOpenCall } = props
  const t = useT()
  const callLabel = useCallLabel()
  const [calls, setCalls] = useState<readonly CallHost[]>([])
  const [viewer, setViewer] = useState<BpmnViewerWithGet | null>(null)
  const callKinds = useMemo(
    () =>
      JSON.stringify(
        decorations.map(({ elementId, call }) => [elementId, call === null ? null : call.kind]),
      ),
    [decorations],
  )
  const onDrawn = (drawn: BpmnViewerWithGet) => {
    setCalls(callHostsOf(drawn, decorations))
    setViewer(drawn)
    return () => {
      setCalls([])
      setViewer(null)
    }
  }
  useEffect(() => {
    if (viewer === null || selected === undefined) return undefined
    const canvas = viewer.get("canvas") as MarkedCanvas
    safely(() => canvas.addMarker(selected, SELECTED_CLASS))
    return () => {
      safely(() => canvas.removeMarker(selected, SELECTED_CLASS))
    }
  }, [viewer, selected])
  const renderCounts = useCallback(
    ({ element, elementName, stale: quiet }: DiagramCountsProps) => {
      const badge = badges.find(({ elementId }) => elementId === element.id)
      return badge === undefined ? null : (
        <BadgeCluster
          badge={badge}
          elementName={elementName}
          stale={quiet}
          onSelect={(elementId, scope) => {
            onSelect(elementId, scope)
          }}
          Badge={CanvasBadge}
        />
      )
    },
    [badges, onSelect],
  )
  return (
    <div className={cn("w-full", fill && "h-full min-h-0")} data-slot="process-diagram">
      <BpmnDiagram
        xml={xml}
        ariaLabel={label}
        decorations={decorations}
        nameOf={nameOf}
        stale={stale}
        renderCounts={renderCounts}
        onDrawn={onDrawn}
        redrawKey={callKinds}
        height={fill ? "fill" : undefined}
        fitOnResize={fill}
        framed={false}
        drawFailed={t("diagram.drawFailed")}
      >
        {calls.map(({ key, elementId, host }) => {
          const call = decorations.find((decoration) => decoration.elementId === elementId)?.call
          if (call === null || call === undefined) return null
          return createPortal(
            <CallLink
              elementId={elementId}
              label={callLabel(call, engine)}
              call={call}
              href={callHref(engine, call)}
              onOpen={onOpenCall}
            />,
            host,
            key,
          )
        })}
      </BpmnDiagram>
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
