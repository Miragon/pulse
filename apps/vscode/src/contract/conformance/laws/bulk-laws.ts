import type { BulkOperation } from "../../model/bulk-operations.js"
import type { BulkOperationId, InstanceId } from "../../model/ids.js"
import type { InstanceState } from "../../model/read-models.js"
import { Ensure } from "../ensure.js"
import {
  COMMAND_CASE,
  type CommandConformanceCase,
  type CommandHarness,
} from "../command-harness.js"

const PAGE = { limit: 100 } as const
const SETTLE_MS = 2_000

class BulkSteps {
  static async operation(
    harness: CommandHarness,
    id: BulkOperationId,
    law: string,
  ): Promise<BulkOperation> {
    const operation = Ensure.defined(
      await harness.runtime.getBulkOperation(id),
      law,
      `the operation ${id} is unknown`,
    )
    const worked = (operation.completed ?? 0) + (operation.failed ?? 0)
    Ensure.that(
      operation.total === undefined || worked <= operation.total,
      law,
      `${worked} of ${operation.total} items are reported as worked off`,
    )
    return operation
  }

  static async ended(harness: CommandHarness, id: BulkOperationId, law: string): Promise<void> {
    await Ensure.eventually(async () => {
      const operation = await BulkSteps.operation(harness, id, law)
      Ensure.that(operation.state === "ended", law, `the operation is still ${operation.state}`)
    }, harness.asyncWork)
  }

  static async states(
    harness: CommandHarness,
    ids: readonly InstanceId[],
  ): Promise<ReadonlyMap<InstanceId, InstanceState>> {
    const page = await harness.runtime.searchInstances({ instanceIds: ids }, PAGE)
    return new Map(page.items.map((instance) => [instance.id, instance.state]))
  }

  static async terminated(
    harness: CommandHarness,
    ids: readonly InstanceId[],
  ): Promise<InstanceId[]> {
    const states = await BulkSteps.states(harness, ids)
    return ids.filter((id) => states.get(id) === "terminated")
  }

  static async stateOf(
    harness: CommandHarness,
    id: InstanceId,
  ): Promise<InstanceState | undefined> {
    return (await harness.runtime.getInstanceDetail(id))?.instance.state
  }
}

const bulkCancelEndsExactly: CommandConformanceCase = {
  name: COMMAND_CASE.bulkCancelEndsExactly,
  async run(harness) {
    const ids = harness.world.bulkInstanceIds.cancel
    const id = await harness.commands.cancelInstances(ids, { reason: "conformance" })
    await BulkSteps.ended(harness, id, this.name)
    await Ensure.eventually(async () => {
      const terminated = await BulkSteps.terminated(harness, ids)
      Ensure.that(
        terminated.length === ids.length,
        this.name,
        `${terminated.length} of ${ids.length} instances were cancelled`,
      )
    }, harness.writeVisibility)
    const neighbour = await BulkSteps.stateOf(harness, harness.world.instanceIds["CMD-EDIT"])
    Ensure.that(neighbour === "running", this.name, `CMD-EDIT is ${neighbour}`)
    const operation = await BulkSteps.operation(harness, id, this.name)
    Ensure.that((operation.failed ?? 0) === 0, this.name, `${operation.failed} items failed`)
  },
}

const bulkSkipsEnded: CommandConformanceCase = {
  name: COMMAND_CASE.bulkSkipsEnded,
  async run(harness) {
    const ended = harness.world.instanceIds["CMD-ENDED"]
    const id = await harness.commands.cancelInstances([ended, harness.world.unknown.instanceId])
    await BulkSteps.ended(harness, id, this.name)
    const operation = await BulkSteps.operation(harness, id, this.name)
    Ensure.that((operation.failed ?? 0) === 0, this.name, `${operation.failed} items failed`)
    const state = await BulkSteps.stateOf(harness, ended)
    Ensure.that(state === "completed", this.name, `CMD-ENDED is ${state}`)
  },
}

const bulkStopHalts: CommandConformanceCase = {
  name: COMMAND_CASE.bulkStopHalts,
  async run(harness) {
    const ids = harness.world.bulkInstanceIds.stop
    const id = await harness.commands.cancelInstances(ids)
    await Ensure.eventually(async () => {
      await BulkSteps.operation(harness, id, this.name)
    }, harness.writeVisibility)
    await harness.commands.stopBulkOperation(id)
    await Ensure.eventually(async () => {
      const operation = await BulkSteps.operation(harness, id, this.name)
      Ensure.that(operation.state !== "running", this.name, "the operation runs on after Stop")
    }, harness.writeVisibility)
    await Ensure.eventually(async () => {
      const before = await BulkSteps.terminated(harness, ids)
      await harness.asyncWork?.wait(SETTLE_MS)
      await BulkSteps.operation(harness, id, this.name)
      Ensure.sameSet(await BulkSteps.terminated(harness, ids), before, this.name)
    }, harness.asyncWork)
    const states = await BulkSteps.states(harness, ids)
    const untouched = ids.filter((instanceId) => states.get(instanceId) !== "terminated")
    Ensure.that(
      untouched.every((instanceId) => states.get(instanceId) === "running"),
      this.name,
      "an instance the stopped operation did not reach is no longer running",
    )
    await harness.commands.stopBulkOperation(id)
  },
}

const bulkUnknown: CommandConformanceCase = {
  name: COMMAND_CASE.bulkUnknown,
  async run(harness) {
    const unknown = harness.world.unknown.bulkOperationId
    const operation = await harness.runtime.getBulkOperation(unknown)
    Ensure.that(operation === undefined, this.name, `got ${Ensure.describe(operation)}`)
    await Ensure.rejected(
      harness.commands.stopBulkOperation(unknown),
      this.name,
      "stopping an unknown operation",
    )
  },
}

export const BULK_LAWS: readonly CommandConformanceCase[] = [
  bulkCancelEndsExactly,
  bulkSkipsEnded,
  bulkStopHalts,
  bulkUnknown,
]
