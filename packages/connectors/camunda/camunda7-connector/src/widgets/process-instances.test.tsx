// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { complementaryFlags } from "@miragon/pulse-camunda7-client"
import { CAMUNDA7_PROCESS_INSTANCES_DATA } from "../tool-names.js"
import type { ProcessInstancesData } from "../view-models.js"
import { ProcessInstancesView } from "./process-instances/list.js"

// #329: the feed maps a `false` run-state flag onto its complement, so every refetch must carry the
// SAME filter or later pages mix in rows page 0 excluded.

afterEach(() => {
  cleanup()
  queryClient.clear()
})

type StateFlags = { active?: boolean; suspended?: boolean }

const runState = (args: StateFlags) => complementaryFlags(args, "active", "suspended")

function firstPage(flags: StateFlags): ProcessInstancesData {
  return {
    processDefinitionKey: "invoice",
    processDefinitionName: "Invoice",
    totalCount: 3,
    returnedCount: 2,
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

function renderWithFeed(view: ComponentType<Record<string, unknown>>) {
  const calls: Array<Record<string, unknown>> = []
  const feed = (args: Record<string, unknown>) => {
    calls.push(args)
    return { ...firstPage({}), instances: [], returnedCount: 0 }
  }
  render(
    <WidgetFixtureHost
      widget={view}
      data={{}}
      tools={{ [CAMUNDA7_PROCESS_INSTANCES_DATA]: feed }}
    />,
  )
  return calls
}

describe("process-instances widget keeps page 0's run-state filter", () => {
  it.each<StateFlags>([
    { active: false },
    { suspended: false },
    { active: true },
    { suspended: true },
  ])("Load more after a show call with %o", async (flags) => {
    const View = () => <ProcessInstancesView data={firstPage(flags)} />
    const calls = renderWithFeed(View)
    fireEvent.click(await screen.findByText("Load more"))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ processDefinitionKey: "invoice", engine: "prod" })
    expect(calls[0].firstResult).toBe(2)
    expect(runState(calls[0])).toEqual(runState(flags))
  })

  it("a composed view's false prop filters its own fetch", async () => {
    const View = () => (
      <ProcessInstancesView processDefinitionKey="invoice" engine="prod" suspended={false} />
    )
    const calls = renderWithFeed(View)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(runState(calls[0])).toEqual({ active: true })
  })

  it("the Suspended chip replaces the run-state filter instead of contradicting it", async () => {
    const View = () => <ProcessInstancesView data={firstPage({ active: true })} />
    const calls = renderWithFeed(View)
    fireEvent.click(await screen.findByText("Suspended"))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(runState(calls[0])).toEqual({ suspended: true })
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
      <WidgetFixtureHost widget={() => <ProcessInstancesView data={engineWide()} />} data={{}} />,
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
      <WidgetFixtureHost widget={() => <ProcessInstancesView data={engineWide()} />} data={{}} />,
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
      <WidgetFixtureHost widget={() => <ProcessInstancesView data={firstPage({})} />} data={{}} />,
    )
    expect(headers()).toEqual(expect.arrayContaining(["Version", "State"]))
    expect(headers()).not.toContain("Process")
  })
})
