import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { BadgeFilter } from "../diagram/badge-cluster.js"
import type { Decorations } from "../diagram/decoration-layer.js"
import { ReactOverlaySink, type OverlaySlot } from "../diagram/overlay-slots.js"
import { RuntimeCanvas } from "../diagram/runtime-canvas.js"
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
}

export function RuntimeDiagram(props: RuntimeDiagramProps) {
  const host = useHost()
  const { api } = host
  const hostElement = useRef<HTMLDivElement>(null)
  const canvas = useRef<RuntimeCanvas | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [slots, setSlots] = useState<readonly OverlaySlot[]>([])
  const remembersView = props.remembersView !== false
  const keysOnCanvas = props.keysOnCanvas === true

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
        latest.current.onSelectElement(elementId, scope)
      },
      onOpenCall: (elementId, toSide) => {
        host.post({ type: "openCall", elementId, toSide })
      },
      onOpenCode: (elementId) => {
        host.post({ type: "openCode", elementId })
      },
      onImported: (names) => {
        setFailure(undefined)
        latest.current.onNames(names)
      },
      onImportFailed: setFailure,
      remembersView,
      keysOnCanvas,
    })
    canvas.current = created
    void created.update(latest.current.xml, latest.current.decorations)
    return () => {
      canvas.current = null
      sink.detach()
      created.destroy()
    }
  }, [api, host, remembersView, keysOnCanvas])

  useEffect(() => {
    void canvas.current?.update(props.xml, props.decorations)
  }, [props.xml, props.decorations])

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
