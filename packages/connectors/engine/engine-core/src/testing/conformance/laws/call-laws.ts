import type { CalledProcess } from "../../../model/read-models.js"
import { Ensure } from "../ensure.js"
import { CASE, type ConformanceCase } from "../conformance-case.js"
import { WORLD_CALL, WORLD_PROCESS } from "../world/world.js"

class CallReads {
  static described(calls: readonly CalledProcess[]): string {
    return Ensure.describe(
      calls.map((call) => ({
        elementId: call.elementId,
        bpmnProcessId: call.bpmnProcessId,
        tenantId: call.tenantId,
        definitionId: call.definition?.id,
        version: call.definition?.version,
        definitionTenantId: call.definition?.tenantId,
      })),
    )
  }
}

const callsResolveTheCalledVersion: ConformanceCase = {
  name: CASE.callsResolveTheCalledVersion,
  async run(harness) {
    const { definitionIds } = harness.world
    const calls = await harness.runtime.getCalledProcesses({
      id: definitionIds["dispatch@1"],
      tenantId: null,
    })
    const expected = Ensure.describe([
      {
        elementId: WORLD_CALL.elementId,
        bpmnProcessId: WORLD_PROCESS[WORLD_CALL.called],
        tenantId: null,
        definitionId: definitionIds["label@1"],
        version: 1,
        definitionTenantId: null,
      },
    ])
    Ensure.that(
      CallReads.described(calls) === expected,
      this.name,
      `dispatch expected ${expected}, got ${CallReads.described(calls)}`,
    )
    const none = await harness.runtime.getCalledProcesses({
      id: definitionIds["order@1"],
      tenantId: null,
    })
    Ensure.that(none.length === 0, this.name, `order calls ${CallReads.described(none)}`)
  },
}

export const CALL_LAWS: readonly ConformanceCase[] = [callsResolveTheCalledVersion]
