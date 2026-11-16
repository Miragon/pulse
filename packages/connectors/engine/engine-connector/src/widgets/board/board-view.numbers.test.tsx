// @vitest-environment happy-dom
/**
 * The same numbers on both surfaces, rendered: the board c7-core's recorded board engine expects,
 * the one the board feed gives over the server's wire (data/board-data.numbers.test.ts) and the
 * editors' C7 adapter builds over its own, through the blocks with the cockpit's slots, in English
 * and in German. Times are left out: they say the day only once it has passed.
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import type { BoardData } from "@miragon/pulse-board"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_BOARD_DATA, ENGINE_BPMN_XML_DATA } from "../../tool-names.js"
import type { BoardStartData } from "../../view-models.board.js"
import { NavProvider } from "../navigation.js"
import { BoardView } from "./board-view.js"

afterEach(cleanup)

const BOARD: BoardStartData = {
  ...(C7_BOARD_ENGINE.expected as BoardData),
  asOf: "2026-11-16T11:02:00.000Z",
}

/** The board's numbers and the words around them, in each locale of the host. */
const WORDS = {
  en: {
    engine: "Operaton BPM Runtime 2.1.5 · 5 running · 3 with incident",
    above: "conformance above 1",
    summary: [
      "Dispatch orderconformance1with incident",
      "Print labelconformance1with incident",
      "Order fulfillmentconformance1with incident",
    ],
    instances: ["ORD-2001 v2 Running", "ORD-1002 v1 Running Incident", "ORD-1001 v1 Running"],
    shown: "conformance: showing 3 of 3",
    open: "conformance: 2 open",
    latest: "conformance · v2, the latest version",
    refused:
      "rows[2].row[1].widget must be one of counter, instanceList, incidentSummary, processDiagram, incidentList",
  },
  de: {
    engine: "Operaton BPM Runtime 2.1.5 · 5 laufend · 3 mit Incident",
    above: "conformance über 1",
    summary: [
      "Dispatch orderconformance1mit Incident",
      "Print labelconformance1mit Incident",
      "Order fulfillmentconformance1mit Incident",
    ],
    instances: ["ORD-2001 v2 Läuft", "ORD-1002 v1 Läuft Incident", "ORD-1001 v1 Läuft"],
    shown: "conformance: 3 von 3 angezeigt",
    open: "conformance: 2 offen",
    latest: "conformance · v2, die neueste Version",
    refused:
      "rows[2].row[1].widget muss eins von counter, instanceList, incidentSummary, processDiagram, incidentList sein",
  },
} as const

function renderBoard(locale: keyof typeof WORDS) {
  render(
    <TestViewHost
      locale={locale}
      host={{ timeZone: "UTC" }}
      client={createTestQueryClient()}
      tools={{
        [ENGINE_BOARD_DATA]: () => BOARD,
        // No diagram here: bpmn-js draws in a browser (test:host), the tile still says its facts.
        [ENGINE_BPMN_XML_DATA]: (args: Record<string, unknown>) => ({
          processDefinitionId: args.processDefinitionId,
          bpmnXml: null,
        }),
      }}
    >
      <NavProvider value={() => undefined}>
        <BoardView board="orders" data={BOARD} />
      </NavProvider>
    </TestViewHost>,
  )
}

/** The tile named `title`: its card, not the table region inside it that may share its name. */
function tile(title: string): HTMLElement {
  const [card] = screen
    .getAllByRole("region", { name: title })
    .filter((region) => region.dataset.part === "board-card")
  if (card === undefined) throw new Error(`no tile ${title}`)
  return card
}

const parts = (root: HTMLElement, part: string) =>
  [...root.querySelectorAll(`[data-part="${part}"]`)].map((node) => node.textContent)

/** A table's rows, each cell's text but the time and the drill, joined by spaces. */
const rowTexts = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .slice(0, 4)
        .map((cell) => cell.textContent)
        .filter((text) => text !== "")
        .join(" "),
    )

describe.each(["en", "de"] as const)(
  "the recorded board's numbers in the cockpit (%s)",
  (locale) => {
    const words = WORDS[locale]

    it("shows the engine's totals and each counter's figure, a threshold passed in words", () => {
      renderBoard(locale)
      const engines = screen.getByRole("group", { name: /Engines/ })
      expect(within(engines).getByRole("button", { name: /conformance/ }).textContent).toContain(
        words.engine,
      )
      expect(parts(tile("Waiting for review"), "counter-value")).toEqual(["2"])
      expect(parts(tile("Waiting for review"), "counter-threshold")).toEqual([words.above])
      expect(parts(tile("With incident"), "counter-value")).toEqual(["1"])
      expect(parts(tile("Ended"), "counter-value")).toEqual(["1"])
    })

    it("counts the instances with incident per process", () => {
      renderBoard(locale)
      const summary = tile("With incident per process")
      expect(parts(summary, "counter-value")).toEqual(["3"])
      expect(
        within(summary)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(words.summary)
    })

    it("lists the running orders and the open incidents with what they leave out", () => {
      renderBoard(locale)
      const orders = tile("Running orders")
      expect(rowTexts(within(orders).getByRole("table"))).toEqual(words.instances)
      expect(parts(orders, "group-note")).toEqual([words.shown])
      const incidents = tile("Open incidents")
      expect(
        within(incidents)
          .getAllByRole("row")
          .slice(1)
          .map((row) => within(row).getAllByRole("cell")[1]?.textContent),
      ).toEqual(["Activity_RenderLabel", "Activity_ChargePayment"])
      expect(parts(incidents, "group-note")).toEqual([words.open])
    })

    it("says which version the diagram draws and why the file's chart shows nothing", () => {
      renderBoard(locale)
      expect(tile("Order fulfillment").textContent).toContain(words.latest)
      expect(tile("Throughput").textContent).toContain(words.refused)
    })
  },
)
