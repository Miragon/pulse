// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import type { IncidentInstance, ProcessIncidentsData } from "../view-models.js"
import { GroupSummaryRow } from "./group-summary-row.js"
import { InstanceLabel } from "./lib/identity.js"
import { ProcessDetailHeader } from "./process-incidents/header.js"
import { IncidentTable } from "./process-incidents/incident-table.js"
import { useIncidentRecovery } from "./process-incidents/use-incident-recovery.js"
import { InstancesHeader } from "./process-instances/list-header.js"

/**
 * The cockpit in a narrow chat (a 400 px card): its tables keep one line per row and scroll in
 * their region, ids take one line, a group's title keeps its share, and a header's count is a
 * neutral number beside its tone's icon. test:host measures the same in a real browser.
 */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

const LONG = "Approver lookup failed: no user with role 'finance-approver' in group 'invoice-eu'"

function incident(id: string, over: Partial<IncidentInstance>): IncidentInstance {
  return {
    id,
    processInstanceId: `7f3c2a9${id}-5b0e-4c1d-9a77-2e6b8d4f1c01`,
    incidentType: "failedJob",
    incidentMessage: LONG,
    incidentTimestamp: "2026-10-09T09:30:00.000+0000",
    activityId: "approveInvoice",
    activityName: "Approve Invoice",
    cockpitInstanceUrl: null,
    businessKey: "INV-2026-0041",
    recovery: { action: "none" },
    ...over,
  }
}

const INCIDENTS = [incident("1", {}), incident("2", { businessKey: null, incidentMessage: null })]

function Table({ subject }: { subject: "instance" | "element" }) {
  const recovery = useIncidentRecovery("prod", { resetOn: INCIDENTS })
  return (
    <IncidentTable
      incidents={INCIDENTS}
      recovery={recovery}
      onAnalyze={() => {}}
      subject={subject}
    />
  )
}

function renderIn(Component: ComponentType) {
  return render(
    <TestViewHost>
      <Component />
    </TestViewHost>,
  )
}

describe("an incident table: one line per row, the message taking the rest", () => {
  it.each(["instance", "element"] as const)(
    "%s: the message one line with an ellipsis, its whole text in its title, 10rem at least",
    (subject) => {
      const { container } = renderIn(() => <Table subject={subject} />)
      const messages = [...container.querySelectorAll("[data-incident-message]")]
      expect(messages.map((m) => m.textContent)).toEqual([LONG, "—"])
      expect(messages[0].getAttribute("title")).toBe(LONG)
      expect(classes(messages[0])).toEqual(expect.arrayContaining(["truncate", "min-w-0"]))
      expect(classes(messages[0].parentElement)).toContain("grid-cols-[minmax(10rem,max-content)]")
      // The type beside it as its state label, its icon alone in a narrow region.
      const type = messages[0].closest("td")!.querySelector("[data-slot='state-label']")!
      expect(type.getAttribute("title")).toBe("failedJob")
      expect(classes(type.lastElementChild)).toContain("@max-md:sr-only")
    },
  )

  it("the subject, the time and the actions fit their content; the subject gives way under 28rem", () => {
    const { container } = renderIn(() => <Table subject="instance" />)
    const heads = [...container.querySelectorAll("thead th")]
    expect(heads.map((th) => th.textContent)).toEqual([
      "Instance",
      "Error message",
      "Time",
      "Actions",
    ])
    expect(heads.map((th) => classes(th).includes("w-[1%]"))).toEqual([true, false, true, true])
    const subject = container.querySelector("tbody tr td")!
    expect(classes(subject)).toEqual(
      expect.arrayContaining(["[--named-id-floor:max-content]", "@max-md:[--named-id-floor:8rem]"]),
    )
  })

  it("an element by its name and id on one line, no floor of its own", () => {
    const { container } = renderIn(() => <Table subject="element" />)
    const cell = container.querySelector("tbody tr td")!
    expect(cell.querySelector("[data-named-id='inline']")).not.toBeNull()
    expect(cell.innerHTML).not.toContain("min-w-40")
  })
})

describe("an instance's label", () => {
  it("in a table: the key, then the short id, on one line, cut with an ellipsis, the whole in its title", () => {
    const { container } = renderIn(() => (
      <InstanceLabel id="7f3c2a91-5b0e-4c1d-9a77-2e6b8d4f1c01" businessKey="INV-2026-0041" />
    ))
    const label = container.querySelector("[data-instance-label]")!
    expect(classes(label)).toContain("grid-cols-[minmax(var(--named-id-floor,8rem),max-content)]")
    expect(label.innerHTML).not.toContain("flex-wrap")
    const key = screen.getByText("INV-2026-0041", { exact: false, selector: "span.truncate" })
    expect(key.getAttribute("title")).toBe("INV-2026-0041 · 7f3c2a91-5b0e-4c1d-9a77-2e6b8d4f1c01")
    // Under 28rem the key alone: the id leaves sight, never a screen reader.
    expect(classes(screen.getByRole("button", { name: /^Copy/ }).parentElement)).toContain(
      "@max-md:hidden",
    )
    expect(classes(key.querySelector(".sr-only"))).toContain("@md:hidden")
  })

  it("without a key: the short id whole with its copy button, at any width", () => {
    renderIn(() => <InstanceLabel id="7f3c2a91-5b0e-4c1d-9a77-2e6b8d4f1c01" businessKey={null} />)
    expect(screen.getByText("7f3c2a91…")).toBeTruthy()
    expect(classes(screen.getByRole("button", { name: /^Copy/ }).parentElement)).not.toContain(
      "@max-md:hidden",
    )
  })

  it("on a line of facts (wrap): the key and the id wrap between them, never cut", () => {
    const { container } = renderIn(() => (
      <InstanceLabel id="pi-1" businessKey="INV-2026-0041" wrap />
    ))
    expect(container.querySelector("[data-instance-label]")).toBeNull()
    expect(classes(container.querySelector("span"))).toContain("flex-wrap")
  })
})

describe("a group's summary in a narrow row", () => {
  it("keeps the title 10rem at least and moves the stats under it below 42rem", () => {
    const { container } = render(
      <TestViewHost>
        <GroupSummaryRow
          title="Approve Invoice"
          subline="Approver lookup failed"
          stats={[
            { value: "10/9/2026, 8:00 AM", label: "first seen" },
            { value: "10/10/2026, 8:00 AM", label: "latest" },
          ]}
          incidents={3}
          expanded={false}
        />
      </TestViewHost>,
    )
    expect(classes(container.querySelector("[data-slot='group-summary']"))).toContain(
      "@container/summary",
    )
    expect(classes(container.querySelector("[data-slot='group-summary-title']"))).toContain(
      "min-w-[min(10rem,100%)]",
    )
    const stats = container.querySelector("[data-slot='group-summary-stats']")!
    expect(classes(stats)).toEqual(
      expect.arrayContaining(["@max-2xl/summary:order-last", "@max-2xl/summary:basis-full"]),
    )
    // Each stat its label, then its value, on one line there.
    expect(classes(stats.firstElementChild)).toContain("@max-2xl/summary:flex-row-reverse")
  })

  it("gives each stat and the count a fixed track, so they line up from row to row", () => {
    const { container } = render(
      <TestViewHost>
        <GroupSummaryRow
          title="Approve Invoice"
          stats={[{ value: "10/9/2026, 8:00 AM", label: "first seen" }]}
          incidents={46}
        />
      </TestViewHost>,
    )
    const stats = container.querySelector("[data-slot='group-summary-stats']")!
    expect(classes(stats.firstElementChild)).toEqual(
      expect.arrayContaining(["min-w-40", "text-right", "@max-2xl/summary:min-w-0"]),
    )
    expect(classes(container.querySelector("[data-slot='group-summary-count']"))).toEqual(
      expect.arrayContaining(["min-w-14", "justify-end"]),
    )
  })
})

describe("a count in a view's header is a state label, never a tinted badge", () => {
  const PROCESS: ProcessIncidentsData = {
    processDefinitionKey: "leasing",
    processDefinitionName: "Leasing",
    diagramVersion: 2,
    diagramDefinitionId: null,
    cockpitUrl: null,
    runningInstances: 99,
    incidentCount: 4,
    last24hCount: 1,
    failedJobs: 2,
    totalActivityCount: 2,
    affectedDiagramActivityCount: 1,
    latestIncident: "2026-10-10T12:00:00.000+0000",
    activities: [],
    siblingsWithIncidents: null,
    engineVendor: "CIB seven",
    engineId: "prod-a",
  }

  it("a process's open incidents: the incident's icon, the number in the foreground", () => {
    const { container } = render(
      <TestViewHost>
        <ProcessDetailHeader
          data={PROCESS as never}
          processDefinitionKey="leasing"
          engine="prod-a"
        />
      </TestViewHost>,
    )
    const bar = container.querySelector("[data-slot='view-bar']")!
    expect(bar.querySelector("[data-slot='status-badge']")).toBeNull()
    const state = bar.querySelector("[data-slot='state-label']")!
    expect(state.getAttribute("data-state")).toBe("incident")
    expect(state.textContent).toBe("4 open incidents")
    expect(classes(state.lastElementChild)).toContain("text-foreground")
  })

  it("an instance list's running count: the running state's icon, the number in the foreground", () => {
    const { container } = render(
      <TestViewHost>
        <InstancesHeader
          title="Running instances"
          processName={null}
          scopedKey={null}
          total={160}
          engine="prod-a"
          filters={{}}
        />
      </TestViewHost>,
    )
    expect(container.innerHTML).not.toMatch(/animate-pulse|bg-info-soft/)
    const state = container.querySelector("[data-slot='state-label']")!
    expect(state.getAttribute("data-state")).toBe("running")
    expect(state.textContent).toBe("160 running")
  })
})
