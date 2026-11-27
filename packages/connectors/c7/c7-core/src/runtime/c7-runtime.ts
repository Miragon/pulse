/**
 * Every read of the engine contract (`ProcessRuntime` of @miragon/pulse-engine-core) for an engine
 * of the Camunda 7 REST family, over a surface's `EnginePort`: one reader per question. A failure
 * c7-core words itself (an unusable answer, an id no engine assigns) is a `RuntimeError` and passes
 * as it is; every other error, its wire's, goes through the surface's `failureOf`, so each surface
 * keeps its own words for its wire's failures. It answers every variable condition, so it refuses
 * none (no `refusedVariableConditions`).
 */

import {
  RuntimeError,
  type BpmnProcessId,
  type BulkFailure,
  type BulkOperation,
  type BulkOperationId,
  type CalledProcess,
  type DefinitionId,
  type DefinitionSummary,
  type ElementStatistics,
  type EngineInfo,
  type Incident,
  type IncidentDetails,
  type IncidentFilter,
  type IncidentId,
  type InstanceCount,
  type InstanceDetail,
  type InstanceFilter,
  type InstanceId,
  type InstanceSummary,
  type MigrationCheck,
  type MigrationPlan,
  type Page,
  type PageRequest,
  type ProcessRuntime,
  type VersionSummary,
} from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import { BulkOperationReader } from "./bulk-operation-reader.js"
import { CalledProcessReader } from "./called-process-reader.js"
import { DefinitionReader } from "./definition-reader.js"
import { type DiagramRead, diagramReadOf } from "./definition-rows.js"
import {
  type ElementIncident,
  ElementIncidentSearch,
  type ElementRef,
} from "./element-incidents.js"
import {
  ElementStatisticsReader,
  type ElementStatisticsWithFailedJobs,
} from "./element-statistics-reader.js"
import { EngineReader } from "./engine-reader.js"
import { IncidentDetailsReader } from "./incident-details-reader.js"
import { IncidentSearch } from "./incident-search.js"
import { InstanceDetailReader, type InstanceDetailWithCauses } from "./instance-detail-reader.js"
import { InstanceSearch } from "./instance-search.js"
import { MigrationReader } from "./migration-reader.js"
import { VariableNameReader } from "./variable-name-reader.js"

/** How a surface takes part in the runtime's reads. */
export interface C7RuntimeOptions {
  /**
   * The contract's failure of an error that is no `RuntimeError`, such as a failure of the
   * surface's wire, in the surface's words.
   */
  readonly failureOf: (error: unknown) => RuntimeError
  /**
   * The surface's read of the BPMN XML a version was deployed with, where it keeps the diagrams it
   * read (the MCP server's one XML cache): undefined for a version the engine does not know. Every
   * read of a diagram goes through it (`getDiagramXml`, the processes a version calls, the call
   * activities of its element statistics); without it each reads over the port.
   */
  readonly diagramXml?: DiagramRead
  /**
   * The most instance ids one request to the history's instances carries, 500 without it
   * (`HISTORY_ID_CHUNK`): a search or count over more, such as the instances with an incident in
   * a scope, sends them in chunks of it. An engine suite sets a small one, so the chunked reads
   * meet the laws on the few instances of its world.
   */
  readonly historyIdChunk?: number
}

interface C7Readers {
  readonly engine: EngineReader
  readonly definitions: DefinitionReader
  readonly statistics: ElementStatisticsReader
  readonly calls: CalledProcessReader
  readonly instances: InstanceSearch
  readonly variableNames: VariableNameReader
  readonly instanceDetails: InstanceDetailReader
  readonly incidents: IncidentSearch
  readonly elementIncidents: ElementIncidentSearch
  readonly incidentDetails: IncidentDetailsReader
  readonly bulkOperations: BulkOperationReader
  readonly migrations: MigrationReader
}

/** The reads of the engine contract over the port of an engine of the Camunda 7 REST family. */
export class C7Runtime implements ProcessRuntime {
  private constructor(
    private readonly readers: C7Readers,
    private readonly options: C7RuntimeOptions,
  ) {}

  /** The runtime over `port`, a surface's wire whose failures `options.failureOf` words. */
  static over(port: EnginePort, options: C7RuntimeOptions): C7Runtime {
    const diagram = diagramReadOf(port, options.diagramXml)
    const definitions = new DefinitionReader(port, diagram)
    return new C7Runtime(
      {
        engine: new EngineReader(port),
        definitions,
        statistics: new ElementStatisticsReader(port, diagram),
        calls: new CalledProcessReader(port, diagram),
        instances: new InstanceSearch(port, options.historyIdChunk),
        variableNames: new VariableNameReader(port),
        instanceDetails: new InstanceDetailReader(port),
        incidents: new IncidentSearch(port, definitions),
        elementIncidents: new ElementIncidentSearch(port),
        incidentDetails: new IncidentDetailsReader(port),
        bulkOperations: new BulkOperationReader(port),
        migrations: new MigrationReader(port),
      },
      options,
    )
  }

  describeEngine(): Promise<EngineInfo> {
    return this.answered(() => this.readers.engine.describe())
  }

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    return this.answered(() => this.readers.definitions.list())
  }

  listVersions(bpmnProcessId: BpmnProcessId): Promise<readonly VersionSummary[]> {
    return this.answered(() => this.readers.definitions.versions(bpmnProcessId))
  }

  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return this.answered(() => this.readers.definitions.diagramXml(definitionId))
  }

  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]> {
    return this.answered(() => this.readers.statistics.of(definitionId))
  }

  /**
   * Beyond the contract: the counts of `getElementStatistics` with each element's jobs without
   * retries, from the same one statistics read, for the MCP server's process flow ("Running").
   */
  getElementStatisticsWithFailedJobs(
    definitionId: DefinitionId,
  ): Promise<readonly ElementStatisticsWithFailedJobs[]> {
    return this.answered(() => this.readers.statistics.withFailedJobs(definitionId))
  }

  getCalledProcesses(definitionId: DefinitionId): Promise<readonly CalledProcess[]> {
    return this.answered(() => this.readers.calls.read(definitionId))
  }

  searchInstances(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    return this.answered(() => this.readers.instances.search(filter, page))
  }

  countInstances(filter: InstanceFilter): Promise<InstanceCount> {
    return this.answered(async () => ({ count: await this.readers.instances.count(filter) }))
  }

  listVariableNames(definitionId: DefinitionId): Promise<readonly string[]> {
    return this.answered(() => this.readers.variableNames.names(definitionId))
  }

  getInstanceDetail(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
    return this.answered(() => this.readers.instanceDetails.read(instanceId))
  }

  /**
   * Beyond the contract: the detail of `getInstanceDetail` with the cause of each of its root
   * incidents as the cockpit's cause view takes it, from the same reads, for the web app's
   * instance screen (every incident of a card's cause).
   */
  getInstanceDetailWithCauses(
    instanceId: InstanceId,
  ): Promise<InstanceDetailWithCauses | undefined> {
    return this.answered(() => this.readers.instanceDetails.readWithCauses(instanceId))
  }

  searchIncidents(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    return this.answered(() => this.readers.incidents.search(filter, page))
  }

  /**
   * Beyond the contract: a page of the open root incidents at an element and its multi-instance
   * body over every version of its process, newest first and then by id, each row as the engine
   * answers it, for the MCP server's page of an activity's incidents.
   */
  searchElementRootIncidents(
    element: ElementRef,
    page: PageRequest,
  ): Promise<Page<ElementIncident>> {
    return this.answered(() => this.readers.elementIncidents.search(element, page))
  }

  getIncidentDetails(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    return this.answered(() => this.readers.incidentDetails.read(incidentId))
  }

  getBulkOperation(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined> {
    return this.answered(() => this.readers.bulkOperations.read(bulkOperationId))
  }

  getBulkFailures(bulkOperationId: BulkOperationId): Promise<readonly BulkFailure[]> {
    return this.answered(() => this.readers.bulkOperations.failures(bulkOperationId))
  }

  proposeMigration(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan> {
    return this.answered(() => this.readers.migrations.proposal(source, target))
  }

  checkMigration(plan: MigrationPlan): Promise<MigrationCheck> {
    return this.answered(() => this.readers.migrations.check(plan))
  }

  private async answered<Result>(read: () => Promise<Result>): Promise<Result> {
    try {
      return await read()
    } catch (error: unknown) {
      throw RuntimeError.is(error) ? error : this.options.failureOf(error)
    }
  }
}
