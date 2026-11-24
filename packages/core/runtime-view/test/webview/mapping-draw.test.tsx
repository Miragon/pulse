import { afterEach, describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import type { MigrationPlanView, WebviewIntent } from "../../src/core/protocol/index.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import {
  allParts,
  findRole,
  getRole,
  mountApp,
  nextFrame,
  press,
  queryPart,
  waitForElement,
  type Harness,
} from "./harness.js"

const PLAN = FIXTURES["migration-plan"].view
const BLOCKED = FIXTURES["migration-plan-blocked"].view
const RESERVE = "Activity_ReserveStock"
const SHIP = "Activity_ShipOrder"
const APPROVE = "Activity_ApproveOrder"
const CREDIT = "Activity_CheckCredit"

interface Point {
  readonly x: number
  readonly y: number
}

function centerOf(element: Element): Point {
  const box = element.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

function pointer(target: EventTarget, type: string, at: Point): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      clientX: at.x,
      clientY: at.y,
    }),
  )
}

function shapeOf(diagram: Element, elementId: string): Promise<SVGElement> {
  return waitForElement<SVGElement>(diagram, `g.djs-element[data-element-id="${elementId}"]`)
}

function hitOf(diagram: Element, elementId: string): Promise<SVGElement> {
  return waitForElement<SVGElement>(
    diagram,
    `g.djs-element[data-element-id="${elementId}"] .djs-hit`,
  )
}

function handleOf(diagram: Element, elementId: string, kind = "map"): Promise<HTMLButtonElement> {
  return waitForElement<HTMLButtonElement>(
    diagram,
    `[data-part="mapping-handle"] button[data-kind="${kind}"][data-map-from="${elementId}"]`,
  )
}

describe("mapping in the diagrams", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  function posted(type: WebviewIntent["type"]) {
    return harness.posted.filter((intent) => intent.type === type)
  }

  async function open(view: MigrationPlanView = PLAN) {
    await page.viewport(1300, 900)
    harness = mountApp({ width: 1300 })
    harness.publish({ status: "ready", view, refreshing: false })
    await findRole(harness.root, "table", { name: "Mapping" })
    const [source, target] = allParts(harness.root, "migration-diagram")
    await shapeOf(target!, SHIP)
    await nextFrame()
    return { source: source!, target: target! }
  }

  function hint(): string | undefined {
    return queryPart(harness.root, "mapping-hint")?.textContent
  }

  function arrows(drawing = false): Element[] {
    const layer = queryPart(harness.root, "mapping-arrows")!
    return [...layer.querySelectorAll("g > path[data-tone]")].filter(
      (path) => path.hasAttribute("data-drawing") === drawing,
    )
  }

  it("maps an element by dragging its handle onto an element of the other version", async () => {
    const { source, target } = await open()
    const handle = await handleOf(source, RESERVE)
    const ship = centerOf(await hitOf(target, SHIP))

    pointer(handle, "pointerdown", centerOf(handle))
    pointer(window, "pointermove", { x: ship.x - 40, y: ship.y })
    pointer(window, "pointermove", ship)
    await nextFrame()
    await nextFrame()

    expect((await shapeOf(target, SHIP)).classList.contains("pulse-move-to")).toBe(true)
    expect(arrows(true)).toHaveLength(1)
    expect(hint()).toBe("Release to map Reserve stock to Ship order.")

    pointer(window, "pointerup", ship)
    await nextFrame()

    expect(posted("focusMapping")).toEqual([{ type: "focusMapping", sourceElementId: RESERVE }])
    expect(posted("mapElement")).toEqual([
      { type: "mapElement", sourceElementId: RESERVE, targetElementId: SHIP },
    ])
    expect(arrows(true)).toEqual([])
    expect(hint()).toBe("")
  })

  it("maps nothing when the drag ends on an element of another kind", async () => {
    const { source, target } = await open()
    const handle = await handleOf(source, RESERVE)
    const approve = centerOf(await hitOf(target, APPROVE))

    pointer(handle, "pointerdown", centerOf(handle))
    pointer(window, "pointermove", approve)
    pointer(window, "pointerup", approve)
    await nextFrame()

    expect(posted("mapElement")).toEqual([])
    expect((await shapeOf(target, APPROVE)).classList.contains("pulse-move-to")).toBe(false)
  })

  it("maps by a click on the handle and a click on a marked element, the arrow following the pointer", async () => {
    const { source, target } = await open()
    const handle = await handleOf(source, RESERVE)
    const shipHit = await hitOf(target, SHIP)

    pointer(handle, "pointerdown", centerOf(handle))
    pointer(window, "pointerup", centerOf(handle))
    pointer(window, "pointermove", { x: centerOf(shipHit).x - 60, y: centerOf(shipHit).y })
    await nextFrame()
    await nextFrame()

    expect(hint()).toBe("Map Reserve stock: drop or click on a marked element of v7. Esc cancels.")
    expect(arrows(true)).toHaveLength(1)

    pointer(shipHit, "pointerdown", centerOf(shipHit))
    shipHit.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await nextFrame()

    expect(posted("mapElement")).toEqual([
      { type: "mapElement", sourceElementId: RESERVE, targetElementId: SHIP },
    ])
    expect(hint()).toBe("")
  })

  it("stops drawing on Escape and on a press beside the marked elements", async () => {
    const { source, target } = await open()
    const handle = await handleOf(source, RESERVE)

    pointer(handle, "pointerdown", centerOf(handle))
    pointer(window, "pointerup", centerOf(handle))
    await nextFrame()
    press(document.body, "Escape")
    await nextFrame()
    expect(hint()).toBe("")

    pointer(handle, "pointerdown", centerOf(handle))
    pointer(window, "pointerup", centerOf(handle))
    await nextFrame()
    const approve = await hitOf(target, APPROVE)
    pointer(approve, "pointerdown", centerOf(approve))
    await nextFrame()

    expect(hint()).toBe("")
    expect(arrows(true)).toEqual([])
    expect(posted("mapElement")).toEqual([])
  })

  it("removes the mapping of the focused element with its second handle", async () => {
    const { source } = await open()
    const unmap = await handleOf(source, CREDIT, "unmap")

    expect(unmap.getAttribute("aria-label")).toBe("Remove the mapping of Check credit")
    unmap.click()

    expect(posted("unmapElement")).toEqual([{ type: "unmapElement", sourceElementId: CREDIT }])
  })

  it("offers the focused element's handles to the keyboard, and Enter on the map handle moves to its pick in the table", async () => {
    const { source } = await open()
    const handle = await handleOf(source, CREDIT)
    const other = await handleOf(source, RESERVE)

    expect(handle.tabIndex).toBe(0)
    expect(other.tabIndex).toBe(-1)
    expect(handle.getAttribute("aria-label")).toBe("Map Check credit to an element of v7")
    handle.focus()
    await userEvent.keyboard("{Enter}")

    expect(document.activeElement?.getAttribute("aria-label")).toBe("Map Check credit to")
    expect(posted("mapElement")).toEqual([])
  })

  it("shows a hovered element's handles and marks its counterpart in the other version", async () => {
    const { source, target } = await open()
    const handle = await handleOf(source, RESERVE)

    expect(getComputedStyle(handle.parentElement!).opacity).toBe("0")
    ;(await hitOf(source, RESERVE)).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    await nextFrame()

    expect(getComputedStyle(handle.parentElement!).opacity).toBe("1")
    await vi.waitFor(async () => {
      expect((await shapeOf(target, RESERVE)).classList.contains("pulse-counterpart")).toBe(true)
    })
  })

  it("draws the focused mapping as an arrow, and every mapping it can draw on request, in the danger tone where the engine finds a problem", async () => {
    await open({ ...BLOCKED, focused: CREDIT })
    await vi.waitFor(() => {
      expect(arrows().map((arrow) => arrow.getAttribute("data-tone"))).toEqual(["danger"])
    })

    getRole(harness.root, "checkbox", { name: "Show all mappings" }).click()

    await vi.waitFor(() => {
      expect(arrows().map((arrow) => arrow.getAttribute("data-tone"))).toEqual([
        "danger",
        "info",
        "info",
        "info",
      ])
    })
  })

  it("pans and zooms both diagrams together until you set them apart", async () => {
    const { source, target } = await open()
    const zoomOf = (diagram: HTMLElement) => /\d+\s?%/.exec(diagram.textContent)?.[0]
    const before = zoomOf(target)

    press(source.querySelector(".cd-shell-canvas")!, "=", { ctrlKey: true, metaKey: true })

    await vi.waitFor(() => {
      expect(zoomOf(target)).not.toBe(before)
    })
    expect(zoomOf(target)).toBe(zoomOf(source))
    expect(getRole(harness.root, "checkbox", { name: "Pan and zoom together" }).dataset.state).toBe(
      "checked",
    )
  })
})
