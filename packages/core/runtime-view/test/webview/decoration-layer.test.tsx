import { useState } from "react"
import { createPortal } from "react-dom"
import { afterEach, describe, expect, it } from "vitest"
import type { ElementBadge } from "../../src/core/protocol/index.js"
import { DecorationLayer, type Decorations } from "../../src/webview/diagram/decoration-layer.js"
import { ReactOverlaySink, type OverlaySlot } from "../../src/webview/diagram/overlay-slots.js"
import type { DiagramElement } from "../../src/webview/diagram/diagram-elements.js"
import { mount } from "./harness.js"

function servicesWith(ids: Set<string>) {
  const markers: string[] = []
  const canvas = {
    addMarker: (id: string, marker: string) => {
      markers.push(`${id}:${marker}`)
    },
    removeMarker: (id: string) => {
      if (!ids.has(id)) {
        throw new TypeError("Cannot read properties of undefined (reading 'markers')")
      }
    },
  }
  return {
    markers,
    services: {
      overlays: { add: () => "overlay", remove: () => undefined },
      selection: { select: () => undefined },
      canvas,
      registry: {
        get: (id: string) =>
          ids.has(id)
            ? ({ id, type: "bpmn:Task", businessObject: {} } as unknown as DiagramElement)
            : undefined,
        getAll: () => [],
      },
      names: new Map<string, string>(),
    },
  }
}

describe("the decoration layer", () => {
  it("lets go of markers whose element the next diagram no longer has", () => {
    const ids = new Set(["Activity_ChargePayment", "Activity_CalculateLoyaltyPoints"])
    const { services, markers } = servicesWith(ids)
    const layer = new DecorationLayer(
      services,
      () => undefined,
      () => undefined,
      () => undefined,
    )
    layer.apply({
      badges: [],
      markers: [{ elementId: "Activity_CalculateLoyaltyPoints", kind: "incident" }],
      calls: [],
      stale: false,
    })
    expect(markers).toEqual(["Activity_CalculateLoyaltyPoints:pulse-incident"])

    ids.delete("Activity_CalculateLoyaltyPoints")

    expect(() => {
      layer.apply({
        badges: [],
        markers: [{ elementId: "Activity_ChargePayment", kind: "waiting" }],
        calls: [],
        stale: false,
      })
    }).not.toThrow()
    expect(markers).toContain("Activity_ChargePayment:pulse-waiting")
  })
})

const SHIP = "Activity_ShipOrder"
const PAY = "Activity_ChargePayment"

function overlaysIn(container: HTMLElement) {
  return {
    add: (_element: string, _type: string, overlay: object) => {
      container.append((overlay as { readonly html: HTMLElement }).html)
      return "overlay"
    },
    remove: () => {
      container.replaceChildren()
    },
  }
}

type Publish = (slots: readonly OverlaySlot[]) => void

function portalSink(): ReactOverlaySink {
  const published: { publish: Publish } = { publish: () => undefined }
  function Portals() {
    const [slots, setSlots] = useState<readonly OverlaySlot[]>([])
    published.publish = setSlots
    return <>{slots.map((slot) => createPortal(slot.node, slot.anchor, slot.key))}</>
  }
  mount(<Portals />)
  return new ReactOverlaySink((slots) => {
    published.publish(slots)
  })
}

function slotLayer() {
  const container = document.createElement("div")
  document.body.append(container)
  const { services } = servicesWith(new Set([SHIP, PAY]))
  const layer = new DecorationLayer(
    { ...services, overlays: overlaysIn(container) },
    () => undefined,
    () => undefined,
    () => undefined,
  )
  const sink = portalSink()
  const draw = (decorations: Decorations, between?: () => void): readonly OverlaySlot[] => {
    const slots = layer.apply(decorations)
    sink.render(slots, () => {
      between?.()
      layer.restoreFocus()
    })
    return slots
  }
  return { container, layer, sink, draw }
}

function badge(elementId: string, running: number, incidents = 0): ElementBadge {
  return { elementId, running, incidents, incidentsInCalledInstances: 0 }
}

function decorated(badges: readonly ElementBadge[], extra: Partial<Decorations> = {}): Decorations {
  return { badges, markers: [], calls: [], stale: false, ...extra }
}

function countButton(container: HTMLElement, elementId: string, scope: string) {
  return container.querySelector<HTMLButtonElement>(
    `[data-badge-for="${elementId}"] [data-part="badge-count"][data-scope="${scope}"]`,
  )
}

describe("the decoration layer's overlay slots", () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it("keys each slot by its element and overlay kind, and renders it into its anchor", () => {
    const { container, draw } = slotLayer()
    const slots = draw(
      decorated([badge(SHIP, 2, 1), badge("Activity_Gone", 1)], {
        calls: [{ elementId: PAY, label: "Open the called process" }],
        move: { from: SHIP, to: PAY, targets: [PAY], refused: [] },
      }),
    )

    expect(slots.map((slot) => slot.key)).toEqual([
      `${SHIP}#badges`,
      `${PAY}#call`,
      `${SHIP}#move`,
      `${PAY}#move`,
    ])
    expect(slots.map((slot) => slot.anchor.dataset.overlayFor)).toEqual([SHIP, PAY, SHIP, PAY])
    expect(countButton(container, SHIP, "running")?.getAttribute("aria-label")).toContain("2")
    expect(container.querySelector(`[data-part="call-button"][data-call-for="${PAY}"]`)).not.toBe(
      null,
    )
  })

  it("hands back the same slots while the decorations stay the same", () => {
    const { draw } = slotLayer()
    const first = draw(decorated([badge(SHIP, 2)]))

    expect(draw(decorated([badge(SHIP, 2)]))).toBe(first)
  })

  it("reuses the anchor of a key when a count or a state changes", () => {
    const { container, draw } = slotLayer()
    const [before] = draw(decorated([badge(SHIP, 2)]))
    const button = countButton(container, SHIP, "running")

    const [after] = draw(decorated([badge(SHIP, 3, 1)], { stale: true }))

    expect(after?.key).toBe(before?.key)
    expect(after?.anchor).toBe(before?.anchor)
    expect(countButton(container, SHIP, "running")).toBe(button)
    expect(countButton(container, SHIP, "withIncident")).not.toBe(null)
  })

  it("unmounts the slot of an overlay that goes and gives a returning one a fresh anchor", () => {
    const { draw } = slotLayer()
    const [ship, pay] = draw(decorated([badge(SHIP, 2), badge(PAY, 1)]))

    const [kept] = draw(decorated([badge(SHIP, 2)]))
    const [, returned] = draw(decorated([badge(SHIP, 2), badge(PAY, 1)]))

    expect(kept?.anchor).toBe(ship?.anchor)
    expect(pay?.anchor.childElementCount).toBe(0)
    expect(returned?.anchor).not.toBe(pay?.anchor)
  })

  it("renders the same slots once and still reports them rendered", () => {
    const { layer, sink } = slotLayer()
    const slots = layer.apply(decorated([badge(SHIP, 2)]))
    let rendered = 0
    sink.render(slots, () => (rendered += 1))
    const content = slots[0]?.anchor.firstElementChild

    sink.render(slots, () => (rendered += 1))

    expect(rendered).toBe(2)
    expect(slots[0]?.anchor.firstElementChild).toBe(content)
  })

  it("puts focus back on the same count after the redraw", () => {
    const { container, draw } = slotLayer()
    draw(decorated([badge(SHIP, 2, 1)]))
    countButton(container, SHIP, "running")?.focus()

    draw(decorated([badge(SHIP, 3, 1)]))

    expect(document.activeElement).toBe(countButton(container, SHIP, "running"))
  })

  it("leaves focus where the user put it between the redraw and the restore", () => {
    const { container, draw } = slotLayer()
    const elsewhere = document.createElement("input")
    document.body.append(elsewhere)
    draw(decorated([badge(SHIP, 2, 1)]))
    countButton(container, SHIP, "running")?.focus()

    draw(decorated([badge(SHIP, 3, 1)]), () => {
      elsewhere.focus()
    })

    expect(document.activeElement).toBe(elsewhere)
  })

  it("clears its slots, so the sink unmounts every anchor", () => {
    const { layer, sink, draw } = slotLayer()
    const [slot] = draw(decorated([badge(SHIP, 2)]))

    layer.clear()
    sink.render(layer.apply(decorated([])), () => undefined)

    expect(slot?.anchor.childElementCount).toBe(0)
  })
})
