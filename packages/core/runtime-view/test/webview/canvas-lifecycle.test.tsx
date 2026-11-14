import { afterEach, describe, expect, it, vi } from "vitest"
import orderXml from "../../dev/webview/fixtures/order-fulfillment.bpmn"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import type { DefinitionView, PanelState } from "../../src/core/protocol/index.js"
import type { Decorations } from "../../src/webview/diagram/decoration-layer.js"
import { OverlayFocus } from "../../src/webview/diagram/overlay-focus.js"
import type { OverlaySlot } from "../../src/webview/diagram/overlay-slots.js"
import { RuntimeCanvas } from "../../src/webview/diagram/runtime-canvas.js"
import { fakeApi, mountApp, waitForElement, type Harness } from "./harness.js"

const READY = FIXTURES.definition as PanelState & {
  readonly status: "ready"
  readonly view: DefinitionView
}

const WITHOUT_SHIP_BADGE: PanelState = {
  ...READY,
  view: {
    ...READY.view,
    badges: READY.view.badges.filter((badge) => badge.elementId !== "Activity_ShipOrder"),
  },
}

const DECORATIONS: Decorations = {
  badges: [
    { elementId: "Activity_ShipOrder", running: 2, incidents: 0, incidentsInCalledInstances: 0 },
  ],
  markers: [],
  calls: [],
  stale: false,
}

function canvasWith() {
  const host = document.createElement("div")
  host.style.cssText = "width: 800px; height: 400px;"
  document.body.append(host)
  const rendered: (readonly OverlaySlot[])[] = []
  const options = {
    host,
    overlays: {
      render: (slots: readonly OverlaySlot[], done: () => void) => {
        rendered.push(slots)
        done()
      },
    },
    stateApi: fakeApi([]),
    onSelectElement: vi.fn(),
    onOpenCall: vi.fn(),
    onOpenCode: vi.fn(),
    onImported: vi.fn(),
    onImportFailed: vi.fn(),
  }
  return { canvas: new RuntimeCanvas(options), options, rendered }
}

describe("the runtime canvas's lifecycle", () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it("draws the diagram and hands its overlays to the sink", async () => {
    const { canvas, options, rendered } = canvasWith()

    await canvas.update(orderXml, DECORATIONS)

    expect(options.onImported).toHaveBeenCalledOnce()
    expect(rendered.at(-1)?.map((slot) => slot.key)).toEqual(["Activity_ShipOrder#badges"])
    canvas.destroy()
    expect(rendered.at(-1)).toEqual([])
  })

  it("does nothing more once destroyed while the diagram was still importing", async () => {
    const { canvas, options, rendered } = canvasWith()

    const drawn = canvas.update(orderXml, DECORATIONS)
    await Promise.resolve()
    canvas.destroy()
    await drawn

    expect(options.onImported).not.toHaveBeenCalled()
    expect(options.onImportFailed).not.toHaveBeenCalled()
    expect(rendered).toEqual([[]])
  })

  it("reports no failure once destroyed while a broken diagram was importing", async () => {
    const { canvas, options } = canvasWith()

    const drawn = canvas.update("<not-bpmn/>", DECORATIONS)
    await Promise.resolve()
    canvas.destroy()
    await drawn

    expect(options.onImportFailed).not.toHaveBeenCalled()
  })

  it("reports a broken diagram while it lives", async () => {
    const { canvas, options } = canvasWith()

    await canvas.update("<not-bpmn/>", DECORATIONS)

    expect(options.onImportFailed).toHaveBeenCalledOnce()
    canvas.destroy()
  })
})

describe("the runtime canvas's overlays under React", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("decorates after the effect that hands it new decorations, so React draws the overlays before focus returns", async () => {
    const errors = vi.spyOn(console, "error")
    const restore = OverlayFocus.restore.bind(OverlayFocus)
    const drawnAtRestore: boolean[] = []
    vi.spyOn(OverlayFocus, "restore").mockImplementation((anchors, held) => {
      drawnAtRestore.push(anchors.every((anchor) => anchor.childElementCount > 0))
      restore(anchors, held)
    })
    harness = mountApp()
    harness.publish(WITHOUT_SHIP_BADGE)
    await waitForElement(harness.root, '[data-badge-for="Activity_ApproveOrder"]')
    const drawnBefore = drawnAtRestore.length

    harness.publish(READY)
    await waitForElement(harness.root, '[data-badge-for="Activity_ShipOrder"]')

    await vi.waitFor(() => {
      expect(drawnAtRestore.length).toBeGreaterThan(drawnBefore)
    })
    expect(drawnAtRestore).not.toContain(false)
    expect(errors.mock.calls.flat().map(String).join("\n")).not.toMatch(/flushSync/)
  })
})
