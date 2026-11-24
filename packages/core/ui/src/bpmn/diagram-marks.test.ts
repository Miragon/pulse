import { describe, expect, it } from "vitest"
import {
  centredIdsOf,
  countedElements,
  drawnKeyOf,
  MARKER_CLASS,
  outlinesOf,
  shownCounts,
  type DiagramDecoration,
} from "./diagram-marks.js"

describe("shownCounts: the badges of an element", () => {
  it("orders them root incidents, incidents in called instances, running, whatever their order", () => {
    expect(
      shownCounts([
        { kind: "running", count: 3 },
        { kind: "incidentsInCalledInstances", count: 1 },
        { kind: "incidents", count: 2 },
      ]).map(({ kind }) => kind),
    ).toEqual(["incidents", "incidentsInCalledInstances", "running"])
  })

  it("shows no 0, no number that is none and no kind twice", () => {
    expect(
      shownCounts([
        { kind: "running", count: 0 },
        { kind: "incidents", count: Number.NaN },
        { kind: "incidentsInCalledInstances", count: -1 },
      ]),
    ).toEqual([])
    expect(
      shownCounts([
        { kind: "running", count: 4 },
        { kind: "running", count: 9 },
      ]),
    ).toEqual([{ kind: "running", count: 4 }])
  })

  it("keeps what rides along on a count (the screens' scope)", () => {
    const count = { kind: "incidents" as const, count: 1, scope: "withIncident" }
    expect(shownCounts([count])[0]).toBe(count)
  })
})

describe("countedElements", () => {
  it("lists each element with a count to show once, its first decoration", () => {
    const decorations: DiagramDecoration[] = [
      { elementId: "A", counts: [{ kind: "running", count: 2 }], incident: false },
      { elementId: "B", counts: [], incident: true },
      { elementId: "A", counts: [{ kind: "incidents", count: 5 }], incident: true },
      { elementId: "C", counts: [{ kind: "running", count: 0 }], incident: false },
    ]
    expect(countedElements(decorations)).toEqual([
      { elementId: "A", counts: [{ kind: "running", count: 2 }] },
    ])
  })
})

describe("outlinesOf: one outline an element", () => {
  it("outlines an own root incident only, never an element with counts alone", () => {
    expect(
      outlinesOf(
        [
          { elementId: "A", counts: [{ kind: "incidents", count: 1 }], incident: true },
          { elementId: "B", counts: [{ kind: "running", count: 4 }], incident: false },
          {
            elementId: "C",
            counts: [{ kind: "incidentsInCalledInstances", count: 2 }],
            incident: false,
          },
        ],
        [],
      ),
    ).toEqual([{ elementId: "A", kind: "incident" }])
  })

  it("keeps the strongest of an element's markers: an incident over an open task over a wait", () => {
    expect(
      outlinesOf(
        [],
        [
          { elementId: "Wait", kind: "running" },
          { elementId: "Task", kind: "running" },
          { elementId: "Task", kind: "openTask" },
          { elementId: "Failing", kind: "openTask" },
          { elementId: "Failing", kind: "incident" },
          { elementId: "Failing", kind: "running" },
        ],
      ),
    ).toEqual([
      { elementId: "Wait", kind: "running" },
      { elementId: "Task", kind: "openTask" },
      { elementId: "Failing", kind: "incident" },
    ])
  })

  it("lets a decoration's incident win over a marker of the same element", () => {
    expect(
      outlinesOf(
        [{ elementId: "A", counts: [], incident: true }],
        [{ elementId: "A", kind: "running" }],
      ),
    ).toEqual([{ elementId: "A", kind: "incident" }])
  })

  it("names the canvas's marker class of each kind", () => {
    expect(MARKER_CLASS).toEqual({
      running: "highlight-running",
      openTask: "highlight-open-user-task",
      incident: "highlight-incident",
    })
  })
})

describe("centredIdsOf: where the first zoom in centres", () => {
  const counted = [{ elementId: "Busy", counts: [{ kind: "running" as const, count: 9 }] }]

  it("takes the outlined elements of the strongest kind", () => {
    expect(
      centredIdsOf(
        [
          { elementId: "W", kind: "running" },
          { elementId: "T", kind: "openTask" },
          { elementId: "I1", kind: "incident" },
          { elementId: "I2", kind: "incident" },
        ],
        counted,
      ),
    ).toEqual(["I1", "I2"])
    expect(centredIdsOf([{ elementId: "W", kind: "running" }], counted)).toEqual(["W"])
  })

  it("else the elements with a count, else none", () => {
    expect(centredIdsOf([], counted)).toEqual(["Busy"])
    expect(centredIdsOf([], [])).toEqual([])
  })
})

describe("drawnKeyOf: when the diagram draws anew", () => {
  it("changes with the elements that have counts and with the outlines, not with a count's value", () => {
    const one = drawnKeyOf([{ elementId: "A", counts: [{ kind: "running", count: 1 }] }], [])
    const more = drawnKeyOf([{ elementId: "A", counts: [{ kind: "running", count: 7 }] }], [])
    expect(more).toBe(one)
    expect(drawnKeyOf([{ elementId: "B", counts: [] }], [])).not.toBe(one)
    expect(
      drawnKeyOf(
        [{ elementId: "A", counts: [{ kind: "running", count: 1 }] }],
        [{ elementId: "A", kind: "incident" }],
      ),
    ).not.toBe(one)
  })

  it("keeps the key when the same elements and outlines come in another order", () => {
    const running = (elementId: string, count: number) => ({
      elementId,
      counts: [{ kind: "running" as const, count }],
    })
    // The cockpit's feed sorts by the running count: a refresh that changes it reorders them.
    const before = drawnKeyOf(
      [running("Approve", 5), running("Ship", 4)],
      [
        { elementId: "Ship", kind: "incident" },
        { elementId: "Approve", kind: "incident" },
      ],
    )
    const after = drawnKeyOf(
      [running("Ship", 6), running("Approve", 3)],
      [
        { elementId: "Approve", kind: "incident" },
        { elementId: "Ship", kind: "incident" },
      ],
    )
    expect(after).toBe(before)
  })
})
