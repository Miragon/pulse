import { afterEach, describe, expect, it, vi } from "vitest"
import type { DefinitionView, PanelState } from "../../src/core/protocol/index.js"
import { SELECTING_DEFINITION } from "../../dev/webview/fixtures/bulk.js"
import { DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import {
  enterValue,
  findRole,
  getRole,
  mountApp,
  nextFrame,
  waitForElement,
  press,
  type Harness,
} from "./harness.js"

interface StoredUi {
  readonly pulse?: { readonly diagramShare?: number; readonly columnWidths?: unknown }
}

function pointer(target: HTMLElement, type: string, at: { x?: number; y?: number }): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX: at.x ?? 0, clientY: at.y ?? 0, pointerId: 1 }),
  )
}

function ticked(box: HTMLElement): boolean {
  return box.getAttribute("aria-checked") === "true"
}

function captured(separator: HTMLElement): HTMLElement {
  separator.setPointerCapture = () => undefined
  return separator
}

function ready(view: DefinitionView): PanelState {
  return { status: "ready", view, refreshing: false }
}

function tickedRow(view: DefinitionView, index: number): DefinitionView {
  return {
    ...view,
    instances: view.instances.map((row, at) => (at === index ? { ...row, selected: true } : row)),
  }
}

describe("interaction that does not lean on the renderer's timing", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  function stored(): StoredUi["pulse"] {
    return (harness.api.getState() as StoredUi).pulse
  }

  function republish(fixture: keyof typeof FIXTURES): void {
    harness.publish(FIXTURES[fixture])
  }

  it("stores the split where a drag ended, before the drag's last move rendered", async () => {
    harness = mountApp()
    republish("definition")
    const split = captured(
      await findRole(harness.root, "separator", { name: "Resize diagram and list" }),
    )
    const layout = split.parentElement?.getBoundingClientRect()
    const top = layout?.top ?? 0
    const height = layout?.height ?? 1

    pointer(split, "pointerdown", { y: top + height * 0.55 })
    pointer(split, "pointermove", { y: top + height * 0.3 })
    pointer(split, "pointerup", { y: top + height * 0.3 })

    expect(stored()?.diagramShare).toBeCloseTo(0.3, 2)
  })

  it("steps the split from the last step, however fast the keys come", async () => {
    harness = mountApp()
    republish("definition")
    const split = await findRole(harness.root, "separator", { name: "Resize diagram and list" })

    press(split, "ArrowUp")
    press(split, "ArrowUp")

    expect(stored()?.diagramShare).toBeCloseTo(0.45, 5)
  })

  it("stores a column's width where a drag ended, before the drag's last move rendered", async () => {
    harness = mountApp()
    republish("definition")
    const grip = captured(await findRole(harness.root, "separator", { name: "Resize column ID" }))
    const start = grip.getBoundingClientRect().right

    pointer(grip, "pointerdown", { x: start })
    pointer(grip, "pointermove", { x: start + 40 })
    pointer(grip, "pointerup", { x: start + 40 })

    await nextFrame()
    const widths = stored()?.columnWidths as Record<string, Record<string, number>> | undefined
    const header = grip.parentElement
    expect(Object.values(widths ?? {})[0]?.id).toBe(
      Math.round(header?.getBoundingClientRect().width ?? 0),
    )
  })

  it("moves a table's roving focus only for the row itself, not for a control inside it", async () => {
    harness = mountApp()
    republish("definition-selecting")
    const table = await findRole<HTMLTableElement>(harness.root, "table", { name: "Instances" })
    const [first, second] = [...(table.tBodies[0]?.rows ?? [])]
    const box = second === undefined ? undefined : getRole(second, "checkbox")

    box?.focus()
    await nextFrame()

    expect(first?.tabIndex).toBe(0)
    expect(second?.tabIndex).toBe(-1)
  })

  it("keeps a picked mapping target on screen until the host answers", async () => {
    harness = mountApp()
    republish("migration")
    const table = await findRole(harness.root, "table", { name: "Mapping" })
    const select = getRole<HTMLSelectElement>(table, "combobox", { name: "Map Approve order to" })

    enterValue(select, "")
    republish("migration")

    await vi.waitFor(() => {
      expect(harness.posted.some((intent) => intent.type === "unmapElement")).toBe(true)
    })
    await nextFrame()
    expect(select.value).toBe("")
  })

  it("keeps a picked version on screen until the host answers", async () => {
    harness = mountApp()
    republish("definition")
    const picker = await findRole<HTMLSelectElement>(harness.root, "combobox", { name: "Version" })

    enterValue(picker, "order-fulfillment:6:91e0")
    republish("definition")
    await nextFrame()

    expect(picker.value).toBe("order-fulfillment:6:91e0")
  })

  it("keeps a ticked instance ticked until the host answers", async () => {
    harness = mountApp()
    republish("definition-selecting")
    const table = await findRole<HTMLTableElement>(harness.root, "table", { name: "Instances" })
    const box = await findRole(table, "checkbox", { name: "Select ORD-10440" })
    const before = ticked(box)

    box.click()
    republish("definition-selecting")
    await nextFrame()

    expect(ticked(box)).toBe(!before)
  })

  it("lets a picked version follow the host back to the version it showed before", async () => {
    harness = mountApp()
    republish("definition")
    const picker = await findRole<HTMLSelectElement>(harness.root, "combobox", { name: "Version" })

    enterValue(picker, "order-fulfillment:6:91e0")
    harness.publish(
      ready({
        ...DEFINITION_VIEW,
        selectedDefinitionId: "order-fulfillment:6:91e0",
        selectedVersion: 6,
      }),
    )
    await nextFrame()
    republish("definition")
    await nextFrame()

    expect(picker.value).toBe("order-fulfillment:7:4a1c")
  })

  it("lets a ticked instance follow the host when it clears the selection later", async () => {
    harness = mountApp()
    republish("definition-selecting")
    const table = await findRole<HTMLTableElement>(harness.root, "table", { name: "Instances" })
    const box = await findRole(table, "checkbox", { name: "Select ORD-10440" })
    expect(ticked(box)).toBe(false)

    box.click()
    harness.publish(ready(tickedRow(SELECTING_DEFINITION, 1)))
    await nextFrame()
    expect(ticked(box)).toBe(true)
    republish("definition-selecting")
    await nextFrame()

    expect(ticked(box)).toBe(false)
  })

  it("puts focus into the condition dialog's Name field when it opens", async () => {
    harness = mountApp()
    republish("definition-filtered")
    ;(await findRole(harness.root, "button", { name: "Filter by variables" })).click()
    await waitForElement(harness.root, "dialog[open]")
    await nextFrame()

    expect(document.activeElement).toBe(getRole(harness.root, "combobox", { name: "Name" }))
  })
})
