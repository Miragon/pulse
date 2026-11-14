import { afterEach, describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import type { InstanceView } from "../../src/core/protocol/index.js"
import { MoveEntry } from "../../src/webview/diagram/move-entry.js"
import {
  GATEWAY_CLI_COMMAND as COMMAND,
  GATEWAY_INSTANCE,
  GATEWAY_REFUSAL as REFUSAL,
} from "../../dev/webview/fixtures/writable.js"
import {
  allParts,
  buttonNamed,
  findPart,
  mount,
  mountApp,
  nextFrame,
  part,
  queryPart,
  queryRole,
  waitForElement,
  type Harness,
} from "./harness.js"

const EVENT = "Event_PaymentReceived"

const WITHOUT_COMMAND: InstanceView = {
  ...GATEWAY_INSTANCE,
  waitStates: GATEWAY_INSTANCE.waitStates.map((row) =>
    row.elementId === EVENT
      ? {
          elementId: EVENT,
          elementName: "Payment received",
          kindLabel: "Message",
          moveRefusal: "Open the called instance to move this token.",
        }
      : row,
  ),
}

describe("the CLI command of a token that cannot move", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  async function open(view: InstanceView = GATEWAY_INSTANCE): Promise<void> {
    await page.viewport(1300, 900)
    harness = mountApp()
    harness.publish({ status: "ready", view, refreshing: false })
    await waitForElement(harness.root, `g.djs-element[data-element-id="${EVENT}"]`)
  }

  async function selectToken(): Promise<HTMLElement> {
    harness.root
      .querySelector(`g.djs-element[data-element-id="${EVENT}"] .djs-hit`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    return findPart(harness.root, "move-entry", { state: "refused" })
  }

  function copyControl(): HTMLButtonElement | null {
    const actions = queryPart(harness.root, "element-actions")
    return actions && queryRole<HTMLButtonElement>(actions, "button", { name: /CLI command$/ })
  }

  function copied() {
    return harness.posted.filter((intent) => intent.type === "copy")
  }

  it("offers to copy the command beside the can't-move sign and names what it copies", async () => {
    await open()

    const sign = await selectToken()
    const copy = page.getByRole("button", { name: "Copy CLI command" })

    expect(copy.element()).toBe(copyControl())
    expect(copy.element().closest(part("element-actions"))).toBe(
      sign.closest(part("element-actions")),
    )
    expect(copy.element().getAttribute("title")).toBe("Copy CLI command")
    await expect.element(copy).toHaveAccessibleDescription(`Can't move: ${REFUSAL}`)
    expect(sign.getAttribute("aria-label")).toBe(`Can't move: ${REFUSAL}`)
  })

  it("copies exactly the command, through the host, says so and offers it again", async () => {
    await open()
    await selectToken()

    await userEvent.click(page.getByRole("button", { name: "Copy CLI command" }))

    expect(copied()).toEqual([{ type: "copy", text: COMMAND, label: "CLI command" }])
    await vi.waitFor(() => {
      expect(copyControl()?.getAttribute("aria-label")).toBe("Copied CLI command")
    })
    expect(
      queryPart(harness.root, "element-actions")?.querySelector("[aria-live]")?.textContent,
    ).toBe("Copied")
    await vi.waitFor(
      () => {
        expect(copyControl()?.getAttribute("aria-label")).toBe("Copy CLI command")
      },
      { timeout: 3000 },
    )
  })

  it("shows no copy control where the refusal names no command", async () => {
    await open(WITHOUT_COMMAND)

    await selectToken()
    await nextFrame()

    expect(copyControl()).toBeNull()
    expect(allParts(queryPart(harness.root, "element-actions")!, "move-entry")).toHaveLength(1)
  })

  it("reaches the copy from the keyboard through the Waiting tab and copies with Enter", async () => {
    await open()
    buttonNamed(harness.root, "Payment received").click()

    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Copy CLI command")
    })
    await userEvent.keyboard("{Enter}")

    expect(copied()).toEqual([{ type: "copy", text: COMMAND, label: "CLI command" }])
  })
})

describe("the can't-move sign a copy control names as its description", () => {
  it("is the sign of its own entry, also with two entries in roots of their own", () => {
    const anchors = ["Event_First", "Event_Second"].map((elementId) =>
      mount(
        <MoveEntry
          entry={{
            elementId,
            refusal: `${elementId} waits behind a gateway.`,
            cliCommand: { text: `pulse advance i --activity-id ${elementId}`, onCopy: vi.fn() },
            onStart: vi.fn(),
          }}
        />,
      ),
    )
    try {
      for (const { root: anchor } of anchors) {
        const described = anchor.querySelector("button")?.getAttribute("aria-describedby") ?? ""
        expect(document.getElementById(described)).toBe(
          queryPart(anchor, "move-entry", { state: "refused" }),
        )
      }
    } finally {
      for (const anchor of anchors) {
        anchor.unmount()
      }
    }
  })
})
