import { afterEach, describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import type { PanelState } from "../../src/core/protocol/index.js"
import { FIXTURES, type FixtureName } from "../../dev/webview/fixtures/states.js"
import { DENSE_ICON_REGIONS } from "./dense-icon-regions.js"
import {
  allParts,
  findPart,
  findRole,
  getRole,
  mount,
  mountApp,
  nextFrame,
  part,
  queryPart,
  type Harness,
} from "./harness.js"

const SCREENS = Object.keys(FIXTURES) as FixtureName[]
const DENSE_REGIONS = Object.values(DENSE_ICON_REGIONS)
  .map((name) => part(name))
  .join(", ")
const TARGETS = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[role='radio']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='separator'][tabindex]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ")

async function settled(harness: Harness, state: PanelState): Promise<void> {
  await vi.waitFor(
    () => {
      if (state.status !== "loading" && harness.root.querySelector("h1") === null) {
        throw new Error("The screen has no heading yet.")
      }
      for (const diagram of allParts(harness.root, "diagram")) {
        if (
          diagram.querySelector("g.djs-element") === null &&
          queryPart(diagram, "diagram-failure") === null
        ) {
          throw new Error("A diagram is not drawn yet.")
        }
      }
    },
    { timeout: 8000, interval: 25 },
  )
  await nextFrame()
}

function shown(element: Element): boolean {
  const box = element.getBoundingClientRect()
  return box.width > 1 && box.height > 1 && element.checkVisibility({ visibilityProperty: true })
}

function describeElement(element: Element): string {
  const label = element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30)
  const box = element.getBoundingClientRect()
  return `${element.tagName.toLowerCase()} "${label}" ${String(Math.round(box.width))}x${String(Math.round(box.height))}`
}

function iconFindings(root: HTMLElement): string[] {
  return [...root.querySelectorAll("svg.lucide")].filter(shown).flatMap((icon) => {
    const style = getComputedStyle(icon)
    const size = Math.round(Number.parseFloat(style.width))
    if (Math.round(Number.parseFloat(style.height)) !== size || (size !== 12 && size !== 16)) {
      return [`icon ${describeElement(icon.parentElement ?? icon)}: ${String(size)} px`]
    }
    return size === 12 && icon.closest(DENSE_REGIONS) === null
      ? [`12 px icon outside a dense region in ${describeElement(icon.parentElement ?? icon)}`]
      : []
  })
}

function targetOf(element: HTMLElement): Element {
  return element instanceof HTMLInputElement ? (element.closest("label") ?? element) : element
}

function targetFindings(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(TARGETS)]
    .filter((element) => element.closest(".djs-overlays") === null)
    .map(targetOf)
    .filter(shown)
    .filter((element) => {
      const { width, height } = element.getBoundingClientRect()
      return Math.round(width) < 24 || Math.round(height) < 24
    })
    .map((element) => `target ${describeElement(element)}`)
}

function findings(root: HTMLElement): string[] {
  return [...iconFindings(root), ...targetFindings(root)]
}

async function open(name: FixtureName): Promise<Harness> {
  await page.viewport(1300, 900)
  const harness = mountApp({ width: 1300 })
  harness.publish(FIXTURES[name])
  await settled(harness, FIXTURES[name])
  return harness
}

describe("the geometry gate", () => {
  it("flags an icon off the sizes, a 12 px icon outside a dense region and a small target", async () => {
    const planted = mount(
      <div>
        <svg class="lucide" width="14" height="14" />
        <span data-part="filter-bar">
          <svg class="lucide" width="12" height="12" />
        </span>
        <span data-part="count-badge">
          <svg class="lucide" width="12" height="12" />
        </span>
        <button type="button" style={{ width: "20px", height: "20px", padding: 0 }}>
          x
        </button>
        <button type="button" style={{ width: "24px", height: "24px", padding: 0 }}>
          y
        </button>
      </div>,
    )
    await nextFrame()

    expect(findings(planted.root)).toEqual([
      expect.stringMatching(/^icon .*: 14 px$/),
      expect.stringMatching(/^12 px icon outside a dense region in span /),
      'target button "x" 20x20',
    ])
    planted.unmount()
  })
})

describe("the geometry of the fixture screens", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it.each(SCREENS)(
    "%s draws its icons at 12 or 16 px and its targets at 24 px or more",
    async (name) => {
      harness = await open(name)

      expect(findings(harness.root)).toEqual([])
    },
  )

  it("measures the icons it holds to the sizes, so the gate is not empty", async () => {
    harness = await open("instance-movable")

    expect(harness.root.querySelectorAll("svg.lucide").length).toBeGreaterThan(3)
  })

  it("keeps the sizes in the open legend, the variable editor, the condition dialog and the move panel", async () => {
    harness = await open("instance-writable")
    getRole<HTMLButtonElement>(harness.root, "button", { name: "Legend" }).click()
    getRole(harness.root, "tab", { name: /^Variables/ }).click()
    ;(await findRole(harness.root, "button", { name: "Edit amount" })).click()
    await findRole(harness.root, "group", { name: "Edit amount" })
    await nextFrame()
    expect(findings(harness.root)).toEqual([])
    harness.unmount()

    harness = await open("definition-filtered")
    getRole(harness.root, "button", { name: "Filter by variables" }).click()
    await findRole(harness.root, "dialog")
    await nextFrame()
    expect(findings(harness.root)).toEqual([])
    harness.unmount()

    harness = await open("instance-movable")
    harness.root
      .querySelector('g.djs-element[data-element-id="Activity_ApproveOrder"] .djs-hit')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    ;(await findPart(harness.root, "move-entry")).click()
    await findRole(harness.root, "group", { name: /^Move the token at / })
    await nextFrame()
    expect(findings(harness.root)).toEqual([])
  })
})
