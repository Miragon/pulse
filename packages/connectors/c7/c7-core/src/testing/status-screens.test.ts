import { describe, expect, it } from "vitest"
import { C7_STATUS_ENGINE } from "./status-engine.js"
import { C7_STATUS_SCREENS } from "./status-screens.js"
import { C7_STATUS_WORLD } from "./status-world.js"

/**
 * The recorded status screens held to what they show, so a recording made anew in which the
 * multi-instance body's root incident left the element it repeats, or which another run than the
 * status engine's recorded, fails here before any wire builds it: the process screen, the instance
 * screen of the failing approval and the board's diagram each put the body's root incident on
 * `Activity_ApproveEach`, beside the items waiting there, and name no body as an element.
 */

interface Badge {
  readonly elementId: string
  readonly incidents: number
  readonly running?: number
  readonly active?: number
}

interface Screens {
  readonly process: { readonly bpmnProcessId: string; readonly badges: readonly Badge[] }
  readonly instance: {
    readonly instance: { readonly id: string; readonly businessKey: string | null }
    readonly markers: readonly { readonly elementId: string; readonly kind: string }[]
    readonly incidents: readonly { readonly elementId: string }[]
  }
  readonly board: {
    readonly engines: readonly { readonly name: string }[]
    readonly rows: readonly (readonly {
      readonly kind: string
      readonly badges?: readonly Badge[]
    }[])[]
  }
}

const { process, instance, board } = C7_STATUS_SCREENS.expected as Screens
const { processes, multiInstanceElement, items, instances } = C7_STATUS_WORLD
const BODY = `${multiInstanceElement}#multiInstanceBody`

describe("C7_STATUS_SCREENS", () => {
  it("holds the engine at history level full, read at the status engine's instant, its board one diagram", () => {
    expect(C7_STATUS_SCREENS.about).toMatch(/^\S.+\.$/)
    expect(C7_STATUS_SCREENS.engine).toBe("full")
    expect(C7_STATUS_SCREENS.asOf).toBe(C7_STATUS_ENGINE.asOf)
    expect(JSON.parse(C7_STATUS_SCREENS.text)).toEqual({
      schemaVersion: 1,
      title: "Approvals",
      engines: [C7_STATUS_SCREENS.engine],
      rows: [{ row: [{ widget: "processDiagram", props: { process: processes.approval } }] }],
    })
  })

  it("is the status engine's run: the failing approval is the instance its body's incident names", () => {
    const [full] = C7_STATUS_ENGINE.engines
    const groups = (
      full?.expected.engineStatus as {
        readonly incidents: readonly {
          readonly activityId: string
          readonly processInstanceIds: readonly string[]
        }[]
      }
    ).incidents
    const body = groups.find(({ activityId }) => activityId === BODY)
    expect(body?.processInstanceIds).toEqual([instance.instance.id])
    expect(instance.instance.businessKey).toBe(instances.failing)
  })

  it("puts the body's root incident on the element it repeats, beside its items, on the process screen", () => {
    expect(process.bpmnProcessId).toBe(processes.approval)
    expect(process.badges).toEqual([
      expect.objectContaining({ elementId: multiInstanceElement, incidents: 1, running: items }),
    ])
  })

  it("puts it on that element on the instance screen of the failing approval", () => {
    expect(instance.incidents.map(({ elementId }) => elementId)).toEqual([multiInstanceElement])
    expect(instance.markers).toContainEqual({ elementId: multiInstanceElement, kind: "incident" })
  })

  it("puts it on that element on the board's diagram, beside the items waiting there", () => {
    expect(board.engines.map(({ name }) => name)).toEqual([C7_STATUS_SCREENS.engine])
    const [diagram] = board.rows.flat()
    expect(diagram?.kind).toBe("processDiagram")
    expect(diagram?.badges).toEqual([
      expect.objectContaining({ elementId: multiInstanceElement, incidents: 1, active: items }),
    ])
  })

  it("names no multi-instance body as an element on any of them", () => {
    expect(JSON.stringify(C7_STATUS_SCREENS.expected)).not.toContain(`"elementId":"${BODY}"`)
  })
})
