import { InstanceId, type InstanceSummary } from "../../../src/contract/index.js"
import { Labels } from "../../../src/core/index.js"
import type { Connection } from "../../../src/host/connections/connection.js"
import type { FoundInstance } from "../protocol.js"

const MATCH_LIMIT = 20

export class InstanceFinder {
  static async find(connection: Connection, query: string): Promise<readonly FoundInstance[]> {
    const trimmed = query.trim()
    if (trimmed === "") {
      return []
    }
    const direct = await connection.runtime
      .getInstanceDetail(InstanceId(trimmed))
      .catch(() => undefined)
    if (direct !== undefined) {
      return [InstanceFinder.rowOf(direct.instance)]
    }
    const page = await connection.runtime.searchInstances(
      { businessKey: trimmed },
      { limit: MATCH_LIMIT },
    )
    return page.items.map((instance) => InstanceFinder.rowOf(instance))
  }

  private static rowOf(instance: InstanceSummary): FoundInstance {
    const definition = instance.definition
    return {
      instanceId: instance.id,
      label: instance.businessKey ?? Labels.shortId(instance.id),
      description: `${definition.name ?? definition.bpmnProcessId} v${definition.version} · ${instance.state}`,
    }
  }
}
