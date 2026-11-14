import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { INSTANCE_WITH_CALLED_INCIDENT } from "../../dev/webview/fixtures/instance.js"
import { allRoles, findPart, getRole, mountApp, queryPart, type Harness } from "./harness.js"

const COCKPIT = {
  label: "Open in Cockpit",
  title: "Open ORD-10442 in Cockpit on local-operaton",
}

function actionsOf(bar: HTMLElement | undefined): HTMLElement | null {
  return bar?.querySelector<HTMLElement>('[data-slot="view-bar-actions"]') ?? null
}

function webUiButton(root: HTMLElement): HTMLButtonElement | undefined {
  const bar = queryPart(root, "context-bar")
  return allRoles<HTMLButtonElement>(bar ?? root, "button").find(
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
    await findPart(harness.root, "context-bar")
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
    const definitionBar = actionsOf(await findPart(harness.root, "context-bar"))
    const labels = allRoles<HTMLButtonElement>(definitionBar!, "button").map(
      (button) => button.title,
    )

    expect(labels.slice(-2)).toEqual(["Open order-fulfillment.bpmn", "Open Order fulfillment v7"])

    harness.publish({
      status: "ready",
      refreshing: false,
      view: { ...INSTANCE_WITH_CALLED_INCIDENT, webUi: COCKPIT },
    })
    const instanceBar = await findPart(harness.root, "context-bar", { kind: "instance" })

    expect(actionsOf(instanceBar)?.lastElementChild).toBe(webUiButton(harness.root))
  })

  it("follows the version picker in the definition header and is absent without a web UI", async () => {
    harness = mountApp()
    harness.publish({
      status: "ready",
      refreshing: false,
      view: { ...DEFINITION_VIEW, webUi: { ...COCKPIT, title: "Open Order fulfillment v7" } },
    })
    const bar = await findPart(harness.root, "context-bar")
    const picker = getRole(bar, "combobox", { name: "Version" }).closest("label")

    expect(picker?.nextElementSibling).toBe(webUiButton(harness.root))
    expect(queryPart(bar, "context-key")).toBeNull()
    expect(bar.textContent).not.toContain(DEFINITION_VIEW.bpmnProcessId)

    harness.publish({ status: "ready", refreshing: false, view: DEFINITION_VIEW })

    await vi.waitFor(() => {
      expect(webUiButton(harness.root)).toBeUndefined()
    })
  })
})
