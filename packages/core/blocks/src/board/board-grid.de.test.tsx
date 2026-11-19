// @vitest-environment happy-dom
import { cleanup, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { BoardGrid } from "./board-grid.js"
import { testSlots } from "./slots.test-support.js"
import { ROWS } from "./tiles.test-support.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "de", locale: "de-DE", timeZone: "UTC" })
})

function renderBoard() {
  return render(
    <LocaleProvider locale="de-DE">
      <BoardGrid rows={ROWS} slots={testSlots({ opensToSide: true }).slots} />
    </LocaleProvider>,
  )
}

function texts(root: HTMLElement, part: string): string[] {
  return [...root.querySelectorAll(`[data-part="${part}"]`)].map((node) => node.textContent)
}

describe("the board's tiles in German", () => {
  it("name the tiles a file leaves untitled in German", () => {
    const { container } = renderBoard()

    expect(
      within(container)
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Waiting for payment",
      "Instanzen mit Incident",
      "Widget „chart“",
      "Orders",
      "Offene Incidents von order",
      "Order fulfillment",
    ])
  })

  it("word counts, thresholds and the way beside the view", () => {
    const counter = within(renderBoard().container).getByRole("region", {
      name: "Waiting for payment",
    })

    expect(texts(counter, "counter-partial")).toEqual(["aus 2 von 3 Engines"])
    expect(texts(counter, "counter-threshold")).toEqual(["local über 5"])
    expect(texts(counter, "counter-entry")).toEqual(["local10", "test2", "prodnicht gelesen"])
    expect(within(counter).getByRole("list", { name: "Je Engine" })).toBeTruthy()
    expect(within(counter).getAllByRole("button")[0]?.title).toBe(
      "Prozess auf local öffnen, neueste Version zuerst (Strg/Cmd+Klick: daneben)",
    )
  })

  it("word the lists, their states and notes, and a refused widget", () => {
    const { container } = renderBoard()
    const orders = within(container).getByRole("table", { name: "Instanzen" })

    expect(
      within(orders)
        .getAllByRole("columnheader")
        .map((head) => head.textContent),
    ).toEqual([
      "Engine",
      "Geschäftsschlüssel",
      "Prozess",
      "Version",
      "Status",
      "Gestartet",
      "Beendet",
      "Incident",
    ])
    expect(within(orders).getByText("Läuft")).toBeTruthy()
    expect(within(orders).getByText("Abgebrochen")).toBeTruthy()
    expect(texts(container, "group-note")).toEqual([
      "local: 2 von ≥ 10.000 angezeigt",
      "test: 0 von ? angezeigt",
      "prod: nicht gelesen",
      "local: die ersten 1, weitere offen",
      "test: 0 offen",
    ])
    expect(texts(container, "refused-reason")).toEqual([
      "Pulse liest für dieses Widget nichts, bis du es korrigierst.",
    ])
    expect(
      within(container).getByRole("list", { name: "Probleme dieses Widgets" }).textContent,
    ).toBe("rows[0].row[1].widget muss eins von counter, instanceList sein")
  })

  it("word the diagram's facts and its way into the process", () => {
    const diagram = within(renderBoard().container).getByRole("region", {
      name: "Order fulfillment",
    })

    expect(diagram.textContent).toContain("local · v3, die neueste Version")
    expect(
      within(diagram).getByRole("figure", { name: "Diagramm von Order fulfillment auf local" }),
    ).toBeTruthy()
    expect(within(diagram).getByRole("button", { name: "Prozess öffnen" }).title).toBe(
      "Order fulfillment auf local öffnen (Strg/Cmd+Klick: daneben)",
    )
  })
})
