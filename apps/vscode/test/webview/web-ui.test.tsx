import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { INSTANCE_WITH_CALLED_INCIDENT } from "../../dev/webview/fixtures/instance.js"
import { mountApp, waitForElement } from "./harness.js"
import type { Harness } from "./harness.js"

const COCKPIT = {
  label: "Open in Cockpit",
  title: "Open ORD-10442 in Cockpit on local-operaton",
}

function webUiButton(root: HTMLElement): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>(".context-bar button")].find(
    (button) => button.textContent === "Open in Cockpit",
  )
}

describe("the link into the engine web UI", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("asks the host to open the shown instance, without a URL", async () => {
    harness = mountApp()
    harness.publish({
      status: "ready",
      refreshing: false,
      view: { ...INSTANCE_WITH_CALLED_INCIDENT, webUi: COCKPIT },
    })
    await waitForElement(harness.root, ".context-bar")
    const button = webUiButton(harness.root)

    button?.click()

    expect(button?.title).toBe("Open ORD-10442 in Cockpit on local-operaton")
    expect(button?.querySelector("svg")).not.toBeNull()
    expect(harness.posted).toContainEqual({ type: "openWebUi" })
  })

  it("comes last in the definition and the instance header, after the actions inside VS Code", async () => {
    harness = mountApp()
    harness.publish({
      status: "ready",
      refreshing: false,
      view: {
        ...DEFINITION_VIEW,
        model: { fileName: "order-fulfillment.bpmn" },
        webUi: { ...COCKPIT, title: "Open Order fulfillment v7" },
      },
    })
    const definitionBar = await waitForElement(harness.root, ".context-bar__subject")
    const labels = [...definitionBar.querySelectorAll("button")].map((button) => button.title)

    expect(labels.slice(-2)).toEqual(["Open order-fulfillment.bpmn", "Open Order fulfillment v7"])

    harness.publish({
      status: "ready",
      refreshing: false,
      view: { ...INSTANCE_WITH_CALLED_INCIDENT, webUi: COCKPIT },
    })
    const instanceBar = await waitForElement(harness.root, ".context-bar--instance")

    expect(instanceBar.querySelector(".context-bar__subject")?.lastElementChild).toBe(
      webUiButton(harness.root),
    )
  })

  it("follows the version picker in the definition header and is absent without a web UI", async () => {
    harness = mountApp()
    harness.publish({
      status: "ready",
      refreshing: false,
      view: { ...DEFINITION_VIEW, webUi: { ...COCKPIT, title: "Open Order fulfillment v7" } },
    })
    const bar = await waitForElement(harness.root, ".context-bar")
    const picker = bar.querySelector(".version-picker")

    expect(picker?.nextElementSibling).toBe(webUiButton(harness.root))
    expect(bar.querySelector(".context-bar__key")).toBeNull()
    expect(bar.textContent).not.toContain(DEFINITION_VIEW.bpmnProcessId)

    harness.publish({ status: "ready", refreshing: false, view: DEFINITION_VIEW })

    await vi.waitFor(() => {
      expect(webUiButton(harness.root)).toBeUndefined()
    })
  })
})
