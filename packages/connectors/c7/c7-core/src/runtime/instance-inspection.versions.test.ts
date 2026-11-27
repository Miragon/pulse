import { describe, expect, it } from "vitest"
import { fakePort } from "../testing/fake-port.js"
import { C, CHILD_DEF, historyDto, P, PARENT_DEF } from "../testing/fixture.js"
import { approveRoutes } from "../testing/inspect-routes.js"
import { InstanceInspection } from "./instance-inspection.js"

/**
 * The version each running instance of the inspected tree runs: what the rounds read of the
 * runtime (each instance's definition and the definitions of the tree), with no request more.
 */
describe("InstanceInspection of the tree's versions", () => {
  it("names the version of the instance and of each instance it called, from the runtime", async () => {
    const port = fakePort(approveRoutes())

    const view = await new InstanceInspection(port).inspect(P)

    expect(view?.versions).toStrictEqual(
      new Map([
        [P, { id: PARENT_DEF, bpmnProcessId: "workflow-parent", version: 1 }],
        [C, { id: CHILD_DEF, bpmnProcessId: "workflow-child", version: 1, name: "Child" }],
      ]),
    )
    expect(port.calls.map((call) => call.operationId)).not.toContain(
      "queryHistoricProcessInstances",
    )
  })

  it("names none for an instance that no longer runs", async () => {
    const ended = { ...historyDto, state: "COMPLETED", endTime: "2026-10-09T13:40:00.000+0000" }
    const port = fakePort({
      ...approveRoutes(),
      getProcessInstance: () => undefined,
      getHistoricProcessInstance: () => ended,
      getHistoricActivityInstances: () => [],
      getHistoricVariableInstances: () => [],
    })

    const view = await new InstanceInspection(port).inspect(P)

    expect(view?.state).toBe("COMPLETED")
    expect(view?.versions).toStrictEqual(new Map())
  })
})
