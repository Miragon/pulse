import { describe, expect, it } from "vitest"
import { buildHeatPoints, type BpmnElement } from "./heat-utils.js"

const shape = (id: string, type = "bpmn:ServiceTask"): BpmnElement => ({
  id,
  x: 100,
  y: 100,
  width: 100,
  height: 80,
  businessObject: { id, $type: type },
})

/** A key matching nothing gives an UNCOLORED diagram, not an error, so the activity_id ↔ element id matching is pinned here. */
describe("buildHeatPoints", () => {
  it("stamps one centred point per element carrying a positive value", () => {
    const points = buildHeatPoints([shape("Activity_A")], { Activity_A: 2548 }, {})
    expect(points).toEqual([{ x: 150, y: 140, weight: 2548 }])
  })

  it("produces nothing when no key matches a diagram element", () => {
    expect(buildHeatPoints([shape("Activity_A")], { Fremd_X: 100 }, {})).toEqual([])
    expect(buildHeatPoints([shape("Activity_A")], {}, {})).toEqual([])
  })

  it("skips zero values — a map of zeros must read as no data, not as cold heat", () => {
    expect(buildHeatPoints([shape("Activity_A")], { Activity_A: 0 }, {})).toEqual([])
  })

  it("skips label elements so an activity is not stamped twice", () => {
    const target = shape("Activity_A")
    const label: BpmnElement = { ...target, type: "label", y: 190, labelTarget: target }
    expect(buildHeatPoints([target, label], { Activity_A: 5 }, {})).toHaveLength(1)
  })

  it("skips structural elements that would blanket the diagram", () => {
    const pool = shape("Participant_1", "bpmn:Participant")
    expect(buildHeatPoints([pool], { Participant_1: 999 }, {})).toEqual([])
  })

  it("samples a sequence flow along its waypoints when the edge carries flow", () => {
    const flow: BpmnElement = {
      id: "Flow_1",
      waypoints: [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
      ],
      businessObject: {
        id: "Flow_1",
        $type: "bpmn:SequenceFlow",
        sourceRef: { id: "Activity_A" },
        targetRef: { id: "Activity_B" },
      },
    }
    const points = buildHeatPoints([flow], {}, { "Activity_A->Activity_B": 12 })
    expect(points.length).toBeGreaterThan(1)
    expect(points.every((p) => p.weight === 12 && p.y === 0)).toBe(true)
    // Metrics carry no per-instance path — an absent edge stays cold.
    expect(buildHeatPoints([flow], {}, {})).toEqual([])
  })
})
