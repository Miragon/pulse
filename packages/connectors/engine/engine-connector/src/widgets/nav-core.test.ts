import { describe, expect, it } from "vitest"
import { truncate } from "@miragon/pulse-ui"
import { crumbLabel, intentToView, selectedEntity, popTo, pushView, viewKey } from "./nav-core.js"
import type { NavIntent } from "./navigation.js"
import type { CockpitView } from "../view-models.js"

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
    expect(crumbLabel({ section: "history", processInstanceId: "0123456789abcdef" }, "en")).toBe(
      `History ${truncate("0123456789abcdef", 8)}`,
    )
    expect(crumbLabel({ section: "history", processInstanceId: "pi-1" }, "de")).toBe("Verlauf pi-1")
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
