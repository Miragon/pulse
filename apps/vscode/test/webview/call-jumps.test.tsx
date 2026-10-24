import { afterEach, describe, expect, it, vi } from "vitest"
import type { DefinitionView, InstanceView, PanelState } from "../../src/core/protocol/index.js"
import parcelReturnXml from "../../dev/webview/fixtures/parcel-return.bpmn"
import { DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { INSTANCE_WITH_CALLED_INCIDENT } from "../../dev/webview/fixtures/instance.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { mountApp, nextFrame, waitForElement } from "./harness.js"
import type { Harness } from "./harness.js"

const PARCEL_RETURN: DefinitionView = {
  ...DEFINITION_VIEW,
  processName: "Parcel return",
  bpmnProcessId: "parcel-return",
  diagramXml: parcelReturnXml,
  badges: [
    {
      elementId: "Activity_InspectParcel",
      running: 3,
      incidents: 1,
      incidentsInCalledInstances: 0,
    },
    { elementId: "Activity_CheckParcel", running: 2, incidents: 0, incidentsInCalledInstances: 0 },
    { elementId: "Activity_ReadScale", running: 0, incidents: 1, incidentsInCalledInstances: 0 },
  ],
  calls: [{ elementId: "Activity_NotifyCustomer", label: "Open called process Notification" }],
  notices: [],
}

function ready(view: DefinitionView | InstanceView): PanelState {
  return { status: "ready", refreshing: false, view }
}

function overlaysOf(root: HTMLElement, elementId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`.djs-overlays[data-container-id="${elementId}"]`)
}

function overlayPart<T extends Element>(
  root: HTMLElement,
  elementId: string,
  selector: string,
): Promise<T> {
  return vi.waitFor(
    () => {
      const found = overlaysOf(root, elementId)?.querySelector<T>(selector)
      if (found === null || found === undefined) {
        throw new Error(`Nothing matches ${selector} on ${elementId} yet.`)
      }
      return found
    },
    { timeout: 5000, interval: 25 },
  )
}

function shown(element: HTMLElement | null): boolean {
  const badges = element?.querySelector<HTMLElement>(".djs-overlay-pulse-badges")
  return badges !== null && badges !== undefined && badges.style.display !== "none"
}

function storedView(harness: Harness): unknown {
  return (harness.api.getState() as { modelerShell?: { view?: unknown } } | undefined)?.modelerShell
    ?.view
}

function calledInstance(parentLabel: string): PanelState {
  return ready({
    ...INSTANCE_WITH_CALLED_INCIDENT,
    instance: {
      ...INSTANCE_WITH_CALLED_INCIDENT.instance,
      parent: { instanceId: "63e79cda-cd7f-11f1-86d2-667bc3771e0d", label: parentLabel },
    },
  })
}

function textNodeOf(element: Element, text: string): Text {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent === text) {
      return node as Text
    }
  }
  throw new Error(`No text ${text}.`)
}

function verticalCentre(box: DOMRect): number {
  return box.top + box.height / 2
}

function offsetFromShape(root: HTMLElement, button: Element, elementId: string) {
  const shape = root
    .querySelector(`g.djs-element[data-element-id="${elementId}"] .djs-visual`)
    ?.getBoundingClientRect()
  const own = button.getBoundingClientRect()
  return {
    right: Math.round((own.right - (shape?.right ?? 0)) * 10) / 10,
    bottom: Math.round((own.bottom - (shape?.bottom ?? 0)) * 10) / 10,
    width: Math.round(own.width),
  }
}

describe("jumping into a call activity from the diagram", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("opens the called process with one click, to the side with Ctrl or Cmd", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const button = await waitForElement<HTMLButtonElement>(
      harness.root,
      '[data-call-for="Activity_CheckCredit"]',
    )

    expect(button.getAttribute("aria-label")).toBe("Open called process Credit scoring")
    expect(button.title).toBe("Open called process Credit scoring")
    button.click()
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))

    expect(harness.posted.filter((intent) => intent.type !== "filterInstances")).toEqual([
      { type: "openCall", elementId: "Activity_CheckCredit", toSide: false },
      { type: "openCall", elementId: "Activity_CheckCredit", toSide: true },
    ])
  })

  it("sits where bpmn-js puts its drill-down and is as large", async () => {
    harness = mountApp()
    harness.publish(ready(PARCEL_RETURN))
    const call = await waitForElement(harness.root, '[data-call-for="Activity_NotifyCustomer"]')
    const drilldown = await waitForElement(
      overlaysOf(harness.root, "Activity_InspectParcel") ?? harness.root,
      ".bjs-drilldown:not(.call-button)",
    )
    await nextFrame()

    expect(offsetFromShape(harness.root, call, "Activity_NotifyCustomer")).toEqual(
      offsetFromShape(harness.root, drilldown, "Activity_InspectParcel"),
    )
    expect(getComputedStyle(call).backgroundColor).toBe(getComputedStyle(drilldown).backgroundColor)
  })

  it("draws a process that is not deployed outlined", async () => {
    harness = mountApp()
    harness.publish(
      ready({
        ...DEFINITION_VIEW,
        calls: [
          {
            elementId: "Activity_CheckCredit",
            label: "credit-scoring isn't deployed on local-operaton",
            missing: true,
          },
        ],
      }),
    )
    const button = await waitForElement<HTMLButtonElement>(
      harness.root,
      '[data-call-for="Activity_CheckCredit"]',
    )

    expect(button.classList).toContain("call-button--missing")
    expect(getComputedStyle(button).borderTopStyle).toBe("solid")
    expect(button.title).toBe("credit-scoring isn't deployed on local-operaton")
  })

  it("links a called instance back to its caller and shows the strip of a missing process", async () => {
    harness = mountApp()
    harness.publish(
      ready({
        ...INSTANCE_WITH_CALLED_INCIDENT,
        instance: {
          ...INSTANCE_WITH_CALLED_INCIDENT.instance,
          parent: { instanceId: "63e79cda-cd7f-11f1-86d2-667bc3771e0d", label: "from 63e79cda…" },
        },
        notice: { tone: "info", title: "credit-scoring isn't deployed on local.", actions: [] },
      }),
    )
    const strip = await waitForElement(harness.root, ".status-strip")
    const parent = [...harness.root.querySelectorAll("button")].find(
      (button) => button.textContent === "from 63e79cda…",
    )

    parent?.click()

    expect(strip.parentElement?.textContent).toContain("credit-scoring isn't deployed on local.")
    expect(parent?.title).toBe("Open the calling instance 63e79cda-cd7f-11f1-86d2-667bc3771e0d")
    expect(harness.posted).toContainEqual({
      type: "openInstance",
      instanceId: "63e79cda-cd7f-11f1-86d2-667bc3771e0d",
      toSide: false,
    })
  })

  it("keeps the arrow and a long caller on one line and cuts the caller with an ellipsis", async () => {
    const caller = "from 63e79cda-cd7f-11f1-86d2-667bc3771e0d"
    harness = mountApp({ width: 760 })
    harness.publish(calledInstance(caller))
    const link = await waitForElement<HTMLButtonElement>(
      harness.root,
      '[title^="Open the calling instance"]',
    )
    await nextFrame()
    const text = textNodeOf(link, caller)
    const range = document.createRange()
    range.selectNodeContents(text)
    const icon = link.querySelector(".icon")!.getBoundingClientRect()
    const label = text.parentElement!

    expect(
      Math.abs(verticalCentre(icon) - verticalCentre(range.getBoundingClientRect())),
    ).toBeLessThan(2)
    expect(icon.right).toBeLessThanOrEqual(range.getBoundingClientRect().left)
    expect(label.scrollWidth).toBeGreaterThan(label.clientWidth)
    expect(getComputedStyle(label).textOverflow).toBe("ellipsis")
  })
})

describe("a collapsed sub-process", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("shows its roll-up on top and the badges and markers inside once drilled into", async () => {
    harness = mountApp()
    harness.publish(ready(PARCEL_RETURN))
    await overlayPart(harness.root, "Activity_InspectParcel", '[data-variant="incident"]')

    expect(shown(overlaysOf(harness.root, "Activity_InspectParcel"))).toBe(true)
    expect(shown(overlaysOf(harness.root, "Activity_CheckParcel"))).toBe(false)
    expect(
      harness.root.querySelector('g.djs-element[data-element-id="Activity_InspectParcel"]')
        ?.classList,
    ).toContain("pulse-incident")

    overlaysOf(harness.root, "Activity_InspectParcel")
      ?.querySelector<HTMLButtonElement>(".bjs-drilldown")
      ?.click()
    await nextFrame()

    expect(shown(overlaysOf(harness.root, "Activity_CheckParcel"))).toBe(true)
    expect(shown(overlaysOf(harness.root, "Activity_InspectParcel"))).toBe(false)
    overlaysOf(harness.root, "Activity_WeighParcel")
      ?.querySelector<HTMLButtonElement>(".bjs-drilldown")
      ?.click()
    await nextFrame()
    expect(
      harness.root.querySelector('g.djs-element[data-element-id="Activity_ReadScale"]')?.classList,
    ).toContain("pulse-incident")
  })

  it("stays drilled in on a refresh and never stores the view of the inner plane", async () => {
    harness = mountApp()
    harness.publish(ready(PARCEL_RETURN))
    const drilldown = await overlayPart<HTMLButtonElement>(
      harness.root,
      "Activity_InspectParcel",
      ".bjs-drilldown",
    )
    await vi.waitFor(() => {
      expect(storedView(harness)).toBeDefined()
    })
    const topView = storedView(harness)

    drilldown.click()
    harness.publish(ready({ ...PARCEL_RETURN, asOf: "2026-10-21T10:00:00Z" }))
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(shown(overlaysOf(harness.root, "Activity_CheckParcel"))).toBe(true)
    expect(storedView(harness)).toEqual(topView)
  })
})
