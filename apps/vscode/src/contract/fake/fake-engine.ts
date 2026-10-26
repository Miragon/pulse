import type { BulkFailure, BulkOperation } from "../model/bulk-operations.js"
import type {
  BpmnProcessId,
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
} from "../model/ids.js"
import type { MigrationCheck, MigrationPlan } from "../model/migrations.js"
import type { IncidentFilter, InstanceFilter, Page, PageRequest } from "../model/queries.js"
import type {
  CalledInstance,
  CalledProcess,
  DefinitionSummary,
  ElementStatistics,
  EngineInfo,
  Incident,
  IncidentDetails,
  InstanceDetail,
  InstanceSummary,
  VersionSummary,
} from "../model/read-models.js"
import type { ProcessCommands, TokenMove, VariableChange } from "../ports/process-commands.js"
import type { ProcessRuntime } from "../ports/process-runtime.js"
import { FakeBulkWork, type FakeSubmission } from "./fake-bulk-work.js"
import type { FakeDefinition, FakeEngineState, FakeInstance } from "./fake-engine-state.js"
import { FakeMigration } from "./fake-migration.js"
import { FakeMove } from "./fake-move.js"
import { FakeQueries } from "./fake-queries.js"
import { FakeTransitions } from "./fake-transitions.js"

export class FakeEngine implements ProcessRuntime, ProcessCommands {
  constructor(private state: FakeEngineState) {}

  describeEngine(): Promise<EngineInfo> {
    return Promise.resolve(this.state.engine)
  }

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    return Promise.resolve(this.definitionSummaries())
  }

  listVersions(bpmnProcessId: BpmnProcessId): Promise<readonly VersionSummary[]> {
    return Promise.resolve(this.versionsOf(bpmnProcessId))
  }

  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return Promise.resolve(
      this.state.definitions.find((definition) => definition.ref.id === definitionId)?.xml,
    )
  }

  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]> {
    return Promise.resolve(this.queries().elementStatistics(definitionId))
  }

  getCalledProcesses(definitionId: DefinitionId): Promise<readonly CalledProcess[]> {
    const caller = this.state.definitions.find((definition) => definition.ref.id === definitionId)
    return Promise.resolve(
      (caller?.calls ?? []).map((call) => {
        const latest = this.versionsOf(call.bpmnProcessId)[0]?.definition
        return latest === undefined ? call : { ...call, definition: latest }
      }),
    )
  }

  searchInstances(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    return Promise.resolve(FakeQueries.pageOf(this.queries().instances(filter), page))
  }

  countInstances(filter: InstanceFilter): Promise<number> {
    return Promise.resolve(this.queries().instances(filter).length)
  }

  getInstanceDetail(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
    return Promise.resolve(this.instanceDetail(instanceId))
  }

  searchIncidents(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    return Promise.resolve(FakeQueries.pageOf(this.queries().incidents(filter), page))
  }

  getIncidentDetails(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    return Promise.resolve(
      this.state.incidents.find(({ incident }) => incident.id === incidentId)?.fullDetails,
    )
  }

  retryIncident(incidentId: IncidentId): Promise<void> {
    return this.apply(() => new FakeTransitions(this.state).retried(incidentId))
  }

  setVariable(instanceId: InstanceId, change: VariableChange): Promise<void> {
    return this.apply(() => new FakeTransitions(this.state).withVariable(instanceId, change))
  }

  moveToken(instanceId: InstanceId, move: TokenMove): Promise<void> {
    return this.apply(() => new FakeMove(this.state).moved(instanceId, move))
  }

  getBulkOperation(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined> {
    this.state = new FakeBulkWork(this.state).progressed(bulkOperationId)
    return Promise.resolve(new FakeBulkWork(this.state).operation(bulkOperationId))
  }

  getBulkFailures(bulkOperationId: BulkOperationId): Promise<readonly BulkFailure[]> {
    return Promise.resolve(new FakeBulkWork(this.state).failures(bulkOperationId))
  }

  proposeMigration(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan> {
    return this.attempt(() => new FakeMigration(this.state).proposal(source, target))
  }

  checkMigration(plan: MigrationPlan): Promise<MigrationCheck> {
    return this.attempt(() => new FakeMigration(this.state).check(plan))
  }

  cancelInstances(instanceIds: readonly InstanceId[]): Promise<BulkOperationId> {
    return this.submit(() => new FakeBulkWork(this.state).submitted(instanceIds))
  }

  migrateInstances(
    plan: MigrationPlan,
    instanceIds: readonly InstanceId[],
  ): Promise<BulkOperationId> {
    return this.submit(() => new FakeBulkWork(this.state).submittedMigration(plan, instanceIds))
  }

  stopBulkOperation(bulkOperationId: BulkOperationId): Promise<void> {
    return this.apply(() => new FakeBulkWork(this.state).stopped(bulkOperationId))
  }

  private queries(): FakeQueries {
    return new FakeQueries(this.state)
  }

  private submit(next: () => FakeSubmission): Promise<BulkOperationId> {
    return this.attempt(() => {
      const submission = next()
      this.state = submission.state
      return submission.id
    })
  }

  private apply(next: () => FakeEngineState): Promise<void> {
    return this.attempt(() => {
      this.state = next()
    })
  }

  private attempt<Result>(work: () => Result): Promise<Result> {
    try {
      return Promise.resolve(work())
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private versionSummary(definition: FakeDefinition): VersionSummary {
    const running = this.queries().instances({
      definitionId: definition.ref.id,
      lifecycle: "running",
    })
    return {
      definition: definition.ref,
      running: running.length,
      withIncident: running.filter((instance) => instance.hasIncident).length,
    }
  }

  private versionsOf(bpmnProcessId: BpmnProcessId): VersionSummary[] {
    return this.state.definitions
      .filter((definition) => definition.ref.bpmnProcessId === bpmnProcessId)
      .sort((left, right) => right.ref.version - left.ref.version)
      .map((definition) => this.versionSummary(definition))
  }

  private definitionSummaries(): DefinitionSummary[] {
    const processIds = [
      ...new Set(this.state.definitions.map((definition) => definition.ref.bpmnProcessId)),
    ]
    return processIds.flatMap((bpmnProcessId) => {
      const versions = this.versionsOf(bpmnProcessId)
      const latest = versions[0]
      if (latest === undefined) {
        return []
      }
      return [
        {
          latest: latest.definition,
          running: versions.reduce((sum, version) => sum + version.running, 0),
          withIncident: versions.reduce((sum, version) => sum + version.withIncident, 0),
        },
      ]
    })
  }

  private instanceDetail(instanceId: InstanceId): InstanceDetail | undefined {
    const instance = this.state.instances.find((candidate) => candidate.summary.id === instanceId)
    if (instance === undefined) {
      return undefined
    }
    const descendants = this.queries().descendantsOf(instanceId)
    const treeIds = new Set([instanceId, ...descendants.map((child) => child.summary.id)])
    return {
      instance: instance.summary,
      path: instance.path ?? [],
      waitStates: [instance, ...descendants]
        .filter((member) => FakeQueries.isRunning(member.summary))
        .flatMap((member) => member.waitStates),
      incidents: this.state.incidents
        .filter(({ incident }) => treeIds.has(incident.instanceId))
        .map(({ incident, fullDetails }) => ({ ...incident, details: fullDetails })),
      calledInstances: descendants.map((child) => this.calledInstanceOf(child, instanceId)),
      variables: instance.variables,
      truncated: false,
    }
  }

  private calledInstanceOf(child: FakeInstance, rootId: InstanceId): CalledInstance {
    return {
      id: child.summary.id,
      parentInstanceId: child.summary.parentInstanceId ?? rootId,
      bpmnProcessId: child.summary.definition.bpmnProcessId,
      state: child.summary.state,
      ...(child.calledFromElementId === undefined
        ? {}
        : { calledFromElementId: child.calledFromElementId }),
    }
  }
}
