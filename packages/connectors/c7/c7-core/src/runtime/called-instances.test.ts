import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import type { ChildView, TimelineEntry } from "../types.js"
import { calledInstanceOf } from "./called-instances.js"

const CHILD: ChildView = { id: "c1", parentId: "p1", key: "label", state: "ACTIVE" }

function step(activityId: string, calledProcessInstanceId?: string): TimelineEntry {
  return {
    activityId,
    activityType: "callActivity",
    startTime: "2026-10-21T18:44:04.587+0000",
    ...(calledProcessInstanceId === undefined ? {} : { calledProcessInstanceId }),
  }
}

describe("calledInstanceOf", () => {
  it("names the call activity of the parent's path that started the instance", () => {
    const path = [step("Activity_Pack"), step("Activity_Other", "c0"), step("Activity_Print", "c1")]

    expect(calledInstanceOf(CHILD, path)).toStrictEqual({
      id: "c1",
      parentInstanceId: "p1",
      bpmnProcessId: "label",
      tenantId: null,
      state: "running",
      calledFromElementId: "Activity_Print",
    })
  })

  it("names no element when the path holds no call of the instance", () => {
    expect(
      calledInstanceOf({ ...CHILD, state: "SUSPENDED" }, [step("Activity_Pack")]),
    ).toStrictEqual({
      id: "c1",
      parentInstanceId: "p1",
      bpmnProcessId: "label",
      tenantId: null,
      state: "suspended",
    })
    expect(calledInstanceOf(CHILD, [])).not.toHaveProperty("calledFromElementId")
  })

  it("names the tenant of the called instance's version", () => {
    expect(calledInstanceOf({ ...CHILD, tenantId: "acme" }, []).tenantId).toBe("acme")
  })

  it("fails on a state no engine writes", () => {
    const odd = { ...CHILD, state: "PAUSED" } as unknown as ChildView

    expect(() => calledInstanceOf(odd, [])).toThrow(RuntimeError)
  })
})
