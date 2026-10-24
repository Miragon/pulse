import type { DefinitionId, MigrationCheck, MigrationPlan } from "../../../contract/index.js"
import type { EngineClient } from "../engine-cli/index.js"
import type { MigrationCheckMapper } from "../mapping/migration-check-mapper.js"
import type { MigrationPlanMapper } from "../mapping/migration-plan-mapper.js"
import type { MigrationRequestMapper } from "../mapping/migration-request-mapper.js"

export interface MigrationMappers {
  readonly plans: MigrationPlanMapper
  readonly requests: MigrationRequestMapper
  readonly checks: MigrationCheckMapper
}

export class MigrationReader {
  constructor(
    private readonly client: EngineClient,
    private readonly mappers: MigrationMappers,
  ) {}

  async proposal(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan> {
    return this.mappers.plans.map(await this.client.migrationPlan(source, target))
  }

  async check(plan: MigrationPlan): Promise<MigrationCheck> {
    return this.mappers.checks.map(
      await this.client.migrationReport(this.mappers.requests.map(plan)),
    )
  }
}
