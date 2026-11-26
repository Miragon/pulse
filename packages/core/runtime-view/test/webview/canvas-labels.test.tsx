import TextRenderer from "bpmn-js/lib/draw/TextRenderer"
import { afterEach, beforeAll, describe, expect, inject, it, vi, type TestContext } from "vitest"
import orderXml from "../../dev/webview/fixtures/order-fulfillment.bpmn"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import type { Decorations } from "../../src/webview/diagram/decorations.js"
import { RuntimeCanvas } from "../../src/webview/diagram/runtime-canvas.js"
import { fakeApi, findPart, fontsLoaded, mountApp, type Harness } from "./harness.js"

const EVENT = "Event_WaitForPickup"
const LABEL = "Wait for pickup"
const DI = "http://www.omg.org/spec/BPMN/20100524/DI"
const DC = "http://www.omg.org/spec/DD/20100524/DC"
const ARIAL = "Arial, sans-serif"
const GEIST = /^"Geist Variable"/
const NOTHING: Decorations = { badges: [], markers: [], calls: [], stale: false }

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function labelBoundsOf(doc: Document): Element {
  const shape = [...doc.getElementsByTagNameNS(DI, "BPMNShape")].find(
    (candidate) => candidate.getAttribute("bpmnElement") === EVENT,
  )
  const bounds = shape
    ?.getElementsByTagNameNS(DI, "BPMNLabel")[0]
    ?.getElementsByTagNameNS(DC, "Bounds")[0]
  if (bounds === undefined) {
    throw new Error(`The fixture draws no label for ${EVENT}.`)
  }
  return bounds
}

function boxOf(bounds: Element): Box {
  const value = (name: string) => Number(bounds.getAttribute(name))
  return { x: value("x"), y: value("y"), width: value("width"), height: value("height") }
}

function asTheModelerSizesIt(xml: string): { readonly xml: string; readonly box: Box } {
  const doc = new DOMParser().parseFromString(xml, "application/xml")
  const bounds = labelBoundsOf(doc)
  const box = new TextRenderer().getExternalLabelBounds(boxOf(bounds), LABEL)
  for (const [name, value] of Object.entries(box)) {
    bounds.setAttribute(name, String(value))
  }
  return { xml: new XMLSerializer().serializeToString(doc), box }
}

function widthIn(font: string, text: string): number {
  const context = document.createElement("canvas").getContext("2d")
  if (context === null) {
    throw new Error("No 2D context to measure with.")
  }
  context.font = font
  return context.measureText(text).width
}

function widthInGeist(text: string): number {
  return widthIn('11px "Geist Variable"', text)
}

function arialFallsBackToTheNextFamily(): boolean {
  return widthIn("11px Arial, monospace", LABEL) === widthIn("11px monospace", LABEL)
}

const NO_FONT_WITH_ARIAL_METRICS =
  "no font with Arial's metrics is installed (Arial, or Liberation Sans or Arimo, the faces " +
  "Chromium takes for it; fonts-liberation on Debian and Ubuntu, which CI's playwright " +
  "install-deps brings), so bpmn-js would size the box for Arial in another font"

function needsAFontWithArialMetrics(context: TestContext): void {
  const missing = arialFallsBackToTheNextFamily()
  if (inject("runsOnCi")) {
    expect(
      missing,
      `${NO_FONT_WITH_ARIAL_METRICS}, and on CI this case runs rather than skips`,
    ).toBe(false)
  }
  context.skip(missing, NO_FONT_WITH_ARIAL_METRICS)
}

function canvasOn(host: HTMLElement): RuntimeCanvas {
  return new RuntimeCanvas({
    host,
    overlays: {
      render: (_slots, done) => {
        done()
      },
    },
    stateApi: fakeApi([]),
    onSelectElement: vi.fn(),
    onOpenCall: vi.fn(),
    onOpenCode: vi.fn(),
    onImported: vi.fn(),
    onImportFailed: vi.fn(),
  })
}

function textOf(root: ParentNode, elementId: string): SVGTextElement {
  const text = root.querySelector<SVGTextElement>(`[data-element-id="${elementId}"] text`)
  if (text === null) {
    throw new Error(`No text drawn for ${elementId}.`)
  }
  return text
}

function hostOf(width: number): HTMLElement {
  const host = document.createElement("div")
  host.style.cssText = `width: ${String(width)}px; height: 400px;`
  document.body.append(host)
  return host
}

describe("the labels on the diagram", () => {
  let harness: Harness | undefined
  let canvas: RuntimeCanvas | undefined

  beforeAll(fontsLoaded)

  afterEach(() => {
    canvas?.destroy()
    canvas = undefined
    harness?.unmount()
    harness = undefined
    document.body.replaceChildren()
  })

  it("keep one line where the modeler sized the box for Arial, which Geist would overflow", async (context) => {
    needsAFontWithArialMetrics(context)
    const { xml, box } = asTheModelerSizesIt(orderXml)
    expect(document.fonts.check('11px "Geist Variable"')).toBe(true)
    expect(widthInGeist(LABEL)).toBeGreaterThan(box.width)
    const host = hostOf(1000)
    canvas = canvasOn(host)

    await canvas.update(xml, NOTHING)

    const label = textOf(host, `${EVENT}_label`)
    expect(label.textContent).toBe(LABEL)
    expect(label.querySelectorAll("tspan")).toHaveLength(1)
    expect(getComputedStyle(label).fontFamily).toBe(ARIAL)
  })

  it("draw bpmn-js's Arial at its sizes, while the badges over the diagram stay in Geist", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)

    const badge = await findPart(harness.root, "badge-count")
    await vi.waitFor(() => textOf(harness?.root ?? document, `${EVENT}_label`))
    const inside = getComputedStyle(textOf(harness.root, "Activity_ReserveStock"))
    const beside = getComputedStyle(textOf(harness.root, `${EVENT}_label`))
    expect([inside.fontFamily, inside.fontSize]).toEqual([ARIAL, "12px"])
    expect([beside.fontFamily, beside.fontSize]).toEqual([ARIAL, "11px"])
    expect(getComputedStyle(badge).fontFamily).toMatch(GEIST)
  })
})
