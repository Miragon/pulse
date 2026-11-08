// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { setFormatLocale } from "@miragon/pulse-ui"
import { complementaryFlags } from "@miragon/pulse-engine-core"
import { ENGINE_PROCESS_INSTANCES_DATA } from "../tool-names.js"
import type { ProcessInstancesData } from "../view-models.js"
import { ProcessInstancesView } from "./process-instances/list.js"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"

// #329: the feed maps a `false` run-state flag onto its complement, so every refetch must carry the
// SAME filter or later pages mix in rows page 0 excluded. The route's scope comes from its props.

afterEach(() => {
  cleanup()
})

type StateFlags = { active?: boolean; suspended?: boolean }

const runState = (args: StateFlags) => complementaryFlags(args, "active", "suspended")

function firstPage(flags: StateFlags): ProcessInstancesData {
  return {
    processDefinitionKey: "invoice",
    processDefinitionName: "Invoice",
    totalCount: 3,
    returnedCount: 2,
    allCount: 3,
    withIncidentCount: 0,
    suspendedCount: 0,
    instances: ["pi-1", "pi-2"].map((id) => ({
      id,
      businessKey: `BK-${id}`,
      processDefinitionKey: "invoice",
      processDefinitionName: null,
      version: 1,
      suspended: flags.suspended === true || flags.active === false,
      hasIncident: false,
    })),
    filters: { ...flags, withIncidents: undefined, businessKeyLike: undefined },
    engineId: "prod",
  }
}

/** The route on `invoice` and the fixtures' engine, seeded with page 0; the feed answers `pages`. */
function renderRoute(pages: (args: Record<string, unknown>) => ProcessInstancesData) {
  const calls: Array<Record<string, unknown>> = []
  const feed = (args: Record<string, unknown>) => {
    calls.push(args)
    return pages(args)
  }
  render(
    <TestViewHost tools={{ [ENGINE_PROCESS_INSTANCES_DATA]: feed }}>
      <ProcessInstancesView data={firstPage({})} processDefinitionKey="invoice" engine="prod" />
    </TestViewHost>,
  )
  return calls
}

describe("process-instances widget keeps page 0's run-state filter", () => {
  it("the Suspended chip sends its filter alone, and Load more keeps it", async () => {
    const suspended = firstPage({ suspended: true })
    const calls = renderRoute((args) =>
      args.firstResult ? { ...suspended, instances: [], returnedCount: 0 } : suspended,
    )
    fireEvent.click(await screen.findByText("Suspended"))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(runState(calls[0])).toEqual({ suspended: true })
    fireEvent.click(await screen.findByText("Load more"))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toMatchObject({ processDefinitionKey: "invoice", engine: "prod" })
    expect(calls[1].firstResult).toBe(2)
    expect(runState(calls[1])).toEqual({ suspended: true })
  })

  it("Load more on the seed pages the route's process and engine", async () => {
    const calls = renderRoute(() => ({ ...firstPage({}), instances: [], returnedCount: 0 }))
    fireEvent.click(await screen.findByText("Load more"))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ processDefinitionKey: "invoice", engine: "prod" })
    expect(calls[0].firstResult).toBe(2)
    expect(runState(calls[0])).toEqual({})
  })
})

// #396: inline the version moves to the quiet line and State hides below 48rem, so a suspended row
// says so in its first cell, never by the dot's colour alone.
describe("the engine-wide list's columns", () => {
  function engineWide(): ProcessInstancesData {
    const page = firstPage({})
    return {
      ...page,
      processDefinitionKey: null,
      processDefinitionName: null,
      instances: [
        { ...page.instances[0], processDefinitionName: "Invoice receipt", version: 7 },
        { ...page.instances[1], processDefinitionName: "Invoice receipt", suspended: true },
      ],
    }
  }
  const headers = () => screen.getAllByRole("columnheader").map((th) => th.textContent)

  it("names the version on the process line instead of a column of its own", () => {
    render(
      <TestViewHost>
        <ProcessInstancesView data={engineWide()} engine="prod" />
      </TestViewHost>,
    )
    expect(headers()).not.toContain("Version")
    expect(headers()).toContain("Process")
    const process = screen.getAllByText("Invoice receipt")[0].closest("button")!
    expect(process.textContent).toBe("Invoice receiptinvoice · v7")
    // A row's "Open" has the one action size (32 px, 14 px, 600), level with its icon buttons.
    const open = screen.getAllByRole("button", { name: /^Open instance/ })[0]
    expect(open.className).toMatch(/\bh-8\b/)
    expect(open.className).toMatch(/\btext-sm\b/)
    expect(open.className).toMatch(/\bfont-semibold\b/)
    // The aria-label replaces the content for a screen reader, so it must state the version.
    expect(process.getAttribute("aria-label")).toBe("Open process Invoice receipt, version 7")
  })

  it("hides the State column in a narrow region, and a suspended row says so in its first cell", () => {
    const { container } = render(
      <TestViewHost>
        <ProcessInstancesView data={engineWide()} engine="prod" />
      </TestViewHost>,
    )
    // The rule that hides the third column (State) below 48rem.
    const rules = container.querySelector("[data-list-table] style")?.textContent ?? ""
    expect(rules).toMatch(/nth-child\(3\) \{ display: none; \}/)
    const [running, suspended] = screen.getAllByRole("row").slice(1)
    const firstCell = (row: HTMLElement) => row.querySelector("td")!
    expect(firstCell(suspended).textContent).toContain("Suspended")
    expect(firstCell(suspended).querySelector("[class*='@min-[48rem]:hidden']")).not.toBeNull()
    expect(firstCell(running).textContent).not.toContain("Suspended")
  })

  it("keeps the Version and State columns in a list scoped to one process", () => {
    render(
      <TestViewHost>
        <ProcessInstancesView data={firstPage({})} processDefinitionKey="invoice" engine="prod" />
      </TestViewHost>,
    )
    expect(headers()).toEqual(expect.arrayContaining(["Version", "State"]))
    expect(headers()).not.toContain("Process")
  })
})

// The chips count what each of them lists: the payload ON SCREEN, never the request, so a
// chip's count stays put while its own page is in flight.
describe("the filter chips' counts", () => {
  // The numbers' format is the published locale's, never the machine's: a German one would
  // read 1.234 in the English case.
  beforeEach(() => {
    setFormatLocale({ language: "en", locale: "en-US" })
  })
  afterEach(() => {
    setFormatLocale(undefined)
  })

  /** No chip on: the page's total is All's count. */
  const counted = (all: number, incidents: number, suspended: number): ProcessInstancesData => ({
    ...firstPage({}),
    totalCount: all,
    allCount: all,
    withIncidentCount: incidents,
    suspendedCount: suspended,
  })
  const chip = (name: RegExp) =>
    within(screen.getByRole("group", { name: /instance filters|instanzfilter/i })).getByRole(
      "button",
      { name },
    )

  it("shows every chip's count, formatted; with no chip on, All's is the header's total", () => {
    render(
      <TestViewHost>
        <ProcessInstancesView
          data={counted(2_480, 1_234, 7)}
          processDefinitionKey="invoice"
          engine="prod"
        />
      </TestViewHost>,
    )
    expect(chip(/^All/).textContent).toBe("All2,480")
    expect(chip(/^With incident/).textContent).toBe("With incident1,234")
    expect(chip(/^Suspended/).textContent).toBe("Suspended7")
    expect(screen.getByText("2,480 running")).toBeTruthy()
  })

  it("formats them in the host's locale", () => {
    setFormatLocale({ language: "de", locale: "de-DE" })
    render(
      <TestViewHost locale="de">
        <ProcessInstancesView
          data={counted(2_480, 1_234, 7)}
          processDefinitionKey="invoice"
          engine="prod"
        />
      </TestViewHost>,
    )
    expect(chip(/^Alle/).textContent).toBe("Alle2.480")
    expect(chip(/^Mit Incident/).textContent).toBe("Mit Incident1.234")
    expect(chip(/^Ausgesetzt/).textContent).toBe("Ausgesetzt7")
    expect(screen.getByText("2.480 laufend")).toBeTruthy()
  })

  it("reads the page on screen: the old counts while a chip's page loads, then its own", async () => {
    let answer: (data: ProcessInstancesData) => void = () => {}
    const pending = new Promise<ProcessInstancesData>((resolve) => {
      answer = resolve
    })
    render(
      <TestViewHost tools={{ [ENGINE_PROCESS_INSTANCES_DATA]: () => pending }}>
        <ProcessInstancesView
          data={counted(12, 3, 1)}
          processDefinitionKey="invoice"
          engine="prod"
        />
      </TestViewHost>,
    )
    fireEvent.click(chip(/^With incident/))
    await waitFor(() => expect(chip(/^With incident/).getAttribute("aria-pressed")).toBe("true"))
    expect(chip(/^All/).textContent).toBe("All12")
    expect(chip(/^Suspended/).textContent).toBe("Suspended1")

    // With incident on, the page's total is that chip's count; All still counts the whole list.
    answer({ ...counted(13, 4, 2), totalCount: 4, filters: { withIncidents: true } })
    await waitFor(() => expect(chip(/^Suspended/).textContent).toBe("Suspended2"))
    expect(chip(/^With incident/).textContent).toBe("With incident4")
    expect(chip(/^All/).textContent).toBe("All13")
    expect(screen.getByText("4 running")).toBeTruthy()
  })
})
