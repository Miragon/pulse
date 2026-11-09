import type { BulkFailure, BulkOperation } from "./model/bulk-operations.js"
import type { MigrationCheck, MigrationPlan } from "./model/migrations.js"
import type { Page } from "./model/queries.js"
import type {
  CalledProcess,
  DefinitionSummary,
  ElementStatistics,
  EngineInfo,
  Incident,
  IncidentDetails,
  InstanceDetail,
  InstanceSummary,
  VersionSummary,
} from "./model/read-models.js"
import { RuntimeError } from "./model/runtime-error.js"
import type { ProcessRuntime } from "./ports/process-runtime.js"

export class FailingRuntime implements ProcessRuntime {
  constructor(private readonly error: RuntimeError) {}

  static unreachable(endpoint: string): FailingRuntime {
    return new FailingRuntime(
      new RuntimeError("unreachable", `Cannot reach the engine at ${endpoint}`),
    )
  }

  describeEngine(): Promise<EngineInfo> {
    return this.fail()
  }

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    return this.fail()
  }

  listVersions(): Promise<readonly VersionSummary[]> {
    return this.fail()
  }

  getDiagramXml(): Promise<string | undefined> {
    return this.fail()
  }

  getElementStatistics(): Promise<readonly ElementStatistics[]> {
    return this.fail()
  }

  getCalledProcesses(): Promise<readonly CalledProcess[]> {
    return this.fail()
  }

  searchInstances(): Promise<Page<InstanceSummary>> {
    return this.fail()
  }

  countInstances(): Promise<number> {
    return this.fail()
  }

  listVariableNames(): Promise<readonly string[]> {
    return this.fail()
  }

  getInstanceDetail(): Promise<InstanceDetail | undefined> {
    return this.fail()
  }

  searchIncidents(): Promise<Page<Incident>> {
    return this.fail()
  }

  getIncidentDetails(): Promise<IncidentDetails | undefined> {
    return this.fail()
  }

  getBulkOperation(): Promise<BulkOperation | undefined> {
    return this.fail()
  }

  getBulkFailures(): Promise<readonly BulkFailure[]> {
    return this.fail()
  }

  proposeMigration(): Promise<MigrationPlan> {
    return this.fail()
  }

  checkMigration(): Promise<MigrationCheck> {
    return this.fail()
  }

  private fail(): Promise<never> {
    return Promise.reject(this.error)
  }
}
