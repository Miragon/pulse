// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { formatClock, formatInstant } from "@miragon/pulse-ui"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import type { IncidentInstance, InstanceDetailData } from "../view-models.js"
import { InstanceDetailWidget } from "./instance-detail.js"
import { NavProvider, type NavIntent } from "./navigation.js"
import { FAILED_JOB_INCIDENT, instance } from "./write-path.test-support.js"

/** What VS Code shows and the cockpit lacked: each incident's element, and the way to the process. */

afterEach(() => {
  cleanup()
})

const at = (
  id: string,
  activityId: string | null,
  activityName: string | null,
): IncidentInstance => ({
  ...FAILED_JOB_INCIDENT,
  id,
  incidentMessage: `message ${id}`,
  activityId,
  activityName,
})

/** No open task, so the view opens on its Incidents tab. */
const withIncidents = (over: Partial<InstanceDetailData> = {}) =>
  instance({
    processDefinitionName: "Invoice Receipt",
    incidents: [
      at("inc-1", "chargeCard", "Charge card"),
      at("inc-2", "Gateway_1x9", null),
      at("inc-3", null, null),
    ],
    incidentCount: 3,
    openTasks: [],
    openTaskCount: 0,
    ...over,
  })

function renderDetail(data: InstanceDetailData, locale?: string) {
  const intents: NavIntent[] = []
  const view = render(
    <NavProvider value={(intent) => intents.push(intent)}>
      <TestViewHost locale={locale}>
        <InstanceDetailWidget data={data} processInstanceId="pi-1" engine="prod" />
      </TestViewHost>
    </NavProvider>,
  )
  return { intents, ...view }
}

describe("the instance's Incidents tab names each incident's element", () => {
  it("by its diagram name over the id, the id where it has none, a dash where the engine names none", () => {
    renderDetail(withIncidents())
    const table = screen.getByRole("region", { name: "Incidents of this instance" })
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent)
    expect(headers.slice(0, 2)).toEqual(["Activity", "Error message"])

    const firstCells = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("td")!)
    // The name leads, the BPMN id quiet after it on the same line.
    expect(firstCells[0].textContent).toBe("Charge card chargeCard")
    // Without a name the id leads, in mono, never a blank cell.
    expect(firstCells[1].textContent).toBe("Gateway_1x9")
    expect(firstCells[1].querySelector(".font-mono")).not.toBeNull()
    expect(firstCells[2].textContent).toBe("—")
  })

  it("in German too", () => {
    renderDetail(withIncidents(), "de")
    const table = screen.getByRole("region", { name: "Incidents dieser Instanz" })
    expect(within(table).getAllByRole("columnheader")[0].textContent).toBe("Aktivität")
  })
})

describe("the instance's header leads to its process", () => {
  it("as its first action, a drill into the cockpit's process route; the meta line stays facts", () => {
    const { intents, container } = renderDetail(withIncidents())
    const bar = container.querySelector<HTMLElement>('[data-slot="view-bar"]')!
    const facts = bar.querySelector<HTMLElement>('[data-slot="view-bar-facts"]')!
    const group = bar.querySelector<HTMLElement>('[data-slot="view-bar-actions"]')!
    // Facts only (invariant 6): the process is named there, the way to it is an action.
    expect(facts.textContent).toContain("Invoice Receipt")
    expect(facts.querySelectorAll("a")).toHaveLength(0)
    expect(within(facts).queryByRole("button", { name: /process|invoice/i })).toBeNull()

    const actions = within(group).getAllByRole("button")
    expect(actions[0].textContent).toBe("View process")
    fireEvent.click(actions[0])
    expect(intents).toEqual([
      { type: "process-detail", processDefinitionKey: "invoice", label: "Invoice Receipt" },
    ])
  })

  it("in German too", () => {
    const { intents } = renderDetail(withIncidents(), "de")
    fireEvent.click(screen.getByRole("button", { name: "Prozess anzeigen" }))
    expect(intents).toEqual([
      { type: "process-detail", processDefinitionKey: "invoice", label: "Invoice Receipt" },
    ])
  })

  it("not while the process's key is unknown (a bare id the engine could not resolve)", () => {
    renderDetail(withIncidents({ definitionKey: null }))
    expect(screen.queryByRole("button", { name: "View process" })).toBeNull()
  })
})

/**
 * The bar carries what the facts block repeated (V11): the state, and while there are any the open
 * incidents as a state label with their count, so an inline card shows them without its tabs;
 * tasks and variables count on their tabs alone. No facts block under the bar.
 */
describe("the instance's bar holds its state and its open incidents, no facts block", () => {
  const barOf = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-slot="view-bar"]')!

  it("shows the open incidents as a state label with their count, and no facts below", () => {
    const { container } = renderDetail(withIncidents())
    const bar = barOf(container)
    const label = within(bar).getByText("3 open incidents")
    expect(label.closest('[data-slot="state-label"]')?.getAttribute("data-state")).toBe("incident")
    expect(within(bar).getByText("Running")).toBeTruthy()
    for (const gone of ["State", "Open tasks", "Open incidents", "Variables"]) {
      expect(screen.queryByText(gone, { selector: "dt" }), gone).toBeNull()
    }
  })

  it("names no incidents while there are none, in German too", () => {
    const { container } = renderDetail(instance({ incidentCount: 0 }), "de")
    expect(within(barOf(container)).queryByText(/offene Incidents?/)).toBeNull()
    cleanup()
    const one = renderDetail(withIncidents({ incidentCount: 1 }), "de")
    expect(within(barOf(one.container)).getByText("1 offener Incident")).toBeTruthy()
  })

  it("titles an instance without a business key by its id once, copyable", () => {
    const id = "ee15ee49-1111-2222-3333-444455556666"
    const { container } = renderDetail(
      instance({ instance: { ...instance().instance, id, businessKey: null } }),
    )
    const bar = barOf(container)
    const heading = within(bar).getByRole("heading", { level: 1 })
    expect(within(heading).getByRole("button", { name: "Copy ee15ee49…" })).toBeTruthy()
    // Once: the facts name no id beside it.
    expect(within(bar).getAllByText("ee15ee49…")).toHaveLength(1)
  })

  it("keeps the id among the facts where the business key titles the instance", () => {
    const { container } = renderDetail(instance())
    const bar = barOf(container)
    expect(within(bar).getByRole("heading", { level: 1 }).textContent).toBe("INV-7")
    const facts = bar.querySelector<HTMLElement>('[data-slot="view-bar-facts"]')!
    expect(within(facts).getByRole("button", { name: "Copy pi-1" })).toBeTruthy()
  })

  // X1, D9: every route says when it was read, once, at its bar's end: here the state its writes
  // act on.
  it("says when the server read the instance, once at the bar's end, never among its facts", () => {
    const fetchedAt = "2026-11-01T09:41:00.000Z"
    const { container } = renderDetail(instance({ fetchedAt }))
    const bar = barOf(container)
    const stamps = bar.querySelectorAll<HTMLElement>('[data-slot="freshness-stamp"]')
    expect(stamps).toHaveLength(1)
    expect(stamps[0].textContent).toBe(`As of ${formatClock(fetchedAt, { seconds: false })}`)
    expect(stamps[0].title).toBe(formatInstant(fetchedAt))
    expect(
      bar.querySelector('[data-slot="view-bar-facts"] [data-slot="freshness-stamp"]'),
    ).toBeNull()
    cleanup()
    // An older payload names no time: no stamp, never a guess.
    const older = renderDetail(instance())
    expect(older.container.querySelector('[data-slot="freshness-stamp"]')).toBeNull()
  })

  it("says when it started, without seconds, the whole instant in its title", () => {
    const startTime = "2026-11-01T09:33:14.000+0100"
    const { container } = renderDetail(instance({ startTime }))
    const facts = barOf(container).querySelector<HTMLElement>('[data-slot="view-bar-facts"]')!
    const started = within(facts).getByText(/^Started /)
    expect(started.textContent).toBe(`Started ${formatClock(startTime, { seconds: false })}`)
    expect(started.getAttribute("title")).toBe(formatInstant(startTime))
  })
})

/** A called instance's bar leads back to its caller, by its short id, as the webview's does. */
describe("a called instance opens its caller", () => {
  const caller = "30654aea-1111-2222-3333-444455556666"

  it("as the first action, before its process; named by where it goes", () => {
    const { intents, container } = renderDetail(withIncidents({ callerInstanceId: caller }))
    const group = container.querySelector<HTMLElement>('[data-slot="view-bar-actions"]')!
    const [first, second] = within(group).getAllByRole("button")
    expect(first.getAttribute("aria-label")).toBe("Open caller 30654aea…")
    expect(first.textContent).toBe("30654aea…")
    expect(second.textContent).toBe("View process")
    fireEvent.click(first)
    expect(intents).toEqual([{ type: "instance-detail", processInstanceId: caller }])
  })

  it("in German too", () => {
    renderDetail(withIncidents({ callerInstanceId: caller }), "de")
    expect(screen.getByRole("button", { name: "Aufrufer 30654aea… öffnen" })).toBeTruthy()
  })

  it("not for an instance nothing called", () => {
    renderDetail(withIncidents())
    expect(screen.queryByRole("button", { name: /^Open caller/ })).toBeNull()
  })
})

/**
 * A copy at a call activity has no message of its own: its row shows its root incident's, quiet,
 * and where that one is, a link to the called instance (X5, the webview's "Located in").
 */
describe("a copy's row names its root cause and opens its called instance", () => {
  const called = "30668387-aaaa-bbbb-cccc-ddddeeeeffff"
  const copy: IncidentInstance = {
    ...at("copy-1", "callCheck", "Assess creditworthiness"),
    incidentMessage: null,
    recovery: { action: "none" },
    rootCause: {
      incidentId: "root-1",
      message: "Blacklist provider unreachable",
      activityId: "checkBlacklist",
      activityName: "Check blacklist",
      processInstanceId: called,
    },
  }

  it("shows the root's message and the link, which opens the instance and not the row", () => {
    const { intents } = renderDetail(withIncidents({ incidents: [copy], incidentCount: 1 }))
    const table = screen.getByRole("region", { name: "Incidents of this instance" })
    expect(within(table).getByText("Blacklist provider unreachable")).toBeTruthy()
    const link = within(table).getByRole("button", { name: "in Check blacklist · 30668387…" })
    expect(link.getAttribute("title")).toBe(`Open the called instance ${called}`)
    fireEvent.click(link)
    expect(intents).toEqual([
      { type: "instance-detail", processInstanceId: called, label: "30668387…" },
    ])
  })

  it("keeps the '—' of a copy whose root is unread, and a row's own message as it is", () => {
    renderDetail(
      withIncidents({
        incidents: [{ ...copy, rootCause: null }, at("own", "charge", "Charge card")],
        incidentCount: 2,
      }),
    )
    const table = screen.getByRole("region", { name: "Incidents of this instance" })
    expect(within(table).getByText("—")).toBeTruthy()
    expect(within(table).getByText("message own")).toBeTruthy()
    expect(within(table).queryByRole("button", { name: /^in / })).toBeNull()
  })
})

describe("an incident row's time", () => {
  it("is a clock without seconds, the whole instant in its title", () => {
    renderDetail(withIncidents())
    const table = screen.getByRole("region", { name: "Incidents of this instance" })
    const at = FAILED_JOB_INCIDENT.incidentTimestamp
    const time = within(table).getAllByTitle(formatInstant(at))[0]
    expect(time.textContent).toBe(formatClock(at, { seconds: false }))
  })
})
