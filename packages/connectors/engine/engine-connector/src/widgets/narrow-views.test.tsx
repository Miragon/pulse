// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import type {
  ClusterDetailData,
  IncidentInstance,
  ProcessIncidentsData,
  ProcessInstancesData,
} from "../view-models.js"
import { ClusterDetailWidget } from "./cluster-detail.js"
import { GroupSummaryRow } from "./group-summary-row.js"
import { InstanceLabel } from "./lib/identity.js"
import { ProcessDetailHeader } from "./process-incidents/header.js"
import { IncidentTable } from "./process-incidents/incident-table.js"
import { useIncidentRecovery } from "./process-incidents/use-incident-recovery.js"
import { InstancesHeader } from "./process-instances/list-header.js"
import { ProcessInstancesView } from "./process-instances/list.js"
import { ProcessDefinitionsTableView } from "./process-definitions-table-view.js"
import { JobPanelWidget } from "./job-panel.js"

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
      // pulse-ui's LogText line: one line, its whole text in its title, 10rem at least.
      const line = messages[0].querySelector("[title]")!
      expect(line.getAttribute("title")).toBe(LONG)
      expect(classes(line)).toEqual(expect.arrayContaining(["truncate", "min-w-0"]))
      expect(classes(messages[0].firstElementChild)).toContain(
        "grid-cols-[minmax(10rem,max-content)]",
      )
      // The type beside it as its state label, its icon alone in a narrow region.
      const type = messages[0].closest("td")!.querySelector("[data-slot='state-label']")!
      expect(type.getAttribute("title")).toBe("Failed job")
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
    // ListTable's `fit`: the heads as narrow as their content, the cells marked one line each.
    expect(heads.map((th) => classes(th).includes("w-[1%]"))).toEqual([true, false, true, true])
    const first = container.querySelector("tbody tr")!
    expect([...first.children].map((cell) => cell.hasAttribute("data-fit"))).toEqual([
      true,
      false,
      true,
      true,
    ])
    // Under 28rem the label sets its own floor back to 8rem, over its column's whole text.
    expect(classes(first.querySelector("[data-instance-label]"))).toContain(
      "@max-md:[--named-id-floor:8rem]",
    )
  })

  it("an element by its name and id on one line, giving way to 8rem under 28rem as an instance", () => {
    const { container } = renderIn(() => <Table subject="element" />)
    const cell = container.querySelector("tbody tr td")!
    expect(cell.hasAttribute("data-fit")).toBe(true)
    const element = cell.querySelector("[data-named-id='inline']")
    expect(classes(element)).toContain("@max-md:[--named-id-floor:8rem]")
    expect(cell.innerHTML).not.toContain("min-w-40")
  })
})

const KEYS = ["INV-2026-0041-EU-NORTH-REVIEW-QUEUE", null]
const INSTANCE_IDS = [
  "7f3c2a91-5b0e-4c1d-9a77-2e6b8d4f1c01",
  "a1b2c3d4-0000-0000-0000-000000000000",
]

const CLUSTER: ClusterDetailData = {
  activityId: "approveInvoice",
  activityName: "Approve Invoice",
  incidentType: "failedJob",
  messageSignature: "approver lookup failed",
  incidentCount: 2,
  scannedIncidentCount: 2,
  lastHourCount: 0,
  firstSeen: "2026-10-09T08:00:00.000Z",
  latestIncident: "2026-10-09T09:30:00.000Z",
  processDefinitionKeys: ["invoice"],
  representativeMessage: LONG,
  incidents: INSTANCE_IDS.map((id, index) => ({
    incidentId: `inc-${index}`,
    processInstanceId: id,
    businessKey: KEYS[index],
    processDefinitionKey: "invoice",
    processDefinitionName: null,
    incidentTimestamp: "2026-10-09T09:30:00.000Z",
  })),
  totalMatching: 2,
  fetchedAt: "2026-10-09T09:35:00.000Z",
  engineId: "prod",
}

const INSTANCES: ProcessInstancesData = {
  processDefinitionKey: "invoice",
  processDefinitionName: "Invoice",
  totalCount: 2,
  returnedCount: 2,
  fetchedAt: "2026-10-26T08:00:00.000Z",
  allCount: 2,
  withIncidentCount: 0,
  suspendedCount: 0,
  instances: INSTANCE_IDS.map((id, index) => ({
    id,
    businessKey: KEYS[index],
    processDefinitionKey: "invoice",
    processDefinitionName: null,
    version: 1,
    suspended: false,
    hasIncident: false,
    startTime: null,
  })),
  filters: {},
  engineId: "prod",
}

describe("a list of instances: the instance fits its content, the rest gives way first", () => {
  it.each([
    [
      "a cluster's incidents, by their instances",
      () => (
        <ClusterDetailWidget
          data={CLUSTER}
          engine="prod"
          activityId={CLUSTER.activityId}
          incidentType={CLUSTER.incidentType}
          messageSignature={CLUSTER.messageSignature ?? undefined}
        />
      ),
      [0],
    ],
    [
      "the instance list",
      () => <ProcessInstancesView data={INSTANCES} processDefinitionKey="invoice" engine="prod" />,
      // Its version as narrow as its chip and its start as its time: the state takes the rest.
      [0, 2, 3],
    ],
  ] as const)("%s: the instance column fits, one line per row", (_view, View, fits) => {
    const { container } = renderIn(View)
    const table = container.querySelector("tbody [data-instance-label]")!.closest("table")!
    const heads = [...table.querySelectorAll("thead th")]
    const fitted = (i: number) => (fits as readonly number[]).includes(i)
    // ListTable's `fit`: the head as narrow as its content, the cells marked one line each.
    expect(heads.map((th) => classes(th).includes("w-[1%]"))).toEqual(
      heads.map((_, i) => fitted(i)),
    )
    const rows = [...table.querySelectorAll("tbody tr")]
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect([...row.children].map((cell) => cell.hasAttribute("data-fit"))).toEqual(
        [...row.children].map((_, i) => fitted(i)),
      )
    }
    // Under 28rem the key gives way to 8rem, over its column's whole text.
    expect(classes(rows[0].querySelector("[data-instance-label]"))).toContain(
      "@max-md:[--named-id-floor:8rem]",
    )
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
    failedJobs: 2,
    totalActivityCount: 2,
    affectedDiagramActivityCount: 1,
    latestIncident: "2026-10-10T12:00:00.000+0000",
    activities: [],
    siblingsWithIncidents: null,
    engineVendor: "CIB seven",
    engineId: "prod-a",
  }

  // One home per number: the process's open incidents are its KPI tile's, so its bar shows no
  // count at all, neither a tinted badge nor a state label.
  it("a process's open incidents: none in its bar, the tile under it holds them", () => {
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
    expect(bar.querySelector("[data-slot='state-label']")).toBeNull()
    expect(bar.textContent).not.toMatch(/\b(4|99) /)
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
          fetchedAt="2026-10-26T08:00:00.000Z"
        />
      </TestViewHost>,
    )
    expect(container.innerHTML).not.toMatch(/animate-pulse|bg-info-soft/)
    const state = container.querySelector("[data-slot='state-label']")!
    expect(state.getAttribute("data-state")).toBe("running")
    expect(state.textContent).toBe("160 running")
  })
})

/** Each head's word and the region width below which its column hides, from the table's rules. */
function hiddenBelow(container: HTMLElement): Record<string, string> {
  const rules = container.querySelector("[data-list-table] style")?.textContent ?? ""
  const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent ?? "")
  return Object.fromEntries(
    [
      ...rules.matchAll(
        /@container \(min-width: ([\d.]+rem)\) \{ [^{}]*:nth-child\((\d+)\) \{ display: table-cell; \} \}/g,
      ),
    ].map(([, width, nth]) => [heads[Number(nth) - 1], width]),
  )
}

// A8: a narrow region drops columns by their importance, never by their position, so the alarms
// stay in view where the name does.
describe("a narrow table drops what matters least first", () => {
  it("the overview's processes: the version, then the running instances; name and alarms stay", () => {
    const { container } = render(
      <TestViewHost>
        <ProcessDefinitionsTableView
          rows={[
            {
              id: "invoice:2:d",
              key: "invoice",
              name: "Invoice receipt",
              version: 2,
              counts: { instances: 70, failedJobs: 54, totalIncidents: 53 },
            },
          ]}
          ariaLabel="All processes"
          emptyText="None"
        />
      </TestViewHost>,
    )
    expect(hiddenBelow(container)).toEqual({ "Latest version": "48rem", Running: "40rem" })
  })

  it("the jobs: the error keeps its column, the instance and the creation give way", () => {
    const { container } = render(
      <TestViewHost>
        <JobPanelWidget
          data={{
            totalCount: 1,
            allCount: 1,
            failedCount: 1,
            fetchedAt: "2026-10-26T08:00:00.000Z",
            jobs: [
              {
                id: "job-1",
                processInstanceId: "pi-1",
                processDefinitionKey: "invoice",
                processDefinitionId: "invoice:1:d",
                processDefinitionName: "Invoice receipt",
                activityId: "Activity_CheckBlacklist",
                activityName: "Check blacklist",
                retries: 0,
                exceptionMessage: LONG,
                dueDate: null,
                suspended: false,
                priority: 0,
                createTime: "2026-10-26T07:00:00.000Z",
              },
            ],
            filters: { failedOnly: true },
            engineId: "prod",
          }}
          engine="prod"
          failedOnly
        />
      </TestViewHost>,
    )
    expect(hiddenBelow(container)).toEqual({ Instance: "64rem", Created: "48rem" })
    // The activity keeps no floor of its own beyond its name's line: the error gets the room.
    const subject = screen.getByText("Check blacklist").closest("td")!.firstElementChild!
    expect(classes(subject)).not.toContain("min-w-48")
  })
})
