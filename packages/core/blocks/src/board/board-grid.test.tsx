// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, formatClock, setFormatLocale } from "@miragon/pulse-ui"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { BoardGrid } from "./board-grid.js"
import type { BoardSlots } from "./slots.js"
import { testSlots } from "./slots.test-support.js"
import { ROWS } from "./tiles.test-support.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

function renderBoard(slots: BoardSlots, locale = "en") {
  return render(
    <LocaleProvider locale={locale}>
      <BoardGrid rows={ROWS} slots={slots} />
    </LocaleProvider>,
  )
}

function card(root: HTMLElement, name: string): HTMLElement {
  return within(root).getByRole("region", { name })
}

function texts(root: HTMLElement, part: string): string[] {
  return [...root.querySelectorAll(`[data-part="${part}"]`)].map((node) => node.textContent)
}

describe("the board's tiles in English", () => {
  it("lay out the rows and name every tile by its title, its filter or its kind", () => {
    const { container } = renderBoard(testSlots().slots)
    const headings = within(container).getAllByRole("heading", { level: 2 })

    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Waiting for payment",
      "Instances with incident",
      'Widget "chart"',
      "Orders",
      "Open incidents of order",
      "Order fulfillment",
    ])
    expect(container.firstElementChild?.children).toHaveLength(2)
  })

  it("count per engine, warn above the threshold and open the process with the counter's filter", () => {
    const { slots, asked } = testSlots({ opensToSide: true })
    const counter = card(renderBoard(slots).container, "Waiting for payment")

    expect(texts(counter, "counter-value")).toEqual(["12"])
    expect(texts(counter, "counter-partial")).toEqual(["from 2 of 3 engines"])
    expect(texts(counter, "counter-threshold")).toEqual(["local above 5"])
    expect(texts(counter, "counter-entry")).toEqual(["local10", "test2", "prodnot read"])
    const buttons = within(counter).getAllByRole("button")
    expect(buttons.map((button) => button.title)).toEqual([
      "Open the process on local, latest version first (Ctrl/Cmd+click: to the side)",
      "Open the process on test, latest version first (Ctrl/Cmd+click: to the side)",
    ])
    fireEvent.click(buttons[1]!, { metaKey: true })
    expect(asked.opened).toEqual([
      {
        target: {
          kind: "instances",
          engine: "test",
          bpmnProcessId: "order",
          filter: { scope: "running", elementId: "Task_Pay", businessKey: "B-1" },
        },
        how: { toSide: true },
      },
    ])
  })

  it("sum the instances with incident per process and open a row's process", () => {
    const { slots, asked } = testSlots()
    const summary = card(renderBoard(slots).container, "Instances with incident")
    const list = within(summary).getByRole("list", { name: "Per process" })

    expect(texts(summary, "counter-value")).toEqual(["3"])
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Order fulfillmentlocal3with incident", "shipmenttestnot read"])
    const [open] = within(list).getAllByRole("button")
    expect(open?.title).toBe("Open the process on local, latest version first")
    fireEvent.click(open!)
    expect(asked.opened).toEqual([
      {
        target: {
          kind: "instances",
          engine: "local",
          bpmnProcessId: "order",
          filter: { scope: "withIncident" },
        },
        how: { toSide: false },
      },
    ])
  })

  it("show a refused widget's problems in its place and open the file", () => {
    const { slots, asked } = testSlots()
    const refused = card(renderBoard(slots).container, 'Widget "chart"')

    expect(texts(refused, "refused-reason")).toEqual([
      "Pulse reads nothing for this widget until you fix it.",
    ])
    expect(within(refused).getByRole("list", { name: "Problems of this widget" }).textContent).toBe(
      "rows[0].row[1].widget must be one of counter, instanceList",
    )
    fireEvent.click(within(refused).getByRole("button", { name: "Open file" }))
    expect(asked.files).toBe(1)
  })

  it("offer no way to the file where the surface opens none", () => {
    const refused = card(
      renderBoard(testSlots({ withFile: false }).slots).container,
      'Widget "chart"',
    )

    expect(within(refused).queryByRole("button")).toBeNull()
  })

  it("list instances over the surface's table and open a row's instance", () => {
    const { slots, asked } = testSlots()
    const list = card(renderBoard(slots).container, "Orders")
    const table = within(list).getByRole("table", { name: "Instances" })

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((head) => head.textContent),
    ).toEqual([
      "Engine",
      "Business key",
      "Process",
      "Version",
      "State",
      "Started",
      "Ended",
      "Incident",
    ])
    const [first, second] = within(table).getAllByRole("row").slice(1)
    expect(
      within(first!)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "local",
      "id:81a2e0b4-3c1d-11ef-9a3e-0242ac120002",
      "Order fulfillment",
      "v3",
      "Running",
      formatClock("2026-10-26T08:00:00.000Z", { seconds: false }),
      "",
      "Incident",
      "",
    ])
    expect(within(second!).getAllByRole("cell")[1]?.textContent).toBe("B-7")
    expect(within(second!).getAllByRole("cell")[4]?.textContent).toBe("Cancelled")
    expect(texts(list, "group-note")).toEqual([
      "local: showing 2 of ≥\u00a010,000",
      "test: showing 0 of ?",
      "prod: not read",
    ])
    expect(first).toBe(within(list).getByRole("row", { name: "Instance 81a2e0b4…" }))
    fireEvent.click(first!)
    expect(asked.opened[0]?.target).toEqual({
      kind: "instance",
      engine: "local",
      instanceId: "81a2e0b4-3c1d-11ef-9a3e-0242ac120002",
    })
    expect(within(first!).getByRole("button", { name: "Copy Instance ID" }).dataset.copy).toBe(
      "81a2e0b4-3c1d-11ef-9a3e-0242ac120002",
    )
    // An id's copy: the surface's own words say so.
    expect(within(list).getByRole("table").dataset.copyHint).toBeUndefined()
  })

  it("list open incidents and open the instance of a row through its incident", () => {
    const { slots, asked } = testSlots()
    const list = card(renderBoard(slots).container, "Open incidents of order")
    const table = within(list).getByRole("table", { name: "Incidents" })

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((head) => head.textContent),
    ).toEqual(["Engine", "Process", "Element", "Message", "Since"])
    expect(texts(list, "group-note")).toEqual(["local: first 1, more open", "test: 0 open"])
    fireEvent.click(within(table).getByRole("row", { name: "Instance 4c1f0a2e…" }))
    expect(asked.opened[0]?.target).toEqual({
      kind: "instance",
      engine: "local",
      instanceId: "4c1f0a2e-3c1d-11ef-9a3e-0242ac120002",
      incidentId: "inc-1",
    })
    expect(within(table).getByRole("button", { name: "Copy Incident message" }).dataset.copy).toBe(
      "Carrier API answered 503",
    )
    // Its copy is no id, so its rows say what Ctrl or Cmd with C copies.
    expect(table.dataset.copyHint).toBe(
      "Enter opens the row, Ctrl or Cmd+C copies its incident message.",
    )
  })

  it("draw the diagram over the surface's and open the process at a counted element", () => {
    const { slots, asked } = testSlots({ opensToSide: true })
    const diagram = card(renderBoard(slots).container, "Order fulfillment")
    const figure = within(diagram).getByRole("figure", {
      name: "Diagram of Order fulfillment on local",
    })

    expect(diagram.textContent).toContain("local · v3, the latest version")
    expect(figure.dataset.definition).toBe("order:3")
    const open = within(diagram).getByRole("button", { name: "Open process" })
    expect(open.title).toBe("Open Order fulfillment on local (Ctrl/Cmd+click: to the side)")
    fireEvent.click(open)
    fireEvent.click(within(figure).getByRole("button", { name: "Task_Ship" }))
    fireEvent.click(within(figure).getByRole("button", { name: "canvas" }))
    const process = { kind: "instances", engine: "local", bpmnProcessId: "order" }
    expect(asked.opened).toEqual([
      { target: { ...process, filter: { scope: "running" } }, how: { toSide: false } },
      {
        target: { ...process, filter: { scope: "withIncident", elementId: "Task_Ship" } },
        how: { toSide: false },
      },
      {
        target: { ...process, filter: { scope: "running", elementId: "Task_Ship" } },
        how: { toSide: false },
      },
    ])
  })
})
