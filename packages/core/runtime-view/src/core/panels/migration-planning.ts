import {
  RuntimeError,
  type DefinitionId,
  type MigrationCheck,
  type MigrationPlan,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"

export class MigrationPlanning {
  static proposal(
    runtime: ProcessRuntime,
    source: DefinitionId,
    target: DefinitionId,
  ): Promise<MigrationPlan> {
    return runtime.proposeMigration?.(source, target) ?? MigrationPlanning.refused()
  }

  static check(runtime: ProcessRuntime, plan: MigrationPlan): Promise<MigrationCheck> {
    return runtime.checkMigration?.(plan) ?? MigrationPlanning.refused()
  }

  private static refused(): Promise<never> {
    return Promise.reject(
      new RuntimeError("unsupported", "This engine does not plan migrations of instances."),
    )
  }
}
