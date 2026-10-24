import { afterEach, describe, expect, it, vi } from "vitest"
import type { PanelState, WebviewIntent, WriteState } from "../../src/core/protocol/index.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { MOVABLE_INSTANCE } from "../../dev/webview/fixtures/writable.js"
import { buttonNamed, mountApp, nextFrame, press, waitForElement, type Harness } from "./harness.js"

const APPROVE = "Activity_ApproveOrder"
const TOKEN = { kind: "token", fromElementId: APPROVE } as const

describe("moving a token from the instance screen", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  function posted(type: WebviewIntent["type"]) {
    return harness.posted.filter((intent) => intent.type === type)
  }

  function shape(elementId: string): Element | null {
    return harness.root.querySelector(`g.djs-element[data-element-id="${elementId}"]`)
  }

  async function openMovable(): Promise<void> {
    harness = mountApp()
    harness.publish(FIXTURES["instance-movable"])
    await waitForElement(harness.root, `g.djs-element[data-element-id="${APPROVE}"]`)
  }

  async function selectToken(elementId: string): Promise<HTMLElement> {
    clickShape(elementId)
    return waitForElement<HTMLElement>(harness.root, ".move-entry")
  }

  async function startMove(): Promise<HTMLElement> {
    await openMovable()
    ;(await selectToken(APPROVE)).click()
    return waitForElement<HTMLElement>(harness.root, ".move-panel")
  }

  async function pick(panel: HTMLElement, elementId: string): Promise<void> {
    const select = panel.querySelector("select")!
    select.value = elementId
    select.dispatchEvent(new Event("change", { bubbles: true }))
    await nextFrame()
  }

  async function typeReason(panel: HTMLElement, reason: string): Promise<void> {
    const field = panel.querySelector<HTMLInputElement>('input[type="text"]')!
    field.value = reason
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await nextFrame()
  }

  function clickShape(elementId: string): void {
    shape(elementId)
      ?.querySelector(".djs-hit")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
  }

  function publishWith(write: WriteState | undefined, view = MOVABLE_INSTANCE): void {
    const state: PanelState = {
      status: "ready",
      view: write === undefined ? view : { ...view, write },
      refreshing: false,
    }
    harness.publish(state)
  }

  it("offers the move below the shape of the selected token, beside its other buttons", async () => {
    await openMovable()

    const entry = await selectToken(APPROVE)

    expect(entry.getAttribute("aria-label")).toBe("Move this token…")
    expect(entry.closest(".element-actions")).not.toBeNull()
    expect(harness.root.querySelector("tbody [data-move-from]")).toBeNull()
    expect(harness.root.querySelector("tbody")?.textContent).not.toContain("Move")
  })

  it("reaches the move from the keyboard through the Waiting tab", async () => {
    await openMovable()
    buttonNamed(harness.root, "Approve order").click()

    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute("data-move-from")).toBe(APPROVE)
    })
    ;(document.activeElement as HTMLElement).click()
    await waitForElement(harness.root, ".move-panel")
  })

  it("says on the shape why the selected token cannot move", async () => {
    await openMovable()

    const entry = await selectToken("Activity_CheckCredit")

    expect(entry.classList).toContain("move-entry--refused")
    expect(entry.getAttribute("aria-label")).toBe(
      "Can't move: Open the called instance to move this token.",
    )
    expect(entry.tagName).not.toBe("BUTTON")
  })

  it("shows nothing on the shape of an element without a token", async () => {
    await openMovable()

    clickShape("Activity_ReserveStock")
    await nextFrame()

    expect(harness.root.querySelector(".move-entry")).toBeNull()
  })

  it("shows no move on an engine without writes", async () => {
    harness = mountApp()
    harness.publish(FIXTURES["instance-waiting"])
    await waitForElement(harness.root, `g.djs-element[data-element-id="${APPROVE}"]`)

    clickShape(APPROVE)
    await nextFrame()

    expect(harness.root.querySelector(".move-entry")).toBeNull()
  })

  it("marks the allowed and the refused targets on the diagram", async () => {
    await startMove()

    await vi.waitFor(() => {
      expect(shape("Activity_ReserveStock")?.classList).toContain("pulse-move-target")
    })
    expect(shape("Event_OrderReceived")?.classList).toContain("pulse-move-refused")
  })

  it("previews the move: the source loses its token and the target gains one", async () => {
    const panel = await startMove()

    await pick(panel, "Activity_ShipOrder")

    await vi.waitFor(() => {
      expect(shape(APPROVE)?.classList).toContain("pulse-move-from")
    })
    expect(shape("Activity_ShipOrder")?.classList).toContain("pulse-move-to")
    expect(
      [...harness.root.querySelectorAll(".move-badge")].map((badge) => badge.textContent),
    ).toEqual(expect.arrayContaining(["−1", "+1"]))
    const review = panel.querySelector(".move-panel__review")?.textContent ?? ""
    expect(review).toContain("Cancels Approve order.")
    expect(review).toContain("Ship order already holds a token; then it holds two.")
    expect(review).toContain("This can't be undone.")
  })

  it("shows a re-run as one element that runs again", async () => {
    const panel = await startMove()

    await pick(panel, APPROVE)

    await vi.waitFor(() => {
      expect(harness.root.querySelector(".move-badge--again")?.textContent).toContain("runs again")
    })
    expect(shape(APPROVE)?.classList).not.toContain("pulse-move-from")
  })

  it("picks a target by clicking it on the diagram and explains a refused one", async () => {
    const panel = await startMove()
    await waitForElement(harness.root, ".pulse-move-target")

    clickShape("Event_OrderShipped")
    await vi.waitFor(() => {
      expect(panel.querySelector('[role="status"]')?.textContent).toBe(
        "Can't move to Order shipped: Moving the token to an end event can end the instance.",
      )
    })
    clickShape("Activity_ReserveStock")
    await vi.waitFor(() => {
      expect(panel.querySelector("select")?.value).toBe("Activity_ReserveStock")
    })
    expect(posted("selectElement")).toEqual([{ type: "selectElement", elementId: APPROVE }])
  })

  it("asks for a target and a reason before it sends the move", async () => {
    const panel = await startMove()

    buttonNamed(panel, "Move…").click()
    await nextFrame()
    expect(panel.querySelector('[role="alert"]')?.textContent).toBe("Pick where the token goes.")
    await pick(panel, "Activity_ReserveStock")
    buttonNamed(panel, "Move…").click()
    await nextFrame()
    expect(panel.querySelector('[role="alert"]')?.textContent).toBe("Give a reason for the move.")
    expect(posted("moveToken")).toEqual([])
  })

  it("sends only the ends and the reason", async () => {
    const panel = await startMove()

    await pick(panel, "Activity_ReserveStock")
    await typeReason(panel, "Stock was reserved by hand")
    buttonNamed(panel, "Move…").click()

    expect(posted("moveToken")).toEqual([
      {
        type: "moveToken",
        fromElementId: APPROVE,
        toElementId: "Activity_ReserveStock",
        reason: "Stock was reserved by hand",
      },
    ])
  })

  it("cancels with Escape and puts the focus back on the row", async () => {
    const panel = await startMove()

    press(panel.querySelector("select")!, "Escape")

    await vi.waitFor(() => {
      expect(harness.root.querySelector(".move-panel")).toBeNull()
    })
    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute("data-move-from")).toBe(APPROVE)
    })
  })

  it("holds live updates while the move panel is open", async () => {
    const panel = await startMove()

    expect(posted("holdLiveUpdates")).toEqual([{ type: "holdLiveUpdates", held: true }])
    press(panel.querySelector("select")!, "Escape")

    await vi.waitFor(() => {
      expect(posted("holdLiveUpdates")).toEqual([
        { type: "holdLiveUpdates", held: true },
        { type: "holdLiveUpdates", held: false },
      ])
    })
  })

  it("shows the running move, keeps a failure open and closes once it is done", async () => {
    const panel = await startMove()
    await pick(panel, "Activity_ReserveStock")
    await typeReason(panel, "Stock was reserved by hand")
    buttonNamed(panel, "Move…").click()

    publishWith({ status: "pending", target: TOKEN })
    await vi.waitFor(() => {
      expect(buttonNamed(panel, "Moving…").disabled).toBe(true)
    })
    publishWith({
      status: "failed",
      target: TOKEN,
      message: "local refused the change. Nothing was changed.",
    })
    await vi.waitFor(() => {
      expect(panel.querySelector('[role="alert"]')?.textContent).toBe(
        "local refused the change. Nothing was changed.",
      )
    })
    buttonNamed(panel, "Move…").click()
    publishWith({ status: "pending", target: TOKEN })
    await nextFrame()
    publishWith({ status: "done", target: TOKEN })
    await vi.waitFor(() => {
      expect(harness.root.querySelector(".move-panel")).toBeNull()
    })
  })

  it("closes after a move that follows a cancelled confirmation", async () => {
    const panel = await startMove()
    await pick(panel, "Activity_ReserveStock")
    await typeReason(panel, "Stock was reserved by hand")
    buttonNamed(panel, "Move…").click()
    publishWith({ status: "cancelled", target: TOKEN })
    await nextFrame()

    buttonNamed(panel, "Move…").click()
    await nextFrame()
    publishWith({ status: "cancelled", target: TOKEN })
    await nextFrame()
    publishWith({ status: "pending", target: TOKEN })
    await nextFrame()
    publishWith({ status: "done", target: TOKEN })

    await vi.waitFor(() => {
      expect(harness.root.querySelector(".move-panel")).toBeNull()
    })
  })

  it("says so when the token is gone after a refresh and drops the preview", async () => {
    const panel = await startMove()
    await pick(panel, "Activity_ReserveStock")

    publishWith(undefined, { ...MOVABLE_INSTANCE, moves: [] })

    await vi.waitFor(() => {
      expect(harness.root.querySelector('.move-panel [role="status"]')?.textContent).toBe(
        "This token is no longer at Approve order.",
      )
    })
    expect(harness.root.querySelector(".move-badge")).toBeNull()
    expect(harness.root.querySelector(".pulse-move-from")).toBeNull()
    expect(document.activeElement?.textContent).toBe("Close")
  })
})
