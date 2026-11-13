import { afterEach, describe, expect, it, vi } from "vitest"
import type { DefinitionView, PanelState } from "../../src/core/protocol/index.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { mountApp, waitForElement, type Harness } from "./harness.js"

const READY = FIXTURES.definition as PanelState & {
  readonly status: "ready"
  readonly view: DefinitionView
}

function laterRead(): PanelState {
  const asOf = new Date(Date.parse(READY.view.asOf) + 10_000).toISOString()
  return {
    ...READY,
    view: {
      ...READY.view,
      asOf,
      badges: READY.view.badges.map((badge) => ({ ...badge, running: badge.running + 1 })),
      instances: READY.view.instances.map((row) => ({
        ...row,
        businessKey: `${row.businessKey}+`,
      })),
    },
  }
}

describe("focus across a live update", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("stays on the focused table row when the update changes the row", async () => {
    harness = mountApp()
    harness.publish(READY)
    await waitForElement(harness.root, ".data-table__row--interactive")
    const row = harness.root.querySelectorAll<HTMLElement>(".data-table__row--interactive")[1]
    const key = READY.view.instances[1]?.businessKey ?? ""
    row?.focus()

    harness.publish(laterRead())

    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toContain(`${key}+`)
    })
    expect(document.activeElement).toBe(row)
  })

  it("stays on the focused diagram badge when the update changes its count", async () => {
    harness = mountApp()
    harness.publish(READY)
    const elementId = READY.view.badges.find((badge) => badge.running > 0)?.elementId ?? ""
    const badge = () =>
      harness.root.querySelector<HTMLElement>(
        `[data-badge-for="${elementId}"] [data-scope="running"]`,
      )
    const before = await waitForElement<HTMLElement>(
      harness.root,
      `[data-badge-for="${elementId}"] [data-scope="running"]`,
    )
    before.focus()
    const label = before.getAttribute("aria-label")

    harness.publish(laterRead())

    await vi.waitFor(() => {
      expect(badge()?.getAttribute("aria-label")).not.toBe(label)
    })
    expect(document.activeElement).toBe(badge())
  })

  function withBadge(elementId: string, change: Partial<DefinitionView["badges"][number]>) {
    return {
      ...READY,
      view: {
        ...READY.view,
        badges: READY.view.badges.map((badge) =>
          badge.elementId === elementId ? { ...badge, ...change } : badge,
        ),
      },
    }
  }

  it("moves to another count of the same badge when the focused count leaves", async () => {
    harness = mountApp()
    harness.publish(READY)
    const ship = '[data-badge-for="Activity_ShipOrder"]'
    ;(await waitForElement<HTMLElement>(harness.root, `${ship} [data-scope="running"]`)).focus()

    harness.publish(withBadge("Activity_ShipOrder", { running: 0 }))

    await vi.waitFor(() => {
      expect(harness.root.querySelector(`${ship} [data-scope="running"]`)).toBeNull()
    })
    expect(document.activeElement).toBe(
      harness.root.querySelector(`${ship} [data-scope="withIncident"]`),
    )
  })

  it("does not pull focus back to a badge after the user left the diagram", async () => {
    harness = mountApp()
    harness.publish(READY)
    const ship = '[data-badge-for="Activity_ShipOrder"]'
    ;(await waitForElement<HTMLElement>(harness.root, `${ship} [data-scope="running"]`)).focus()
    const search = harness.root.querySelector<HTMLInputElement>(".search-field input")
    search?.focus()

    harness.publish(withBadge("Activity_ShipOrder", { running: 2 }))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(document.activeElement).toBe(search)
  })
})
