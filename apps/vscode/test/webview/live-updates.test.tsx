import { afterEach, describe, expect, it, vi } from "vitest"
import type { DefinitionView, LiveUpdates, PanelState } from "../../src/core/protocol/index.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { App } from "../../src/webview/app.js"
import { HostBridge } from "../../src/webview/host/host-bridge.js"
import { render } from "preact"
import { buttonNamed, mountApp, waitForElement } from "./harness.js"
import type { Harness } from "./harness.js"

const VIEW = (FIXTURES.definition as { readonly view: DefinitionView }).view

function live(status: LiveUpdates, ageMs = 1000, refreshing = false): PanelState {
  return {
    status: "ready",
    view: { ...VIEW, asOf: new Date(Date.now() - ageMs).toISOString() },
    refreshing,
    live: status,
  }
}

function stamp(harness: Harness): HTMLElement {
  const found = harness.root.querySelector<HTMLElement>(".freshness")
  if (found === null) {
    throw new Error("no freshness stamp")
  }
  return found
}

function liveButton(harness: Harness): HTMLButtonElement | null {
  return harness.root.querySelector<HTMLButtonElement>(".live-button")
}

describe("the freshness stamp with live updates", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("shows only the time while live and names the cadence in its tooltip", async () => {
    harness = mountApp()
    harness.publish(live({ status: "live", everySeconds: 10 }))
    await waitForElement(harness.root, ".live-button")

    expect(stamp(harness).textContent).toMatch(/^As of \d\d:\d\d:\d\d$/)
    expect(stamp(harness).title).toContain(
      "Updates every 10 s while this tab is visible and the window has focus.",
    )
    expect(stamp(harness).getAttribute("role")).toBeNull()
    expect(liveButton(harness)?.getAttribute("aria-label")).toBe("Pause live updates")
  })

  it("pauses and resumes on request", async () => {
    harness = mountApp()
    harness.publish(live({ status: "live", everySeconds: 10 }))
    ;(await waitForElement<HTMLButtonElement>(harness.root, ".live-button")).click()
    expect(harness.posted).toContainEqual({ type: "pauseLiveUpdates" })

    harness.publish(live({ status: "paused", reason: "user" }))
    await vi.waitFor(() => {
      expect(stamp(harness).textContent).toMatch(/^Paused · as of /)
    })
    expect(stamp(harness).title).toContain("Resume reads the engine at once.")
    liveButton(harness)?.click()
    expect(harness.posted).toContainEqual({ type: "resumeLiveUpdates" })
  })

  it("says why it pauses on its own and still offers a pause", async () => {
    harness = mountApp()
    harness.publish(live({ status: "paused", reason: "background" }))
    await vi.waitFor(() => {
      expect(stamp(harness).textContent).toMatch(/^Paused · as of /)
    })

    expect(stamp(harness).title).toContain("while this window is in the background")
    expect(liveButton(harness)?.getAttribute("aria-label")).toBe("Pause live updates")
  })

  it("marks data older than two intervals as stale with its age", async () => {
    harness = mountApp()
    harness.publish(live({ status: "live", everySeconds: 10 }, 120_000))
    await waitForElement(harness.root, ".freshness--stale")

    expect(stamp(harness).textContent).toMatch(/^As of \d\d:\d\d:\d\d · 2m ago$/)
  })

  it("keeps the data while it reconnects and shows no spinner", async () => {
    harness = mountApp()
    const retryAt = new Date()
    retryAt.setHours(12, 41, 10, 0)
    harness.publish(live({ status: "reconnecting", retryAt: retryAt.toISOString() }))
    await vi.waitFor(() => {
      expect(stamp(harness).textContent).toMatch(/^Reconnecting… · data from /)
    })

    expect(stamp(harness).title).toContain("Pulse tries again at 12:41:10.")
    expect(harness.root.querySelector(".spin")).toBeNull()
  })

  it("offers to turn live updates on for production engines", async () => {
    harness = mountApp()
    harness.publish(live({ status: "off", environment: "production", everySeconds: 30 }))
    const button = await waitForElement<HTMLButtonElement>(harness.root, ".live-button")

    expect(button.getAttribute("aria-label")).toBe("Turn on live updates for production engines")
    expect(stamp(harness).title).toContain("user settings (pulse.liveUpdates)")
    expect(stamp(harness).title).toContain("every 30 s while this tab is visible")
    button.click()
    expect(harness.posted).toContainEqual({ type: "turnOnLiveUpdates" })
  })

  it("offers nothing for an ended instance and says why updates stopped", async () => {
    harness = mountApp()
    harness.publish(live({ status: "ended" }))
    await vi.waitFor(() => {
      expect(stamp(harness).title).toContain("no longer reads it")
    })
    expect(liveButton(harness)).toBeNull()

    harness.publish(live({ status: "stopped", reason: "refused" }))
    await vi.waitFor(() => {
      expect(stamp(harness).textContent).toMatch(/^Stopped · data from /)
    })
    expect(stamp(harness).title).toContain("Set the credentials or reconnect")
    expect(liveButton(harness)).toBeNull()
  })

  it("keeps one editor hold while a panel with a back link updates", async () => {
    harness = mountApp()
    const withBack = (state: PanelState) => {
      window.postMessage(
        { type: "state", revision: Date.now(), state, back: { label: "Order fulfillment" } },
        "*",
      )
    }
    withBack(FIXTURES["instance-writable"])
    await waitForElement(harness.root, ".incident-card")
    buttonNamed(harness.root, "Variables8").click()
    ;(await waitForElement<HTMLButtonElement>(harness.root, ".value-cell__edit")).click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    withBack(FIXTURES["instance-writable"])
    withBack(FIXTURES["instance-writable"])
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(harness.posted.filter((intent) => intent.type === "holdLiveUpdates")).toEqual([
      { type: "holdLiveUpdates", held: true },
    ])
  })

  it("keeps the spinner for a refresh the user asked for", async () => {
    harness = mountApp()
    harness.publish(live({ status: "live", everySeconds: 10 }, 1000, true))
    await vi.waitFor(() => {
      expect(stamp(harness).textContent).toBe("Refreshing…")
    })
    expect(stamp(harness).getAttribute("role")).toBe("status")
  })
})

describe("activity inside a panel", () => {
  it("tells the host at most every 30 seconds that someone works in it", async () => {
    const sent: unknown[] = []
    const bridge = new HostBridge({
      postMessage: (message) => sent.push(message),
      getState: () => undefined,
      setState: () => undefined,
    })
    const root = document.createElement("div")
    document.body.append(root)
    render(<App bridge={bridge} />, root)
    await new Promise((resolve) => setTimeout(resolve, 50))

    document.dispatchEvent(new PointerEvent("pointerdown"))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))

    expect(sent).toEqual([{ type: "activity" }])
    render(null, root)
    bridge.dispose()
    root.remove()
  })
})

describe("focus in a table that updates on its own", () => {
  let harness: Harness
  const READY = FIXTURES.definition as PanelState & {
    readonly status: "ready"
    readonly view: DefinitionView
  }
  const rows = () => [
    ...harness.root.querySelectorAll<HTMLTableRowElement>(".data-table__row--interactive"),
  ]

  afterEach(() => {
    harness.unmount()
  })

  it("moves to the neighbour when the focused row leaves", async () => {
    harness = mountApp()
    harness.publish(READY)
    await waitForElement(harness.root, ".data-table__row--interactive")
    rows()[2]?.focus()
    const removed = READY.view.instances[2]?.id

    harness.publish({
      ...READY,
      view: { ...READY.view, instances: READY.view.instances.filter((row) => row.id !== removed) },
    })

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(rows()[2])
    })
  })

  it("does not pull focus back after the user left the table", async () => {
    harness = mountApp()
    harness.publish(READY)
    await waitForElement(harness.root, ".data-table__row--interactive")
    rows()[1]?.focus()
    const search = harness.root.querySelector<HTMLInputElement>(".search-field input")
    search?.focus()

    harness.publish({
      ...READY,
      view: { ...READY.view, instances: READY.view.instances.slice(2) },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(document.activeElement).toBe(search)
  })
})
