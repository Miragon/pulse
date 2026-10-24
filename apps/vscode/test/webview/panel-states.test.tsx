import { afterEach, describe, expect, it, vi } from "vitest"
import type { WebviewIntent } from "../../src/core/protocol/index.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { HostBridge } from "../../src/webview/host/host-bridge.js"
import { buttonNamed, fakeApi, mountApp, postState, waitForElement } from "./harness.js"
import type { Harness } from "./harness.js"

describe("host bridge", () => {
  it("ignores a state whose revision is older than the one shown", async () => {
    const bridge = new HostBridge(fakeApi([]))
    const seen: string[] = []
    bridge.subscribe((state) => seen.push(state.status))

    postState(FIXTURES.definition, 5)
    postState(FIXTURES["failed-empty"], 3)
    postState(FIXTURES.loading, 5)
    await vi.waitFor(() => {
      expect(seen).toEqual(["ready"])
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(seen).toEqual(["ready"])
    expect(bridge.current()?.status).toBe("ready")
    bridge.dispose()
  })

  it("hands a late subscriber the state that already arrived", async () => {
    const bridge = new HostBridge(fakeApi([]))
    postState(FIXTURES.loading, 1)
    await vi.waitFor(() => {
      expect(bridge.current()?.status).toBe("loading")
    })

    const seen: string[] = []
    bridge.subscribe((state) => seen.push(state.status))

    expect(seen).toEqual(["loading"])
    bridge.dispose()
  })
})

describe("panel states", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("offers Reconnect when loading failed and posts refresh", async () => {
    harness = mountApp()
    harness.publish(FIXTURES["failed-empty"])
    await waitForElement(harness.root, ".status-box--danger")

    buttonNamed(harness.root, "Reconnect").click()
    buttonNamed(harness.root, "Edit connection…").click()

    expect(harness.posted).toContainEqual({ type: "refresh" })
    expect(harness.posted).toContainEqual({ type: "editConnection" })
  })

  it("keeps the stale view with stale badges when a refresh failed", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.failed)

    await waitForElement(harness.root, ".count-badge--stale")

    expect(harness.root.querySelector(".status-strip--danger")?.textContent).toContain(
      "Couldn't reach prod-eu.",
    )
    expect(harness.root.querySelector(".freshness--offline")).not.toBeNull()
    expect(harness.root.querySelector(".context-bar")?.textContent).not.toContain("PROD")
  })

  it("shows the skeleton only after the loading delay", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.loading)
    await waitForElement(harness.root, ".loading-layout")

    expect(harness.root.querySelector(".skeleton-bar")).toBeNull()
    await waitForElement(harness.root, ".skeleton-bar")
  })
})

describe("instance screen", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  function postedOfType(type: WebviewIntent["type"]) {
    return harness.posted.filter((intent) => intent.type === type)
  }

  it("keeps state and incident out of the header and names when it started, to the millisecond", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    const bar = await waitForElement(harness.root, ".context-bar")

    expect(bar.querySelector(".state-label, .incident-flag")).toBeNull()
    expect(bar.textContent).toMatch(/Started (\w{3} \d{1,2}, )?\d{2}:\d{2}:\d{2}\.\d{3}/)
  })

  it("opens the stacktrace of a single incident from its card, without a strip", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    const card = await waitForElement(harness.root, ".incident-card")

    buttonNamed(card, "Open stacktrace").click()

    expect(harness.root.querySelector(".strip-stack .status-strip")).toBeNull()

    expect(postedOfType("openIncidentDetails")).toEqual([
      { type: "openIncidentDetails", incidentId: "a4b5c6d7-e8f9-4a0b-9c1d-2e3f4a5b6c7d" },
    ])
  })

  it("links a wait state in a called instance to that instance", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    await waitForElement(harness.root, ".incident-card")

    buttonNamed(harness.root, "Waiting1").click()
    const link = await waitForElement<HTMLButtonElement>(
      harness.root,
      "#tabpanel-waiting .link-button",
    )
    link.click()

    expect(postedOfType("openInstance")).toEqual([
      { type: "openInstance", instanceId: "3e9d1c2b-7a6f-4e5d-8c4b-2a1f0e9d8c7b", toSide: false },
    ])
  })

  it("opens the definition of the instance from its header", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    await waitForElement(harness.root, ".context-bar .link-button")

    buttonNamed(harness.root, "Order fulfillment v7").click()

    expect(postedOfType("openDefinition")).toEqual([
      {
        type: "openDefinition",
        bpmnProcessId: "order-fulfillment",
        definitionId: "order-fulfillment:7:4a1c",
      },
    ])
  })

  it("copies the instance ID through the host", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    const copy = await waitForElement<HTMLButtonElement>(
      harness.root,
      ".context-bar .id-text__copy",
    )

    copy.click()

    expect(postedOfType("copy")).toEqual([
      { type: "copy", text: "8f3c2a1e-4b7d-4c1a-9f0e-1d2c3b4a5e6f", label: "instance ID" },
    ])
  })
})
