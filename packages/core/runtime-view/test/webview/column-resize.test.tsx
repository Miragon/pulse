import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cdp } from "vitest/browser"
import type { PanelState } from "../../src/core/protocol/index.js"
import { FILTERED_DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import {
  buttonNamed,
  fontsLoaded,
  mountApp,
  nextFrame,
  allRoles,
  findPart,
  findRole,
  getRole,
  press,
  queryPart,
  waitForElement,
  type Harness,
} from "./harness.js"

const FILTERED: PanelState = { status: "ready", refreshing: false, view: FILTERED_DEFINITION_VIEW }

function gripOf(root: ParentNode, label: string): HTMLElement {
  const grip = root.querySelector<HTMLElement>(`[aria-label="Resize column ${label}"]`)
  if (grip === null) {
    throw new Error(`No grip for ${label}.`)
  }
  grip.setPointerCapture = () => undefined
  return grip
}

function headersOf(root: HTMLElement): HTMLElement[] {
  return allRoles(getRole(root, "table", { name: "Instances" }), "columnheader")
}

function widthOf(element: Element | null | undefined): number {
  return Math.round(element?.getBoundingClientRect().width ?? 0)
}

function pointer(grip: HTMLElement, type: string, clientX: number): void {
  grip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 }))
}

function storedWidths(harness: Harness): unknown {
  return (harness.api.getState() as { pulse?: { columnWidths?: unknown } }).pulse?.columnWidths
}

function floorOf(grip: HTMLElement): number {
  return Math.max(48, Math.round((grip.parentElement?.firstElementChild?.scrollWidth ?? 0) + 24))
}

async function settled(): Promise<void> {
  await nextFrame()
}

interface MediaEmulation {
  send(
    method: "Emulation.setEmulatedMedia",
    params: { features: { name: string; value: string }[] },
  ): Promise<unknown>
}

async function emulateForcedColours(value: "active" | "none"): Promise<void> {
  const session = cdp() as unknown as MediaEmulation
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "forced-colors", value }],
  })
}

function systemColour(name: string): string {
  const probe = document.createElement("i")
  probe.style.color = name
  document.body.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

describe("resizable columns", () => {
  let harness: Harness

  beforeAll(fontsLoaded)

  afterEach(() => {
    harness.unmount()
  })

  it("offers a keyboard separator on every header but the last", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    await findRole(harness.root, "separator", { name: "Resize column ID" })

    const headers = headersOf(harness.root)
    const grips = headers.map((header) => header.querySelector('[role="separator"]'))

    expect(grips.map((grip) => grip?.getAttribute("aria-label"))).toEqual([
      "Resize column ID",
      "Resize column Business key",
      "Resize column State",
      undefined,
    ])
    expect(grips[1]?.getAttribute("aria-orientation")).toBe("vertical")
    expect(grips[1]?.getAttribute("tabindex")).toBe("0")
  })

  it("names each header by its caption alone, its grip and its menu by their own", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    await findRole(harness.root, "separator", { name: "Resize column ID" })
    const table = getRole(harness.root, "table", { name: "Instances" })

    for (const caption of ["ID", "Business key", "State"]) {
      const header = getRole(table, "columnheader", { name: caption })
      expect(getRole(header, "separator", { name: `Resize column ${caption}` })).toBeTruthy()
      expect(getRole(header, "button", { name: `Width of column ${caption}` })).toBeTruthy()
    }
  })

  it("outlines a focused grip in Highlight under forced colours, and draws nothing at rest", async () => {
    await emulateForcedColours("active")
    try {
      harness = mountApp()
      harness.publish(FIXTURES.definition)
      const grip = await findRole(harness.root, "separator", { name: "Resize column ID" })
      expect(getComputedStyle(grip).outlineStyle).toBe("none")

      grip.focus()
      await settled()

      const outline = getComputedStyle(grip)
      expect(grip.matches(":focus-visible")).toBe(true)
      expect(`${outline.outlineStyle} ${outline.outlineWidth}`).toBe("solid 2px")
      expect(outline.outlineColor).toBe(systemColour("Highlight"))
    } finally {
      await emulateForcedColours("none")
    }
  })

  it("keeps the content-fit layout until the first resize, then freezes every width", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const grip = await waitForElement<HTMLElement>(
      harness.root,
      '[aria-label="Resize column Business key"]',
    )
    grip.focus()
    await settled()
    const headers = headersOf(harness.root)
    const before = headers.map(widthOf)
    expect(queryPart(harness.root, "data-table", { state: "fixed" })).toBeNull()
    expect(harness.root.querySelector("colgroup")).toBeNull()
    expect(grip.getAttribute("aria-valuenow")).toBe(String(before[1]))
    press(grip, "ArrowRight")
    await settled()

    expect(queryPart(harness.root, "data-table", { state: "fixed" })).not.toBeNull()
    expect(headers.map(widthOf).slice(0, 3)).toEqual([before[0], (before[1] ?? 0) + 8, before[2]])
    expect(grip.getAttribute("aria-valuetext")).toBe(`${(before[1] ?? 0) + 8} pixels`)
    press(grip, "ArrowRight", { shiftKey: true })
    await settled()
    press(grip, "ArrowLeft")
    await settled()
    expect(widthOf(headers[1])).toBe((before[1] ?? 0) + 32)
  })

  it("sets the minimum with Home: the label and its menu plus 24 pixels, never below 48", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const grip = await waitForElement<HTMLElement>(harness.root, '[aria-label="Resize column ID"]')
    const label = queryPart(headersOf(harness.root)[0]!, "column-label")!

    press(grip, "Home")
    await settled()

    expect(grip.parentElement?.contains(label)).toBe(true)
    expect(widthOf(grip.parentElement)).toBe(floorOf(grip))
  })

  it("drags a column and keeps its width in the webview state of the panel", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    await waitForElement(harness.root, '[aria-label="Resize column Business key"]')
    const grip = gripOf(harness.root, "Business key")
    const start = widthOf(grip.parentElement)

    pointer(grip, "pointerdown", 300)
    pointer(grip, "pointermove", 360)
    await settled()
    pointer(grip, "pointerup", 360)
    await settled()

    expect(widthOf(grip.parentElement)).toBe(start + 60)
    expect(storedWidths(harness)).toMatchObject({ instances: { businessKey: start + 60 } })
    expect(document.documentElement.querySelector("[data-dragging]")).toBeNull()
  })

  it("restores the start width when Escape cancels a drag and keeps the element filter", async () => {
    harness = mountApp()
    harness.publish(FILTERED)
    await waitForElement(harness.root, '[aria-label="Resize column Business key"]')
    const grip = gripOf(harness.root, "Business key")
    const start = widthOf(grip.parentElement)
    expect(floorOf(grip)).toBeLessThanOrEqual(start)

    pointer(grip, "pointerdown", 300)
    pointer(grip, "pointermove", 380)
    await settled()
    expect(widthOf(grip.parentElement)).toBe(start + 80)
    press(grip, "Escape")
    pointer(grip, "pointermove", 420)
    pointer(grip, "pointerup", 420)
    await settled()

    expect(widthOf(grip.parentElement)).toBe(start)
    expect(harness.posted.filter((intent) => intent.type === "filterInstances")).toEqual([])
  })

  it("fits a column to its widest cell with a double-click or Enter", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    await waitForElement(harness.root, '[aria-label="Resize column Business key"]')
    const grip = gripOf(harness.root, "Business key")
    const natural = widthOf(grip.parentElement)
    expect(floorOf(grip)).toBeLessThanOrEqual(natural)

    press(grip, "ArrowRight", { shiftKey: true })
    await settled()
    grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    await settled()
    expect(widthOf(grip.parentElement)).toBe(natural)

    press(grip, "Home")
    await settled()
    press(grip, "Enter")
    await settled()
    expect(widthOf(grip.parentElement)).toBe(natural)
  })

  it("fits at most half of the visible table", async () => {
    harness = mountApp({ width: 500 })
    harness.publish(FIXTURES.instance)
    await findPart(harness.root, "incident-card")
    buttonNamed(harness.root, "Variables6").click()
    await waitForElement(harness.root, '[aria-label="Resize column Value"]')
    const grip = gripOf(harness.root, "Value")
    const visible = queryPart(harness.root, "data-table")!.clientWidth

    press(grip, "Enter")
    await settled()

    expect(widthOf(grip.parentElement)).toBe(Math.round(visible / 2))
  })

  it("restores kept widths and ignores widths it cannot trust", async () => {
    harness = mountApp({
      stored: {
        pulse: { columnWidths: { instances: { id: 120, businessKey: 200, state: 140 } } },
      },
    })
    harness.publish(FIXTURES.definition)
    await findPart(harness.root, "data-table", { state: "fixed" })
    const headers = headersOf(harness.root)
    expect(headers.map(widthOf).slice(0, 3)).toEqual([120, 200, 140])
    harness.unmount()

    for (const kept of [{ id: 5, businessKey: 200, state: 140 }, { id: 120 }, "wide"]) {
      harness = mountApp({ stored: { pulse: { columnWidths: { instances: kept } } } })
      harness.publish(FIXTURES.definition)
      await findRole(harness.root, "table", { name: "Instances" })
      expect(queryPart(harness.root, "data-table", { state: "fixed" })).toBeNull()
      harness.unmount()
    }
    harness = mountApp()
  })

  it("cuts off a cell with an ellipsis and offers the full text as its title", async () => {
    harness = mountApp({
      stored: {
        pulse: { columnWidths: { instances: { id: 120, businessKey: 48, state: 140 } } },
      },
    })
    harness.publish(FIXTURES.definition)
    const row = await waitForElement(harness.root, "tbody tr")
    const cell = row.querySelectorAll("td")[1]!

    cell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }))

    expect(cell.title).toBe("ORD-10442")
    expect(getComputedStyle(cell).textOverflow).toBe("ellipsis")
  })

  it("keeps the widths of the Waiting and the Variables table apart", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    await findPart(harness.root, "incident-card")
    buttonNamed(harness.root, "Waiting1").click()
    await waitForElement(harness.root, '[aria-label="Resize column Waiting at"]')
    press(gripOf(harness.root, "Waiting at"), "Home")
    buttonNamed(harness.root, "Variables6").click()
    await waitForElement(harness.root, '[aria-label="Resize column Name"]')
    press(gripOf(harness.root, "Name"), "Home")

    await vi.waitFor(() => {
      expect(Object.keys(storedWidths(harness) as object).sort()).toEqual(["variables", "waiting"])
    })
  })
})

describe("the split between diagram and list", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("moves with the arrow keys and restores its share when Escape cancels a drag", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const handle = await findRole(harness.root, "separator", { name: "Resize diagram and list" })
    handle.setPointerCapture = () => undefined

    press(handle, "ArrowDown")
    await settled()
    expect(handle.getAttribute("aria-valuenow")).toBe("60")

    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientY: 400 }))
    handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientY: 300 }))
    await settled()
    expect(handle.getAttribute("aria-valuenow")).not.toBe("60")
    press(handle, "Escape")
    await settled()

    expect(handle.getAttribute("aria-valuenow")).toBe("60")
  })
})
