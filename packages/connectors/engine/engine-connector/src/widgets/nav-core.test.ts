import { describe, expect, it } from "vitest"
import { crumbLabel, intentToView, selectedEntity, popTo, pushView, viewKey } from "./nav-core.js"
import type { NavIntent } from "./navigation.js"
import type { CockpitView } from "../view-models.js"

/** A Camunda 7 id (a UUID) and a Camunda 8 key (a number on partition 1). */
const C7_ID = "5f0ce78e-1c4b-11ee-9f2a-0242ac120002"
const C8_KEY = "2251799813685249"

describe("intentToView", () => {
  it("maps every intent variant onto its view", () => {
    const cases: Array<[NavIntent, CockpitView]> = [
      [{ type: "overview" }, { section: "overview" }],
      [{ type: "incidents" }, { section: "incidents" }],
      [
        { type: "cluster-detail", activityId: "a1", incidentType: "failedJob" },
        {
          section: "cluster-detail",
          activityId: "a1",
          incidentType: "failedJob",
          messageSignature: undefined,
        },
      ],
      [
        { type: "process-detail", processDefinitionKey: "invoice" },
        { section: "process-detail", processDefinitionKey: "invoice" },
      ],
      [
        { type: "process-instances", processDefinitionKey: "invoice" },
        { section: "process-instances", processDefinitionKey: "invoice" },
      ],
      [
        { type: "instance-detail", processInstanceId: "pi-1" },
        { section: "instance-detail", processInstanceId: "pi-1" },
      ],
      [
        { type: "incident-detail", incidentId: "inc-1" },
        { section: "incident-detail", incidentId: "inc-1" },
      ],
      [
        { type: "jobs", processDefinitionKey: "invoice", failedOnly: true },
        { section: "jobs", processDefinitionKey: "invoice", failedOnly: true },
      ],
      [{ type: "jobs" }, { section: "jobs" }],
      // A board's tile names the view on its engine; the cockpit moves there.
      [
        { type: "board-target", engine: "prod-a", view: { section: "incidents" } },
        { section: "incidents" },
      ],
    ]
    for (const [intent, view] of cases) {
      expect(intentToView(intent)).toEqual(view)
    }
  })

  it("lands the process-incidents intent on the definition view, incident-focused", () => {
    expect(intentToView({ type: "process-incidents", processDefinitionKey: "invoice" })).toEqual({
      section: "process-detail",
      processDefinitionKey: "invoice",
      focus: "incidents",
    })
  })
})

describe("pushView", () => {
  const detail: CockpitView = { section: "process-detail", processDefinitionKey: "invoice" }
  const instances: CockpitView = { section: "process-instances", processDefinitionKey: "invoice" }

  it("appends a new drill view", () => {
    expect(pushView([detail], instances)).toEqual([detail, instances])
  })

  it("pops back to an existing entry instead of growing an A→B→A loop", () => {
    const stack = pushView(pushView([detail], instances), detail)
    expect(stack).toEqual([detail])
  })

  it("adopts the incoming params when popping back (detail → incidents focus)", () => {
    const focused: CockpitView = {
      section: "process-detail",
      processDefinitionKey: "invoice",
      focus: "incidents",
    }
    const stack = pushView(pushView([detail], instances), focused)
    expect(stack).toEqual([focused])
  })
})

describe("popTo", () => {
  const stack: CockpitView[] = [
    { section: "overview" },
    { section: "process-detail", processDefinitionKey: "invoice" },
    { section: "instance-detail", processInstanceId: "pi-1" },
  ]

  it("pops one step back by default", () => {
    expect(popTo(stack)).toHaveLength(2)
  })

  it("pops to an explicit index", () => {
    expect(popTo(stack, 0)).toEqual([{ section: "overview" }])
  })

  it("never empties the stack and clamps overshoots", () => {
    expect(popTo([{ section: "overview" }])).toHaveLength(1)
    expect(popTo(stack, 99)).toHaveLength(3)
  })
})

describe("viewKey", () => {
  it("keys the jobs by scope and filter, the history by instance", () => {
    expect(viewKey({ section: "jobs" })).toBe("jobs:*:all")
    expect(viewKey({ section: "jobs", processDefinitionKey: "invoice", failedOnly: true })).toBe(
      "jobs:invoice:failed",
    )
    expect(viewKey({ section: "history", processInstanceId: "pi-1" })).toBe("history:pi-1")
  })

  it("keys a board by its id, never its title", () => {
    expect(viewKey({ section: "board", board: "invoices", label: "Invoices" })).toBe(
      "board:invoices",
    )
  })

  it("stacks the engine's jobs and one process's failed jobs as two entries", () => {
    const engineJobs: CockpitView = { section: "jobs" }
    const processJobs: CockpitView = {
      section: "jobs",
      processDefinitionKey: "invoice",
      failedOnly: true,
    }
    expect(pushView([engineJobs], processJobs)).toEqual([engineJobs, processJobs])
  })
})

describe("crumbLabel", () => {
  it("names the jobs, and the history by its instance", () => {
    expect(crumbLabel({ section: "jobs", processDefinitionKey: "invoice" }, "en")).toBe("Jobs")
    expect(crumbLabel({ section: "jobs" }, "de")).toBe("Jobs")
    expect(crumbLabel({ section: "history", processInstanceId: C7_ID }, "en")).toBe(
      "History 5f0ce78e…",
    )
    expect(crumbLabel({ section: "history", processInstanceId: "pi-1" }, "de")).toBe("Verlauf pi-1")
  })

  // A Camunda 8 key's head is its partition's: every key on partition 1 starts with 22517998.
  it("names an instance, an incident and a history by the part of its id that tells it apart", () => {
    const crumbs = (id: string) => [
      crumbLabel({ section: "instance-detail", processInstanceId: id }, "en"),
      crumbLabel({ section: "incident-detail", incidentId: id }, "en"),
      crumbLabel({ section: "history", processInstanceId: id }, "en"),
    ]
    expect(crumbs(C7_ID)).toEqual(["Instance 5f0ce78e…", "Incident 5f0ce78e…", "History 5f0ce78e…"])
    expect(crumbs(C8_KEY)).toEqual([
      "Instance …13685249",
      "Incident …13685249",
      "History …13685249",
    ])
    expect(crumbs("2251799813685250")).not.toEqual(crumbs(C8_KEY))
    expect(crumbs("pi-1")).toEqual(["Instance pi-1", "Incident pi-1", "History pi-1"])
  })

  it("names an instance and an incident by the drill's label first", () => {
    const instance: CockpitView = {
      section: "instance-detail",
      processInstanceId: C8_KEY,
      label: "ORD-7",
    }
    const incident: CockpitView = {
      section: "incident-detail",
      incidentId: C8_KEY,
      label: "Charge payment",
    }
    expect(crumbLabel(instance, "en")).toBe("ORD-7")
    expect(crumbLabel(incident, "de")).toBe("Incident bei Charge payment")
  })

  it("names a board by its title, else its id", () => {
    expect(crumbLabel({ section: "board", board: "invoices", label: "Invoices" }, "en")).toBe(
      "Invoices",
    )
    expect(crumbLabel({ section: "board", board: "invoices" }, "de")).toBe("invoices")
  })
})

describe("selectedEntity", () => {
  it("names the view's selected entity by kind", () => {
    expect(selectedEntity({ section: "overview" })).toEqual({})
    expect(selectedEntity({ section: "incident-detail", incidentId: "inc-1" })).toEqual({
      incidentId: "inc-1",
    })
  })

  it("has none for the engine-wide instances view (no key)", () => {
    expect(selectedEntity({ section: "process-instances" })).toEqual({})
  })

  it("names the history's instance and a scoped job list's process", () => {
    expect(selectedEntity({ section: "history", processInstanceId: "pi-1" })).toEqual({
      processInstanceId: "pi-1",
    })
    expect(selectedEntity({ section: "jobs", processDefinitionKey: "invoice" })).toEqual({
      processDefinitionKey: "invoice",
    })
    expect(selectedEntity({ section: "jobs" })).toEqual({})
  })
})
