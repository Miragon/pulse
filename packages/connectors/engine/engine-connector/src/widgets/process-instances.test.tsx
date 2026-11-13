// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { complementaryFlags } from "@miragon/pulse-c7-core"
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
    fireEvent.click(await screen.findByRole("radio", { name: /^Suspended/ }))
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

// #396: inline the version moves to the quiet line; the state keeps its own column on one line, an
// open incident beside it (the webview's state cell), never stacked under the business key.
describe("the engine-wide list's columns", () => {
  function engineWide(): ProcessInstancesData {
    const page = firstPage({})
    return {
      ...page,
      processDefinitionKey: null,
      processDefinitionName: null,
      instances: [
        { ...page.instances[0], processDefinitionName: "Invoice receipt", version: 7 },
        {
          ...page.instances[1],
          processDefinitionName: "Invoice receipt",
          suspended: true,
          hasIncident: true,
        },
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
    // One line in the cell: the name, the key, the version.
    expect(process.textContent).toBe("Invoice receipt invoice · v7")
    // A row's "Open" is the xs button (24 px, 13 px, 600), level with its icon buttons, so the row
    // keeps the row height.
    const open = screen.getAllByRole("button", { name: /^Open instance/ })[0]
    expect(open.className).toMatch(/(^| )min-h-control-xs( |$)/)
    expect(open.className).toMatch(/\bfont-semibold\b/)
    // The aria-label replaces the content for a screen reader, so it must state the version.
    expect(process.getAttribute("aria-label")).toBe("Open process Invoice receipt, version 7")
  })

  it("keeps the state in its own column on one line, an open incident beside it", () => {
    const { container } = render(
      <TestViewHost>
        <ProcessInstancesView data={engineWide()} engine="prod" />
      </TestViewHost>,
    )
    // No column hides: the state has its place in every width, right after the ids (the
    // webview's order), so a narrow chat that scrolls the table sideways cuts the process first.
    const rules = container.querySelector("[data-list-table] style")?.textContent ?? ""
    expect(rules).not.toMatch(/display: none/)
    expect(headers()).not.toContain("Incident")
    expect(headers().slice(0, 3)).toEqual(["Business key / ID", "State", "Process"])
    const [running, suspended] = screen.getAllByRole("row").slice(1)
    const cells = (row: HTMLElement) => [...row.querySelectorAll("td")]
    const stateOf = (row: HTMLElement) =>
      [...cells(row)[1].querySelectorAll('[data-slot="state-label"]')].map((label) =>
        label.getAttribute("data-state"),
      )
    expect(stateOf(running)).toEqual(["running"])
    expect(stateOf(suspended)).toEqual(["suspended", "incident"])
    expect(cells(suspended)[1].textContent).toBe("SuspendedIncident")
    // Nothing stacks under the business key, and no pill says a state in a row.
    expect(cells(suspended)[0].textContent).not.toContain("Suspended")
    expect(container.querySelector("tbody [data-slot='status-badge']")).toBeNull()
  })

  it("keeps the Version and State columns in a list scoped to one process", () => {
    render(
      <TestViewHost>
        <ProcessInstancesView data={firstPage({})} processDefinitionKey="invoice" engine="prod" />
      </TestViewHost>,
    )
    expect(headers().slice(0, 3)).toEqual(["Business key / ID", "State", "Version"])
    expect(headers()).not.toContain("Process")
  })
})

// The scopes count what each of them lists: the payload ON SCREEN, never the request, so a
// scope's count stays put while its own page is in flight. Compact on screen, exact in its name.
describe("the scope segments' counts", () => {
  /** No scope picked: the page's total is All's count. */
  const counted = (all: number, incidents: number, suspended: number): ProcessInstancesData => ({
    ...firstPage({}),
    totalCount: all,
    allCount: all,
    withIncidentCount: incidents,
    suspendedCount: suspended,
  })
  const scope = (name: RegExp) =>
    within(screen.getByRole("radiogroup", { name: /show instances|instanzen zeigen/i })).getByRole(
      "radio",
      { name },
    )
  /** The count on screen (compact) and the one a screen reader hears (exact, in words). */
  const count = (radio: HTMLElement) => ({
    shown: radio.querySelector('[aria-hidden="true"]:not(svg)')?.textContent,
    heard: radio.querySelector(".sr-only")?.textContent,
  })

  it("shows every scope's count; with none picked, All's is the header's total", () => {
    render(
      <TestViewHost>
        <ProcessInstancesView
          data={counted(2_480, 1_234, 7)}
          processDefinitionKey="invoice"
          engine="prod"
        />
      </TestViewHost>,
    )
    expect(count(scope(/^All/))).toEqual({ shown: "2.5k", heard: "2,480" })
    // The label says why the count alarms: the name is the label and the exact count, once.
    expect(count(scope(/^With incident/))).toEqual({ shown: "1.2k", heard: "1,234" })
    expect(scope(/^With incident/).textContent).toBe("With incident1.2k1,234")
    expect(count(scope(/^Suspended/))).toEqual({ shown: "7", heard: "7" })
    expect(scope(/^All/).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByText("2,480 running")).toBeTruthy()
  })

  it("marks the count with an incident by the danger icon, never by a coloured number", () => {
    render(
      <TestViewHost>
        <ProcessInstancesView
          data={counted(12, 3, 0)}
          processDefinitionKey="invoice"
          engine="prod"
        />
      </TestViewHost>,
    )
    const incident = scope(/^With incident/)
    expect(incident.querySelector("svg")?.getAttribute("class")).toContain("lucide-circle-x")
    expect(incident.querySelector("svg")?.getAttribute("class")).toContain("text-danger")
    expect(incident.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "")).not.toMatch(/text-danger/)
    expect(scope(/^All/).querySelector("svg")).toBeNull()
    cleanup()
    render(
      <TestViewHost>
        <ProcessInstancesView
          data={counted(12, 0, 0)}
          processDefinitionKey="invoice"
          engine="prod"
        />
      </TestViewHost>,
    )
    expect(scope(/^With incident/).querySelector("svg")).toBeNull()
  })

  it("formats them in the host's locale", () => {
    render(
      <TestViewHost locale="de">
        <ProcessInstancesView
          data={counted(2_480, 1_234, 7)}
          processDefinitionKey="invoice"
          engine="prod"
        />
      </TestViewHost>,
    )
    expect(count(scope(/^Alle/))).toEqual({ shown: "2.480", heard: "2.480" })
    expect(count(scope(/^Mit Incident/))).toEqual({ shown: "1.234", heard: "1.234" })
    expect(count(scope(/^Ausgesetzt/))).toEqual({ shown: "7", heard: "7" })
    expect(screen.getByText("2.480 laufend")).toBeTruthy()
  })

  it("reads the page on screen: the old counts while a scope's page loads, then its own", async () => {
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
    fireEvent.click(scope(/^With incident/))
    await waitFor(() => expect(scope(/^With incident/).getAttribute("aria-checked")).toBe("true"))
    // Busy while the scope's page loads.
    expect(screen.getByRole("radiogroup").getAttribute("aria-busy")).toBe("true")
    expect(count(scope(/^All/)).shown).toBe("12")
    expect(count(scope(/^Suspended/)).shown).toBe("1")

    // With incident on, the page's total is that scope's count; All still counts the whole list.
    answer({ ...counted(13, 4, 2), totalCount: 4, filters: { withIncidents: true } })
    await waitFor(() => expect(count(scope(/^Suspended/)).shown).toBe("2"))
    expect(count(scope(/^With incident/)).shown).toBe("4")
    expect(count(scope(/^All/)).shown).toBe("13")
    expect(screen.getByRole("radiogroup").getAttribute("aria-busy")).toBe("false")
    expect(screen.getByText("4 running")).toBeTruthy()
  })
})
