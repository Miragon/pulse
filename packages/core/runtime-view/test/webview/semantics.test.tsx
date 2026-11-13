import { afterEach, describe, expect, it } from "vitest"
import { FIXTURES, type FixtureName } from "../../dev/webview/fixtures/states.js"
import { mountApp, nextFrame, waitForElement, type Harness } from "./harness.js"

describe("the roles and states each screen keeps", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  async function open(name: FixtureName, selector: string): Promise<HTMLElement> {
    harness = mountApp()
    harness.publish(FIXTURES[name])
    const found = await waitForElement<HTMLElement>(harness.root, selector)
    await nextFrame()
    return found
  }

  function all(selector: string): HTMLElement[] {
    return [...harness.root.querySelectorAll<HTMLElement>(selector)]
  }

  it("shows the scope segments as a radiogroup of radios with aria-checked and one tab stop", async () => {
    const group = await open("definition", '[role="radiogroup"]')
    const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]

    expect(group.getAttribute("aria-label")).toBe("Show instances")
    expect(radios.length).toBeGreaterThan(1)
    expect(radios.map((radio) => radio.tagName)).toEqual(radios.map(() => "BUTTON"))
    expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(1)
    expect(radios.every((radio) => ["true", "false"].includes(radio.ariaChecked ?? ""))).toBe(true)
    expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual(
      radios.filter((radio) => radio.ariaChecked === "true"),
    )
  })

  it("shows the instance's tabs as a tablist whose selected tab labels a panel without a tab stop", async () => {
    const list = await open("instance", '[role="tablist"]')
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true")
    const panels = all('[role="tabpanel"]')

    expect(list.getAttribute("aria-label")).not.toBeNull()
    expect(tabs.length).toBeGreaterThan(1)
    expect(selected).toHaveLength(1)
    expect(tabs.every((tab) => ["true", "false"].includes(tab.ariaSelected ?? ""))).toBe(true)
    expect(tabs.map((tab) => tab.tabIndex)).toEqual(
      tabs.map((tab) => (tab === selected[0] ? 0 : -1)),
    )
    expect(panels).toHaveLength(1)
    expect(panels[0]?.getAttribute("aria-labelledby")).toBe(selected[0]?.id)
    expect(selected[0]?.getAttribute("aria-controls")).toBe(panels[0]?.id)
    expect(panels[0]?.hasAttribute("tabindex")).toBe(false)
  })

  it("shows the select-all box in the mixed state while only some instances are selected", async () => {
    const box = await open(
      "definition-selecting",
      'input[type="checkbox"][aria-label="Select all shown instances"]',
    )

    expect((box as HTMLInputElement).indeterminate).toBe(true)
    expect((box as HTMLInputElement).checked).toBe(false)
  })

  it("shows each column grip as a focusable vertical separator with its width in aria-valuenow", async () => {
    await open("definition", ".column-grip")
    const grips = all('[role="separator"][aria-label^="Resize column"]')

    expect(grips.length).toBeGreaterThan(1)
    for (const grip of grips) {
      const now = Number(grip.getAttribute("aria-valuenow"))
      expect(grip.getAttribute("aria-orientation")).toBe("vertical")
      expect(grip.tabIndex).toBe(0)
      expect(now).toBeGreaterThan(0)
      expect(now).toBeLessThanOrEqual(Number(grip.getAttribute("aria-valuemax")))
      expect(grip.getAttribute("aria-valuetext")).toBe(`${now} pixels`)
    }
  })

  it("shows the split between diagram and list as a separator with its share in aria-valuenow", async () => {
    await open("definition", ".column-grip")
    const split = all('[role="separator"]').filter(
      (separator) => !separator.getAttribute("aria-label")?.startsWith("Resize column"),
    )

    expect(split).toHaveLength(1)
    expect(Number(split[0]?.getAttribute("aria-valuenow"))).toBeGreaterThan(0)
  })

  it("shows a running bulk operation as a progressbar with a value text", async () => {
    const bar = await open("definition-bulk-running", '[role="progressbar"]')

    expect(bar.getAttribute("aria-label")).toBe("Progress of the bulk operation")
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(0)
    expect(bar.getAttribute("aria-valuetext")).toMatch(/^[\d,]+ of [\d,]+ done$/)
  })

  it("announces an informing strip as status", async () => {
    const strip = await open("definition", ".status-strip--info")

    expect(strip.getAttribute("role")).toBe("status")
  })

  it("announces a danger strip as alert", async () => {
    const strip = await open("instance-failed-again", ".status-strip--danger")

    expect(strip.getAttribute("role")).toBe("alert")
  })

  it("announces the danger box of a failed read without a view as alert", async () => {
    const box = await open("failed-empty", ".status-box--danger")

    expect(box.getAttribute("role")).toBe("alert")
  })

  it("opens the condition dialog as a native modal dialog", async () => {
    const opener = await open("definition-filtered", '[aria-label="Filter by variables"]')
    opener.click()
    const dialog = await waitForElement<HTMLDialogElement>(harness.root, "dialog[open]")

    expect(dialog).toBeInstanceOf(HTMLDialogElement)
    expect(dialog.matches(":modal")).toBe(true)
  })
})
