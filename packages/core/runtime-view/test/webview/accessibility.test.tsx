import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import type { PanelState } from "../../src/core/protocol/index.js"
import { FIXTURES, type FixtureName } from "../../dev/webview/fixtures/states.js"
import {
  allParts,
  findPart,
  mountApp,
  nextFrame,
  queryPart,
  waitForElement,
  type Harness,
} from "./harness.js"

const WCAG_22_A_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]

const LANDMARK_RULES = [
  "landmark-one-main",
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "landmark-unique",
]

const THEMES: readonly (readonly [theme: string, contrast: string | undefined])[] = [
  ["light", undefined],
  ["dark", undefined],
  ["light", "hoch"],
  ["dark", "hoch"],
]

const SCREENS = Object.keys(FIXTURES) as FixtureName[]

const HARNESS_WIDTH = 1200
const AXE_RUN_LIMIT = { timeout: 30_000 }

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
      for (const diagram of allParts(harness.root, "diagram")) {
        const drawn = diagram.querySelector("g.djs-element") !== null
        const failed = queryPart(diagram, "diagram-failure") !== null
        if (!drawn && !failed) {
          throw new Error("A diagram is not drawn yet.")
        }
      }
    },
    { timeout: 8000, interval: 25 },
  )
  await nextFrame()
}

function isScaledOverlayTarget(id: string, node: axe.NodeResult): boolean {
  return id === "target-size" && (node.element?.closest(".djs-overlays") ?? null) !== null
}

async function landmarkViolations(root: HTMLElement): Promise<axe.Result[]> {
  const { position } = root.style
  root.style.position = "relative"
  try {
    const result = await axe.run(document, {
      runOnly: { type: "rule", values: LANDMARK_RULES },
      elementRef: true,
    })
    return result.violations
  } finally {
    root.style.position = position
  }
}

async function violations(root: HTMLElement): Promise<{ id: string; nodes: string[] }[]> {
  const result = await axe.run(root, {
    runOnly: { type: "tag", values: WCAG_22_A_AA },
    elementRef: true,
  })
  return [...result.violations, ...(await landmarkViolations(root))]
    .map((violation) => ({
      id: violation.id,
      nodes: violation.nodes
        .filter((node) => !isScaledOverlayTarget(violation.id, node))
        .slice(0, 5)
        .map((node) => node.target.join(" ")),
    }))
    .filter((violation) => violation.nodes.length > 0)
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
  await page.viewport(HARNESS_WIDTH, 900)
  const harness = mountApp({ width: HARNESS_WIDTH })
  applyTheme(theme, contrast)
  harness.publish(FIXTURES[name])
  await settled(harness, FIXTURES[name])
  return harness
}

describe.each(THEMES)(
  "the fixture screens in the %s theme, contrast %s",
  AXE_RUN_LIMIT,
  (theme, contrast) => {
    let harness: Harness

    afterEach(() => {
      harness.unmount()
      applyTheme("light", undefined)
    })

    it.each(SCREENS)("%s has no WCAG 2.2 A or AA violation and one main", async (name) => {
      harness = await open(name, theme, contrast)

      expect(await violations(harness.root)).toEqual([])
    })
  },
)

describe("one heading and one main per screen", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it.each(SCREENS.filter((name) => FIXTURES[name].status !== "loading"))(
    "%s has exactly one h1, in its main",
    async (name) => {
      harness = await open(name, "light", undefined)

      expect(harness.root.querySelectorAll("h1")).toHaveLength(1)
      expect(harness.root.querySelectorAll("main h1")).toHaveLength(1)
    },
  )

  it.each(SCREENS)("%s has exactly one main, around the whole screen", async (name) => {
    harness = await open(name, "light", undefined)

    expect(harness.root.querySelectorAll("main")).toHaveLength(1)
    expect(harness.root.firstElementChild?.tagName).toBe("MAIN")
  })
})

describe.each(THEMES)(
  "the opened parts of a screen in the %s theme, contrast %s",
  AXE_RUN_LIMIT,
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

    it("the condition dialog of an engine that refuses ordering and date conditions has no violation", async () => {
      harness = await open("definition-camunda8", theme, contrast)
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
      ;(await findPart(harness.root, "move-entry")).click()
      await waitForElement(harness.root, '[role="group"][aria-label^="Move the token"]')
      await nextFrame()

      expect(await violations(harness.root)).toEqual([])
    })
  },
)
