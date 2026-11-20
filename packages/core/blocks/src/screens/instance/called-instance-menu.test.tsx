// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import type { CalledInstanceData } from "@miragon/pulse-screens"
import { afterEach, describe, expect, it } from "vitest"
import { CalledInstanceMenu } from "./called-instance-menu.js"
import { SURFACES, editorInstanceSlots } from "./instance-slots.test-support.js"

afterEach(cleanup)

const CALLED: readonly CalledInstanceData[] = [
  {
    id: "3e9d1c2b-7a6f-4e5d-8c4b-2a1f0e9d8c7b",
    bpmnProcessId: "credit-scoring",
    state: "running",
    withIncident: true,
  },
  {
    id: "b71d09c4-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    bpmnProcessId: "credit-scoring",
    state: "suspended",
    withIncident: false,
  },
  { id: "c-3", bpmnProcessId: "credit-scoring", state: "completed", withIncident: false },
  { id: "c-4", bpmnProcessId: "credit-scoring", state: "terminated", withIncident: false },
]

describe.each(SURFACES)("the menu of a call activity's instances with %s", (_surface, slotsOf) => {
  it("lists each called instance with its state, its incident and a link to it", () => {
    const { slots, asked } = slotsOf()
    const { container } = render(
      <CalledInstanceMenu
        engine="prod-a"
        elementName="Check credit"
        instances={CALLED}
        slots={slots}
      />,
    )
    const menu = within(container)
    const button = menu.getByRole("button", { name: "4 called instances at Check credit" })
    const items = [...container.querySelectorAll("li")]

    fireEvent.click(menu.getByTitle("Open called instance c-3"))

    expect(button.textContent).toBe("4 called instances")
    expect(button.getAttribute("aria-label")?.startsWith(button.textContent)).toBe(true)
    expect(menu.getByRole("list", { name: "4 called instances at Check credit" })).toBeTruthy()
    expect(items.map((item) => item.textContent)).toEqual([
      "Runningcredit-scoring 3e9d1c2b…",
      "Suspendedcredit-scoring b71d09c4…",
      "Completedcredit-scoring c-3",
      "Cancelledcredit-scoring c-4",
    ])
    expect(menu.getAllByRole("img", { name: "Has an open incident" })).toHaveLength(1)
    expect(asked.opened).toEqual([
      { target: { kind: "instance", engine: "prod-a", instanceId: "c-3" }, toSide: false },
    ])
  })
})

describe("the menu of a call activity's instances", () => {
  it("places each menu's popover at its own button, two menus on one page apart", () => {
    const { slots } = editorInstanceSlots()
    const { container } = render(
      <>
        <CalledInstanceMenu
          engine="prod-a"
          elementName="Check credit"
          instances={CALLED}
          slots={slots}
        />
        <CalledInstanceMenu
          engine="prod-a"
          elementName="Ship order"
          instances={CALLED.slice(2)}
          slots={slots}
        />
      </>,
    )
    const menus = [...container.querySelectorAll<HTMLElement>('[data-part="called-instance-menu"]')]
    const anchors = menus.map((menu) => {
      const button = menu.querySelector<HTMLElement>("button[popovertarget]")
      const popover = menu.querySelector<HTMLElement>("[popover]")
      expect(popover?.id).toBe(button?.getAttribute("popovertarget"))
      expect(popover?.style.positionAnchor).toBe(button?.style.anchorName)
      return button?.style.anchorName ?? ""
    })

    expect(anchors).toHaveLength(2)
    expect(anchors.every((anchor) => /^--[\w-]+$/.test(anchor))).toBe(true)
    expect(new Set(anchors).size).toBe(2)
  })

  it("speaks German under a German locale", () => {
    const { container } = render(
      <LocaleProvider locale="de">
        <CalledInstanceMenu
          engine="prod-a"
          elementName="Check credit"
          instances={CALLED.slice(0, 1)}
          slots={editorInstanceSlots().slots}
        />
      </LocaleProvider>,
    )

    expect(
      within(container).getByRole("button", { name: "1 aufgerufene Instanz an Check credit" })
        .textContent,
    ).toBe("1 aufgerufene Instanz")
    expect(container.querySelector("li")?.textContent).toBe("Läuftcredit-scoring 3e9d1c2b…")
  })
})
