import { afterEach, describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import type { PanelState } from "../../src/core/protocol/index.js"
import { FIXTURES, type FixtureName } from "../../dev/webview/fixtures/states.js"
import { DENSE_ICON_REGIONS } from "./dense-icon-regions.js"
import {
  allParts,
  allRoles,
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
const KIT_DENSE_BUTTONS = [
  "[data-slot='button'][data-size='xs']",
  "[data-slot='button'][data-size='icon-xs']",
  "[data-slot='column-menu'][data-size='icon-xs']",
]
const DENSE_REGIONS = [
  ...Object.values(DENSE_ICON_REGIONS).map((name) => part(name)),
  ...KIT_DENSE_BUTTONS,
].join(", ")
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
const SPLIT_HANDLE = "Resize diagram and list"

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
  const boxed = element instanceof HTMLInputElement || element.getAttribute("role") === "checkbox"
  return boxed ? (element.closest("label") ?? element) : element
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

function overlaps(box: DOMRect, reach: DOMRect): boolean {
  return (
    box.left < reach.right &&
    box.right > reach.left &&
    box.top < reach.bottom &&
    box.bottom > reach.top
  )
}

function reachFindings(root: HTMLElement): string[] {
  return allRoles(root, "separator", { name: SPLIT_HANDLE }).flatMap((handle) => {
    const reach = handle.getBoundingClientRect()
    return [...root.querySelectorAll<HTMLElement>(TARGETS)]
      .filter((element) => element !== handle && shown(element))
      .filter((element) => {
        const box = element.getBoundingClientRect()
        const free = Math.max(reach.top - box.top, box.bottom - reach.bottom)
        return overlaps(box, reach) && Math.round(free) < 24
      })
      .map((element) => `reached ${describeElement(element)}`)
  })
}

function findings(root: HTMLElement): string[] {
  return [...iconFindings(root), ...targetFindings(root), ...reachFindings(root)]
}

interface Viewing {
  readonly width: number
  readonly theme: "light" | "dark"
  readonly contrast?: "hoch"
}

const WIDE: Viewing = { width: 1300, theme: "light" }
const NARROW: Viewing = { width: 650, theme: "light" }
const HIGH_CONTRAST: Viewing = { width: 1300, theme: "dark", contrast: "hoch" }

async function open(name: FixtureName, viewing: Viewing = WIDE): Promise<Harness> {
  await page.viewport(viewing.width, 900)
  const harness = mountApp({ width: viewing.width })
  document.documentElement.dataset.cdTheme = viewing.theme
  if (viewing.contrast !== undefined) {
    document.documentElement.dataset.cdKontrast = viewing.contrast
  }
  harness.publish(FIXTURES[name])
  await settled(harness, FIXTURES[name])
  return harness
}

describe("the geometry gate", () => {
  it("flags an icon off the sizes, a 12 px icon outside a dense region, a small target and one the split's handle covers", async () => {
    const planted = mount(
      <div>
        <svg className="lucide" width="14" height="14" />
        <span data-part="filter-bar">
          <svg className="lucide" width="12" height="12" />
        </span>
        <span data-part="count-badge">
          <svg className="lucide" width="12" height="12" />
        </span>
        <button type="button" style={{ width: "20px", height: "20px", padding: 0 }}>
          x
        </button>
        <button type="button" style={{ width: "24px", height: "24px", padding: 0 }}>
          y
        </button>
        <button
          type="button"
          data-slot="button"
          data-size="icon-xs"
          aria-label="z"
          style={{ width: "24px", height: "24px", padding: 0 }}
        >
          <svg className="lucide" width="12" height="12" />
        </button>
        <label style={{ display: "inline-block", width: "28px", height: "28px" }}>
          <button
            type="button"
            role="checkbox"
            aria-checked="false"
            aria-label="w"
            style={{ width: "18px", height: "18px", padding: 0 }}
          />
        </label>
        <div style={{ position: "relative", height: "80px" }}>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={50}
            aria-label={SPLIT_HANDLE}
            tabIndex={0}
            style={{ position: "absolute", inset: "30px 0 auto", height: "24px", zIndex: 1 }}
          />
          <button
            type="button"
            style={{ position: "absolute", top: "40px", width: "30px", height: "30px", padding: 0 }}
          >
            v
          </button>
          <button
            type="button"
            style={{ position: "absolute", top: "0", width: "30px", height: "30px", padding: 0 }}
          >
            u
          </button>
        </div>
      </div>,
    )
    await nextFrame()

    expect(findings(planted.root)).toEqual([
      expect.stringMatching(/^icon .*: 14 px$/),
      expect.stringMatching(/^12 px icon outside a dense region in span /),
      'target button "x" 20x20',
      'reached button "v" 30x30',
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
    "%s draws its icons at 12 or 16 px and its targets at 24 px or more, the split's handle over none",
    async (name) => {
      harness = await open(name)

      expect(findings(harness.root)).toEqual([])
    },
  )

  it.each(SCREENS)("%s keeps them at 650 px, where the bars collapse", async (name) => {
    harness = await open(name, NARROW)

    expect(findings(harness.root)).toEqual([])
  })

  it.each(SCREENS)("%s keeps them in the dark high-contrast theme", async (name) => {
    harness = await open(name, HIGH_CONTRAST)

    expect(findings(harness.root)).toEqual([])
  })

  it("measures the icons it holds to the sizes and the split's handle, so the gate is not empty", async () => {
    harness = await open("instance-movable")

    expect(harness.root.querySelectorAll("svg.lucide").length).toBeGreaterThan(3)
    expect(getRole(harness.root, "separator", { name: SPLIT_HANDLE }).offsetHeight).toBe(24)
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
