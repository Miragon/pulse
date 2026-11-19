// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  TestViewHost,
  createTestQueryClient,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_BOARD_DATA, ENGINE_BPMN_XML_DATA } from "../../tool-names.js"
import type { BoardStartData } from "../../view-models.board.js"
import { NavProvider, type NavIntent } from "../navigation.js"
import { BOARD, RUNNING_INSTANCE } from "./board.test-support.js"
import { BoardView } from "./board-view.js"

afterEach(cleanup)

/** The view on `data` as the board feed gives it, in `locale`, with its navigation and host calls. */
function renderBoard({
  locale = "en",
  data = BOARD,
  seed = data,
  feed = () => data,
}: {
  locale?: string
  data?: BoardStartData
  seed?: BoardStartData | null
  feed?: (args: Record<string, unknown>) => unknown
} = {}) {
  const intents: NavIntent[] = []
  const actions: HostAction[] = []
  const contexts: string[] = []
  render(
    <TestViewHost
      locale={locale}
      host={{ timeZone: "UTC" }}
      client={createTestQueryClient()}
      onHostAction={(action) => actions.push(action)}
      onModelContext={(text) => contexts.push(text)}
      tools={{
        [ENGINE_BOARD_DATA]: feed,
        // No diagram here: bpmn-js draws in a browser (test:host), the tile still says its facts.
        [ENGINE_BPMN_XML_DATA]: (args: Record<string, unknown>) => ({
          processDefinitionId: args.processDefinitionId,
          bpmnXml: null,
        }),
      }}
    >
      <NavProvider value={(intent) => intents.push(intent)}>
        <BoardView board="invoices" data={seed} />
      </NavProvider>
    </TestViewHost>,
  )
  return { intents, actions, contexts }
}

const feedCalls = (actions: HostAction[]) =>
  actions.filter((action) => action.type === "callTool" && action.name === ENGINE_BOARD_DATA)

describe("the cockpit's board view", () => {
  it("names the board in its bar, its engines, and the time its numbers were read", () => {
    renderBoard()
    expect(screen.getByRole("heading", { level: 1, name: "Invoices" })).toBeTruthy()
    expect(screen.getByText("3 engines: prod-a, down, nowhere")).toBeTruthy()
    // Another day's reading names its day.
    expect(screen.getByText("As of Oct 26, 8:00 AM")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy()
  })

  it("renders every tile of the board, a widget the file breaks in its place", () => {
    renderBoard()
    const kinds = [...document.querySelectorAll("[data-part=board-card]")].map((card) =>
      card.getAttribute("data-kind"),
    )
    expect(kinds).toEqual([
      "counter",
      "incidentSummary",
      "instanceList",
      "incidentList",
      "processDiagram",
      "refused",
    ])
    expect(screen.getByRole("region", { name: "Waiting for approval" })).toBeTruthy()
  })

  it("keeps the numbers neutral: an alarming count shows its tone by an icon and words", () => {
    renderBoard()
    for (const figure of document.querySelectorAll("[data-part=counter-value]")) {
      expect(figure.className).not.toMatch(/text-(danger|warning|success|info)/)
    }
  })

  it("says each engine that was not read in its place: failed by describeError, not configured", () => {
    renderBoard()
    expect(screen.getByText("Engine down is unreachable (HTTP 503)")).toBeTruthy()
    // A board has no other engine to pick: it reads those its file names.
    expect(
      screen.getByText(
        "Check that the engine is running. Until then, the tiles show what the other engines answered.",
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/pick another engine/)).toBeNull()
    expect(screen.getByText("nowhere is not among the engines of this server.")).toBeTruthy()
    expect(screen.getByText("1 note on this board.")).toBeTruthy()
  })

  it("words a refused profile as such, and a failure that names no engine's state as not read", () => {
    const refused =
      '[ENGINE_PROFILE_REFUSED] Engine "c8" is configured, but its profile cannot be used: ' +
      "This server does not speak the API of this flavor. Ask whoever runs this server to fix it."
    renderBoard({
      data: {
        ...BOARD,
        engines: [
          {
            name: "c8",
            state: "failed",
            failure: { code: "ENGINE_PROFILE_REFUSED", message: refused },
          },
          {
            name: "odd",
            state: "failed",
            failure: {
              code: "misconfigured",
              message: "[404 InvalidRequestException] no such path",
            },
          },
        ],
      },
    })
    expect(screen.getByText("Engine c8 cannot be used: its profile is refused")).toBeTruthy()
    expect(
      screen.getByText(/can fix the profile\. Until then, the tiles show what the other engines/),
    ).toBeTruthy()
    expect(screen.queryByText(/pick another engine/)).toBeNull()
    expect(screen.getByText("Can't read odd")).toBeTruthy()
    expect(screen.queryByText(/no longer exists/)).toBeNull()
  })

  it("opens a row's instance on the cockpit's own routes on a click or Enter, no drill in it", () => {
    const { intents } = renderBoard()
    const instances = screen.getByRole("region", { name: "Instances" })
    expect(within(instances).queryAllByRole("button", { name: /^Open/ })).toEqual([])
    expect(within(instances).queryByRole("columnheader", { name: "Actions" })).toBeNull()
    const row = within(instances).getAllByRole("row", { name: /^Instance / })[0]
    fireEvent.click(row.querySelector("td")!)
    fireEvent.keyDown(row, { key: "Enter" })
    const opened = {
      type: "board-target",
      engine: "prod-a",
      view: { section: "instance-detail", processInstanceId: RUNNING_INSTANCE, label: "INV-0042" },
    }
    expect(intents).toEqual([opened, opened])
  })

  it("opens a ready engine's overview from its chip", () => {
    const { intents } = renderBoard()
    const engines = screen.getByRole("group", { name: "Engines of this board" })
    const chip = within(engines).getByRole("button", { name: /prod-a/ })
    // The product with its version, as the webview's chip names it.
    expect(chip.textContent).toContain("CIB seven 2.1.0 · 12 running · 2 with incident")
    fireEvent.click(chip)
    expect(intents).toEqual([
      { type: "board-target", engine: "prod-a", view: { section: "overview" } },
    ])
  })

  it("reads the board again on Refresh", async () => {
    const { actions } = renderBoard()
    const before = feedCalls(actions).length
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(feedCalls(actions).length).toBeGreaterThan(before))
  })

  it("reads the board feed by its id when it has no seed", async () => {
    const { actions } = renderBoard({ seed: null })
    await screen.findByRole("heading", { level: 1, name: "Invoices" })
    expect(feedCalls(actions)[0]).toMatchObject({ args: { board: "invoices" } })
  })

  it("tells the model the board's ids and facts, its title fenced as the operator's text", () => {
    const { contexts } = renderBoard()
    const text = contexts.at(-1) ?? ""
    expect(text).toContain("invoices")
    expect(text).toContain("prod-a")
    expect(text).toContain("Invoices")
  })

  // The builder notes a diagram longer than it reads: no badge goes missing without a word. The
  // strip holds the file's notes and the board's, and names the tile as its card does.
  it.each([
    [
      "en",
      "2 notes on this board.",
      '"Invoice receipt" on prod-a may show no count on a collapsed subprocess for what runs inside it, because the diagram is longer than Pulse reads',
    ],
    [
      "de",
      "2 Hinweise zu diesem Board.",
      "„Invoice receipt“ auf prod-a zeigt an einem zugeklappten Teilprozess womöglich keine Zahl für das, was darin läuft, weil das Diagramm länger ist, als Pulse liest",
    ],
  ])(
    "says in %s where a diagram was too long to roll up, among the notes, by the tile's title",
    (locale, title, line) => {
      const tooLong = {
        path: "rows[2].row[0]",
        code: "diagramTooLong",
        values: { title: "Invoice receipt", engine: "prod-a" },
      } as const
      renderBoard({ locale, data: { ...BOARD, notes: [...BOARD.notes, tooLong] } })
      const strip = screen.getByText(title).closest("[data-slot='status-strip']") ?? document.body
      expect(strip.textContent).toContain(line)
      expect(strip.textContent).not.toContain("rows[2].row[0]")
      // The file's own note keeps its JSON path, which its author edits.
      expect(strip.textContent).toContain("$schema ")
      const diagram = document.querySelector("[data-part=board-card][data-kind=processDiagram]")
      expect(diagram?.textContent).toContain("Invoice receipt")
    },
  )

  it("words its chrome and the tiles in German under a German host", () => {
    renderBoard({ locale: "de" })
    expect(screen.getByText(/^Stand 26\. Okt\.?,? 08:00$/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeTruthy()
    expect(screen.getByText("3 Engines: prod-a, down, nowhere")).toBeTruthy()
    expect(screen.getByText("nowhere gehört nicht zu den Engines dieses Servers.")).toBeTruthy()
    expect(
      screen.getByText(
        "Prüf, ob die Engine läuft. Bis dahin zeigen die Kacheln, was die anderen Engines geantwortet haben.",
      ),
    ).toBeTruthy()
    expect(screen.getByRole("region", { name: "Instanzen mit Incident" })).toBeTruthy()
    const row = screen.getAllByRole("row", { name: /^Instanz [^ ]+$/ })[0]
    const hint = document.getElementById(row.getAttribute("aria-describedby") ?? "")
    expect(hint?.textContent).toBe("Enter öffnet die Zeile, Strg oder Cmd+C kopiert ihre ID.")
  })

  it.each([
    [
      "en",
      "Incidents",
      "Enter opens the row, Ctrl or Cmd+C copies its incident message.",
      "Incident message copied",
    ],
    [
      "de",
      "Incidents",
      "Enter öffnet die Zeile, Strg oder Cmd+C kopiert ihre Incident-Meldung.",
      "Incident-Meldung kopiert",
    ],
  ])(
    "says in %s that an incident row copies its message, and its toast names it",
    async (locale, table, hintText, toast) => {
      const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
      renderBoard({ locale })
      const [row] = within(screen.getByRole("table", { name: table })).getAllByRole("row", {
        name: /^Instan/,
      })
      const hint = document.getElementById(row.getAttribute("aria-describedby") ?? "")
      expect(hint?.textContent).toBe(hintText)
      fireEvent.keyDown(row, { key: "c", ctrlKey: true })
      expect(await screen.findByText(toast)).toBeTruthy()
      expect(writeText).toHaveBeenCalledWith("Approver lookup failed")
    },
  )
})
