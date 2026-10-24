import type { BulkOperation } from "../../model/bulk-operations.js"
import type { BulkOperationId, DefinitionId, InstanceId } from "../../model/ids.js"
import type { MigrationPlan } from "../../model/migrations.js"
import {
  COMMAND_CASE,
  type CommandConformanceCase,
  type CommandHarness,
} from "../command-harness.js"
import { Ensure } from "../ensure.js"
import { WORLD_ELEMENT, WORLD_MIGRATION } from "../world/world.js"

interface Footprint {
  readonly waitingAt: readonly string[]
  readonly hasIncident: boolean
}

class MigrationSteps {
  static source(harness: CommandHarness): DefinitionId {
    return harness.world.definitionIds[WORLD_MIGRATION.source]
  }

  static target(harness: CommandHarness): DefinitionId {
    return harness.world.definitionIds[WORLD_MIGRATION.target]
  }

  static proposal(harness: CommandHarness): Promise<MigrationPlan> {
    return harness.runtime.proposeMigration(
      MigrationSteps.source(harness),
      MigrationSteps.target(harness),
    )
  }

  static async workedOff(
    harness: CommandHarness,
    id: BulkOperationId,
    law: string,
  ): Promise<BulkOperation> {
    let workedOff: BulkOperation | undefined
    await Ensure.eventually(async () => {
      const operation = Ensure.defined(
        await harness.runtime.getBulkOperation(id),
        law,
        `the operation ${id} is unknown`,
      )
      const worked = (operation.completed ?? 0) + (operation.failed ?? 0)
      const done = operation.total !== undefined && operation.total > 0 && worked >= operation.total
      Ensure.that(
        operation.state === "ended" || done,
        law,
        `the operation is still ${operation.state} with ${worked} of ${operation.total} worked off`,
      )
      workedOff = operation
    }, harness.asyncWork)
    const operation = Ensure.defined(workedOff, law, "the operation was never worked off")
    Ensure.that(
      operation.kind === "migrateInstances",
      law,
      `the operation is of kind ${operation.kind}`,
    )
    return operation
  }

  static count(
    harness: CommandHarness,
    definitionId: DefinitionId,
    instanceIds: readonly InstanceId[],
  ): Promise<number> {
    return harness.runtime.countInstances({ definitionId, instanceIds, lifecycle: "running" })
  }

  static async footprints(
    harness: CommandHarness,
    ids: readonly InstanceId[],
  ): Promise<ReadonlyMap<InstanceId, Footprint>> {
    const details = await Promise.all(ids.map((id) => harness.runtime.getInstanceDetail(id)))
    return new Map(
      details.flatMap((detail) =>
        detail === undefined
          ? []
          : [
              [
                detail.instance.id,
                {
                  waitingAt: detail.waitStates.map((wait) => wait.elementId).sort(),
                  hasIncident: detail.instance.hasIncident,
                },
              ],
            ],
      ),
    )
  }
}

const migrationMovesExactly: CommandConformanceCase = {
  name: COMMAND_CASE.migrationMovesExactly,
  async run(harness) {
    const ids = harness.world.migrationInstanceIds.whole
    const before = await MigrationSteps.footprints(harness, ids)
    const id = await harness.commands.migrateInstances(await MigrationSteps.proposal(harness), ids)
    const operation = await MigrationSteps.workedOff(harness, id, this.name)
    Ensure.that((operation.failed ?? 0) === 0, this.name, `${operation.failed} items failed`)
    await Ensure.eventually(async () => {
      const moved = await MigrationSteps.count(harness, MigrationSteps.target(harness), ids)
      Ensure.that(moved === ids.length, this.name, `${moved} of ${ids.length} are on the target`)
    }, harness.writeVisibility)
    const after = await MigrationSteps.footprints(harness, ids)
    Ensure.that(
      Ensure.describe([...after]) === Ensure.describe([...before]),
      this.name,
      `before ${Ensure.describe([...before])}, after ${Ensure.describe([...after])}`,
    )
    const stay = harness.world.migrationInstanceIds.stay
    const stayed = await MigrationSteps.count(harness, MigrationSteps.source(harness), stay)
    Ensure.that(stayed === stay.length, this.name, "an instance that was not given moved too")
  },
}

const migrationReportsFailures: CommandConformanceCase = {
  name: COMMAND_CASE.migrationReportsFailures,
  async run(harness) {
    const proposal = await MigrationSteps.proposal(harness)
    const plan: MigrationPlan = {
      ...proposal,
      mappings: proposal.mappings.filter(
        (mapping) => mapping.sourceElementId !== WORLD_ELEMENT.reviewOrder,
      ),
    }
    const ids = harness.world.migrationInstanceIds.partial
    const id = await harness.commands.migrateInstances(plan, ids)
    await MigrationSteps.workedOff(harness, id, this.name)
    await Ensure.eventually(async () => {
      const stayed = await MigrationSteps.count(harness, MigrationSteps.source(harness), ids)
      const moved = await MigrationSteps.count(harness, MigrationSteps.target(harness), ids)
      Ensure.that(
        stayed === 2 && moved === 1,
        this.name,
        `${stayed} stayed on the source and ${moved} moved; expected 2 and 1`,
      )
    }, harness.writeVisibility)
    const failures = await harness.runtime.getBulkFailures(id)
    Ensure.that(
      failures.length > 0 &&
        failures.every(
          (failure) =>
            failure.reason.trim() !== "" &&
            (failure.instanceId === undefined || ids.includes(failure.instanceId)),
        ),
      this.name,
      `expected reasons naming only submitted instances, got ${Ensure.describe(failures)}`,
    )
    await harness.commands.stopBulkOperation(id)
  },
}

const migrationSkipsEnded: CommandConformanceCase = {
  name: COMMAND_CASE.migrationSkipsEnded,
  async run(harness) {
    const plan = await MigrationSteps.proposal(harness)
    const ended = harness.world.instanceIds["CMD-ENDED"]
    const gone = [ended, harness.world.unknown.instanceId]
    const running = harness.world.migrationInstanceIds.skip
    const id = await harness.commands.migrateInstances(plan, [...gone, ...running])
    const operation = await MigrationSteps.workedOff(harness, id, this.name)
    Ensure.that((operation.failed ?? 0) === 0, this.name, `${operation.failed} items failed`)
    await Ensure.eventually(async () => {
      const moved = await MigrationSteps.count(harness, MigrationSteps.target(harness), running)
      Ensure.that(moved === running.length, this.name, `${moved} of ${running.length} moved`)
    }, harness.writeVisibility)
    const state = (await harness.runtime.getInstanceDetail(ended))?.instance.state
    Ensure.that(state === "completed", this.name, `CMD-ENDED is ${state}`)
    await Ensure.rejected(
      harness.commands.migrateInstances(plan, gone).then(() => undefined),
      this.name,
      "migrating only ended and unknown instances",
    )
  },
}

export const MIGRATION_LAWS: readonly CommandConformanceCase[] = [
  migrationMovesExactly,
  migrationReportsFailures,
  migrationSkipsEnded,
]
