import {
  BulkOperationId,
  InstanceId,
  RuntimeError,
  type CancelOptions,
  type IncidentId,
  type MigrationPlan,
  type ProcessCommands,
  type RuntimeFailure,
  type TokenMove,
  type VariableChange,
} from "../../contract/index.js"
import { ErrorTranslation } from "./errors/error-translation.js"
import type { EngineClient, EngineWriter } from "./engine-cli/index.js"
import { CancelBody } from "./writing/cancel-body.js"
import { MigrationBody } from "./writing/migration-body.js"
import { MoveBody } from "./writing/move-body.js"
import { Redaction } from "./writing/redaction.js"
import { SourceToken } from "./writing/source-token.js"
import { VariableBody } from "./writing/variable-body.js"

const NOT_STARTED_WHEN: ReadonlySet<RuntimeFailure> = new Set<RuntimeFailure>([
  "unreachable",
  "unexpectedResponse",
  "engineFailure",
])

export class C7ProcessCommands implements ProcessCommands {
  constructor(
    private readonly writer: EngineWriter,
    private readonly client: EngineClient,
  ) {}

  retryIncident(incidentId: IncidentId): Promise<void> {
    return ErrorTranslation.commanded(() => this.retry(incidentId))
  }

  setVariable(instanceId: InstanceId, change: VariableChange): Promise<void> {
    return ErrorTranslation.commanded(
      () => this.writer.setVariable(instanceId, change.name, VariableBody.of(change)),
      Redaction.ofValue(change.valueJson),
    )
  }

  moveToken(instanceId: InstanceId, move: TokenMove): Promise<void> {
    return ErrorTranslation.commanded(
      () => this.move(instanceId, move),
      Redaction.ofText(move.reason),
    )
  }

  cancelInstances(
    instanceIds: readonly InstanceId[],
    options?: CancelOptions,
  ): Promise<BulkOperationId> {
    return ErrorTranslation.submitted(async () => {
      const batch = await this.writer.deleteInstancesAsync(CancelBody.of(instanceIds, options))
      return BulkOperationId(batch.id)
    }, Redaction.ofText(options?.reason))
  }

  async migrateInstances(
    plan: MigrationPlan,
    instanceIds: readonly InstanceId[],
  ): Promise<BulkOperationId> {
    const running = await this.runningOrNotStarted(plan, instanceIds)
    if (running.length === 0) {
      throw new RuntimeError(
        "rejected",
        `Nothing left to migrate: none of the ${instanceIds.length} instances runs on ${plan.sourceDefinitionId}.`,
      )
    }
    return ErrorTranslation.submitted(async () => {
      const batch = await this.writer.migrateInstancesAsync(MigrationBody.of(plan, running))
      return BulkOperationId(batch.id)
    }, Redaction.NOTHING)
  }

  stopBulkOperation(bulkOperationId: BulkOperationId): Promise<void> {
    return ErrorTranslation.commanded(async () => {
      await this.unlessHalted(bulkOperationId, () => this.writer.suspendBatch(bulkOperationId))
      await this.unlessHalted(bulkOperationId, () => this.writer.deleteBatch(bulkOperationId))
    })
  }

  private async retry(incidentId: IncidentId): Promise<void> {
    const outcome = await this.writer.retryIncident(incidentId)
    if (outcome.retried < 1) {
      const reason = outcome.results.join(", ") || "nothing to retry"
      throw new RuntimeError(
        "rejected",
        `The engine did not retry incident ${incidentId}: ${reason}.`,
      )
    }
  }

  private async move(instanceId: InstanceId, move: TokenMove): Promise<void> {
    MoveBody.checked(move)
    const tree = await ErrorTranslation.unlessMissing(() =>
      this.client.activityInstances(instanceId),
    )
    if (tree === undefined) {
      throw new RuntimeError("rejected", `Instance ${instanceId} is not running.`)
    }
    const source = SourceToken.in(tree, move.fromElementId)
    await this.writer.modify(instanceId, MoveBody.of(move, source))
  }

  private async runningOrNotStarted(
    plan: MigrationPlan,
    instanceIds: readonly InstanceId[],
  ): Promise<InstanceId[]> {
    try {
      return await ErrorTranslation.translated(() => this.runningOn(plan, instanceIds))
    } catch (error: unknown) {
      if (!RuntimeError.is(error) || !NOT_STARTED_WHEN.has(error.failure)) {
        throw error
      }
      throw new RuntimeError(
        "rejected",
        `Pulse could not check which instances still run on ${plan.sourceDefinitionId}, so it submitted nothing: ${error.message}`,
        { cause: error },
      )
    }
  }

  private async runningOn(
    plan: MigrationPlan,
    instanceIds: readonly InstanceId[],
  ): Promise<InstanceId[]> {
    if (instanceIds.length === 0) {
      return []
    }
    const instances = await this.client.historicInstances(
      {
        processDefinitionId: plan.sourceDefinitionId,
        processInstanceIds: instanceIds,
        unfinished: true,
      },
      { firstResult: 0, maxResults: instanceIds.length },
    )
    return instances.map((instance) => InstanceId(instance.id))
  }

  private async unlessHalted(batchId: string, step: () => Promise<void>): Promise<void> {
    try {
      await step()
    } catch (error: unknown) {
      if (!ErrorTranslation.isRefusal(error) || !(await this.isHalted(batchId))) {
        throw error
      }
    }
  }

  private async isHalted(batchId: string): Promise<boolean> {
    const running = await this.client.batchStatistics(batchId)
    if (running !== undefined) {
      return running.suspended
    }
    const ended = await ErrorTranslation.unlessMissing(() => this.client.historicBatch(batchId))
    return ended !== undefined
  }
}
