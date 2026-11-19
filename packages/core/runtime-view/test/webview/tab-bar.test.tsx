import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cdp } from "vitest/browser"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { findRole, fontsLoaded, getRole, mountApp, nextFrame, type Harness } from "./harness.js"

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

async function instanceTabs(harness: Harness): Promise<HTMLElement> {
  harness.publish(FIXTURES.instance)
  const list = await findRole(harness.root, "tablist", { name: "Instance details" })
  await nextFrame()
  return list
}

function ruleTop(list: HTMLElement): number {
  const bar = list.parentElement!
  const width = Number.parseFloat(getComputedStyle(bar).borderBottomWidth)
  expect(width, "the bar draws the rule").toBe(1)
  return bar.getBoundingClientRect().bottom - width
}

function tabsReachingOver(list: HTMLElement, top: number): string[] {
  return [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
    .filter((tab) => tab.getBoundingClientRect().bottom > top + 0.5)
    .map((tab) => tab.textContent)
}

describe("the instance's tab bar", () => {
  let harness: Harness

  beforeAll(fontsLoaded)

  afterEach(() => {
    harness.unmount()
  })

  it("shows the selected tab whole when it lies out of view at first render", async () => {
    harness = mountApp({ width: 320, stored: { pulse: { instanceTab: "variables" } } })
    const list = await instanceTabs(harness)
    const selected = getRole(list, "tab", { name: /^Variables/ })
    expect(selected.getAttribute("aria-selected")).toBe("true")
    expect(list.scrollWidth, "the tabs need more room than the bar has").toBeGreaterThan(
      list.clientWidth,
    )

    await vi.waitFor(() => {
      const box = selected.getBoundingClientRect()
      const shown = list.getBoundingClientRect()
      expect(box.left).toBeGreaterThanOrEqual(shown.left)
      expect(box.right).toBeLessThanOrEqual(shown.right + 0.5)
    })
    expect(list.scrollLeft).toBeGreaterThan(0)
    expect(document.activeElement).not.toBe(selected)
  })

  it("lays the open tab's bar over the rule", async () => {
    harness = mountApp()
    const list = await instanceTabs(harness)
    const open = getRole(list, "tab", { selected: true })

    expect(tabsReachingOver(list, ruleTop(list))).toContain(open.textContent)
    expect(open.getBoundingClientRect().bottom).toBe(
      list.parentElement!.getBoundingClientRect().bottom,
    )
  })

  it("keeps the rule whole under forced colours: no tab reaches over it, the open one on it", async () => {
    await emulateForcedColours("active")
    try {
      harness = mountApp()
      const list = await instanceTabs(harness)
      const top = ruleTop(list)

      expect(tabsReachingOver(list, top)).toEqual([])
      const open = getRole(list, "tab", { selected: true })
      expect(Math.round(open.getBoundingClientRect().bottom)).toBe(Math.round(top))
    } finally {
      await emulateForcedColours("none")
    }
  })
})
