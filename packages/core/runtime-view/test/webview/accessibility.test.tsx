import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PanelState } from "../../src/core/protocol/index.js"
import { FIXTURES, type FixtureName } from "../../dev/webview/fixtures/states.js"
import { mountApp, nextFrame, waitForElement, type Harness } from "./harness.js"

const WCAG_22_A_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]

const THEMES: readonly (readonly [theme: string, contrast: string | undefined])[] = [
  ["light", undefined],
  ["dark", undefined],
  ["light", "hoch"],
  ["dark", "hoch"],
]

const SCREENS = Object.keys(FIXTURES) as FixtureName[]

function applyTheme(theme: string, contrast: string | undefined): void {
  const { dataset } = document.documentElement
  dataset.cdTheme = theme
  if (contrast === undefined) {
    delete dataset.cdKontrast
  } else {
    dataset.cdKontrast = contrast
  }
}

async function settled(harness: Harness, state: PanelState): Promise<void> {
  await vi.waitFor(
    () => {
      const heading = harness.root.querySelector("h1")
      if (state.status !== "loading" && heading === null) {
        throw new Error("The screen has no heading yet.")
      }
      for (const diagram of harness.root.querySelectorAll(".diagram-region")) {
        const drawn = diagram.querySelector("g.djs-element") !== null
        const failed = diagram.querySelector(".diagram-region__failure") !== null
        if (!drawn && !failed) {
          throw new Error("A diagram is not drawn yet.")
        }
      }
    },
    { timeout: 8000, interval: 25 },
  )
  await nextFrame()
}

async function violations(root: HTMLElement): Promise<{ id: string; nodes: string[] }[]> {
  const result = await axe.run(root, { runOnly: { type: "tag", values: WCAG_22_A_AA } })
  return result.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
  }))
}

async function openTab(harness: Harness, tab: string): Promise<void> {
  const target = [...harness.root.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (candidate) => candidate.firstChild?.textContent === tab,
  )
  target?.click()
  await vi.waitFor(() => {
    expect(target?.getAttribute("aria-selected")).toBe("true")
  })
  await nextFrame()
}

async function open(name: FixtureName, theme: string, contrast: string | undefined) {
  const harness = mountApp()
  applyTheme(theme, contrast)
  harness.publish(FIXTURES[name])
  await settled(harness, FIXTURES[name])
  return harness
}

describe.each(THEMES)("the fixture screens in the %s theme, contrast %s", (theme, contrast) => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
    applyTheme("light", undefined)
  })

  it.each(SCREENS)("%s has no WCAG 2.2 A or AA violation", async (name) => {
    harness = await open(name, theme, contrast)

    expect(await violations(harness.root)).toEqual([])
  })
})

describe("one heading per screen", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it.each(SCREENS.filter((name) => FIXTURES[name].status !== "loading"))(
    "%s has exactly one h1",
    async (name) => {
      harness = await open(name, "light", undefined)

      expect(harness.root.querySelectorAll("h1")).toHaveLength(1)
    },
  )
})

describe.each(THEMES)(
  "the opened parts of a screen in the %s theme, contrast %s",
  (theme, contrast) => {
    let harness: Harness

    afterEach(() => {
      harness.unmount()
      applyTheme("light", undefined)
    })

    it.each(["History", "Incidents", "Waiting", "Variables"])(
      "the instance's %s tab has no violation",
      async (tab) => {
        harness = await open("instance-writable", theme, contrast)
        await openTab(harness, tab)

        expect(await violations(harness.root)).toEqual([])
      },
    )

    it("the variable editor has no violation", async () => {
      harness = await open("instance-writable", theme, contrast)
      await openTab(harness, "Variables")
      const edit = await waitForElement<HTMLButtonElement>(
        harness.root,
        '[aria-label="Edit amount"]',
      )
      edit.click()
      await waitForElement(harness.root, "textarea")
      await nextFrame()

      expect(await violations(harness.root)).toEqual([])
    })

    it("the condition dialog has no violation", async () => {
      harness = await open("definition-filtered", theme, contrast)
      harness.root.querySelector<HTMLElement>('[aria-label="Filter by variables"]')?.click()
      await waitForElement(harness.root, "dialog[open]")
      await nextFrame()

      expect(await violations(harness.root)).toEqual([])
    })

    it("the move panel has no violation", async () => {
      harness = await open("instance-movable", theme, contrast)
      harness.root
        .querySelector('g.djs-element[data-element-id="Activity_ApproveOrder"] .djs-hit')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
      ;(await waitForElement<HTMLElement>(harness.root, ".move-entry")).click()
      await waitForElement(harness.root, '[role="group"][aria-label^="Move the token"]')
      await nextFrame()

      expect(await violations(harness.root)).toEqual([])
    })
  },
)
