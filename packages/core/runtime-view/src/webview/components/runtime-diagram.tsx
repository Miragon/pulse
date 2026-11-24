import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import type { BadgeFilter, Decorations } from "../diagram/decorations.js"
import { ReactOverlaySink, type OverlaySlot } from "../diagram/overlay-slots.js"
import { RuntimeCanvas, type Viewbox } from "../diagram/runtime-canvas.js"
import { useHost } from "../host/host-context.js"
import { EmptyHint } from "./empty-hint.js"

export interface RuntimeDiagramProps {
  readonly xml: string
  readonly decorations: Decorations
  readonly onSelectElement: BadgeFilter
  readonly onNames: (names: ReadonlyMap<string, string>) => void
  readonly label?: string
  readonly remembersView?: boolean
  readonly keysOnCanvas?: boolean
  readonly onHover?: (elementId: string | undefined) => void
  readonly onViewChange?: () => void
  readonly onCanvas?: (canvas: DiagramView | undefined) => void
}

interface DiagramView {
  viewbox(): Viewbox
  showViewbox(box: Viewbox): void
}

interface DrawnCanvas {
  readonly hostElement: RefObject<HTMLDivElement | null>
  readonly failure: string | undefined
  readonly slots: readonly OverlaySlot[]
}

function useRuntimeCanvas(props: RuntimeDiagramProps): DrawnCanvas {
  const host = useHost()
  const { api } = host
  const hostElement = useRef<HTMLDivElement>(null)
  const canvas = useRef<RuntimeCanvas | null>(null)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [slots, setSlots] = useState<readonly OverlaySlot[]>([])
  const remembersView = props.remembersView !== false
  const keysOnCanvas = props.keysOnCanvas === true
  const latest = useEffectEvent((): RuntimeDiagramProps => props)
  useEffect(() => {
    if (hostElement.current === null) {
      return undefined
    }
    const sink = new ReactOverlaySink(setSlots)
    const created = new RuntimeCanvas({
      host: hostElement.current,
      overlays: sink,
      stateApi: api,
      onSelectElement: (elementId, scope) => {
        latest().onSelectElement(elementId, scope)
      },
      onOpenCall: (elementId, toSide) => {
        host.post({ type: "openCall", elementId, toSide })
      },
      onOpenCode: (elementId) => {
        host.post({ type: "openCode", elementId })
      },
      onImported: (names) => {
        setFailure(undefined)
        latest().onNames(names)
      },
      onImportFailed: setFailure,
      remembersView,
      keysOnCanvas,
      onHover: (elementId) => latest().onHover?.(elementId),
      onViewChange: () => latest().onViewChange?.(),
    })
    canvas.current = created
    void created.update(latest().xml, latest().decorations)
    latest().onCanvas?.(created)
    return () => {
      latest().onCanvas?.(undefined)
      canvas.current = null
      sink.detach()
      created.destroy()
    }
  }, [api, host, remembersView, keysOnCanvas])
  useEffect(() => {
    void canvas.current?.update(props.xml, props.decorations)
  }, [props.xml, props.decorations])
  return { hostElement, failure, slots }
}

export function RuntimeDiagram(props: RuntimeDiagramProps) {
  const { hostElement, failure, slots } = useRuntimeCanvas(props)
  return (
    <section className="diagram-region" data-part="diagram" aria-label={props.label ?? "Diagram"}>
      <div className="diagram-host" data-part="diagram-canvas" ref={hostElement} />
      {slots.map((slot) => createPortal(slot.node, slot.anchor, slot.key))}
      {failure !== undefined && (
        <div className="diagram-region__failure" data-part="diagram-failure">
          <EmptyHint text="Couldn't draw the deployed diagram." />
        </div>
      )}
    </section>
  )
}
