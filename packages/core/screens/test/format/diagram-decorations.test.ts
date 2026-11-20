import { describe, expect, test } from "vitest"
import { DiagramDecorations, type CallLinkData, type ElementBadgeData } from "../../src/index.js"
import { WORLD_SCREENS } from "../../src/testing/index.js"

const badge = (elementId: string, counts: Partial<ElementBadgeData>): ElementBadgeData => ({
  elementId,
  running: 0,
  incidents: 0,
  incidentsInCalledInstances: 0,
  ...counts,
})
const CALL: CallLinkData = { elementId: "Call", kind: "missing", bpmnProcessId: "label" }

describe("the decorations of a process's diagram", () => {
  test("give each element its counts above 0, root incidents first, each with the scope it filters", () => {
    const decorations = DiagramDecorations.of({
      badges: [badge("Task", { running: 3, incidents: 1, incidentsInCalledInstances: 2 })],
      calls: [],
    })

    expect(decorations).toStrictEqual([
      {
        elementId: "Task",
        counts: [
          { kind: "incidents", count: 1, scope: "withIncident" },
          { kind: "incidentsInCalledInstances", count: 2, scope: "withIncident" },
          { kind: "running", count: 3, scope: "running" },
        ],
        incident: true,
        call: null,
      },
    ])
  })

  test("mark an element only for its root incidents, never for incidents in called instances", () => {
    const [called, running] = DiagramDecorations.of({
      badges: [badge("Call", { incidentsInCalledInstances: 1 }), badge("Wait", { running: 1 })],
      calls: [],
    })

    expect(called).toMatchObject({
      incident: false,
      counts: [{ kind: "incidentsInCalledInstances" }],
    })
    expect(running).toMatchObject({ incident: false, counts: [{ kind: "running", count: 1 }] })
  })

  test("put a call activity's way beside its counts, and give one without counts a place of its own", () => {
    const decorations = DiagramDecorations.of({
      badges: [badge("Call", { running: 1 }), badge("Other", { running: 2 })],
      calls: [CALL, { ...CALL, elementId: "Quiet" }],
    })

    expect(decorations.map(({ elementId, call }) => [elementId, call?.elementId ?? null])).toEqual([
      ["Call", "Call"],
      ["Other", null],
      ["Quiet", "Quiet"],
    ])
    expect(decorations[2]).toStrictEqual({
      elementId: "Quiet",
      counts: [],
      incident: false,
      call: { ...CALL, elementId: "Quiet" },
    })
  })

  test("decorate the world's calling process at its call activity", () => {
    expect(DiagramDecorations.of(WORLD_SCREENS.callingProcess)).toStrictEqual([
      {
        elementId: "Activity_PrintShippingLabel",
        counts: [
          { kind: "incidentsInCalledInstances", count: 1, scope: "withIncident" },
          { kind: "running", count: 1, scope: "running" },
        ],
        incident: false,
        call: WORLD_SCREENS.callingProcess.calls[0],
      },
    ])
  })
})
