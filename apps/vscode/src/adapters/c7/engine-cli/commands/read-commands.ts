import type {
  HistoricInstanceQuery,
  IncidentQuery,
  MigrationPlanView,
  OffsetPage,
} from '../views/views.js';
import { EngineCliArguments } from './engine-cli-arguments.js';

const MAX_VARIABLES = 500;
const MAX_FAILED_JOBS = 100;

const NEWEST_FIRST = [
  { sortBy: 'startTime', sortOrder: 'desc' },
  { sortBy: 'instanceId', sortOrder: 'asc' },
];

export const VARIABLE_PAGE_SIZE = MAX_VARIABLES;

export class ReadCommands {
  static product(): string[] {
    return ['telemetry', 'get-data', '--fields', 'product.name,product.version'];
  }

  static version(): string[] {
    return ['version', 'get'];
  }

  static definitionStatistics(): string[] {
    return ['process-definition', 'get-statistics'];
  }

  static activityStatistics(definitionId: string): string[] {
    return [
      'process-definition',
      'get-activity-statistics',
      EngineCliArguments.identifier(definitionId),
    ];
  }

  static diagramXml(definitionId: string): string[] {
    return ['process-definition', 'xml-by-id', EngineCliArguments.identifier(definitionId)];
  }

  static incidents(query: IncidentQuery, page: OffsetPage | undefined): string[] {
    return [
      'incident',
      'list',
      ...ReadCommands.incidentFilterArgs(query),
      ...['--sort-by', 'incidentTimestamp', '--sort-order', 'desc'],
      ...ReadCommands.pageArgs(page),
    ];
  }

  static incidentInstances(): string[] {
    return ['incident', 'list', ...['--fields', 'processDefinitionId,processInstanceId', '--all']];
  }

  static incident(incidentId: string): string[] {
    return ['incident', 'get', EngineCliArguments.identifier(incidentId)];
  }

  static historicInstances(page: OffsetPage): string[] {
    return [
      'historic-process-instance',
      'query',
      ...['--body', '-'],
      ...ReadCommands.pageArgs(page),
    ];
  }

  static historicInstanceBody(query: HistoricInstanceQuery): string {
    return JSON.stringify({ ...query, sorting: NEWEST_FIRST });
  }

  static historicInstanceCount(): string[] {
    return ['historic-process-instance', 'query-count', ...['--body', '-']];
  }

  static historicInstanceCountBody(query: HistoricInstanceQuery): string {
    return JSON.stringify(query);
  }

  static batchStatistics(batchId: string): string[] {
    return ['batch', 'get-statistics', ...['--batch-id', EngineCliArguments.identifier(batchId)]];
  }

  static historicBatch(batchId: string): string[] {
    return ['historic-batch', 'get', EngineCliArguments.identifier(batchId)];
  }

  static failedJobs(jobDefinitionId: string): string[] {
    return [
      'job',
      'list',
      ...['--job-definition-id', EngineCliArguments.identifier(jobDefinitionId)],
      ...['--with-exception', '--no-retries-left', '--max-results', String(MAX_FAILED_JOBS)],
    ];
  }

  static migrationPlan(): string[] {
    return ['migration', 'generate-plan', ...['--body', '-']];
  }

  static migrationPlanBody(sourceDefinitionId: string, targetDefinitionId: string): string {
    return JSON.stringify({
      sourceProcessDefinitionId: sourceDefinitionId,
      targetProcessDefinitionId: targetDefinitionId,
      updateEventTriggers: false,
    });
  }

  static migrationReport(): string[] {
    return ['migration', 'validate-plan', ...['--body', '-']];
  }

  static migrationReportBody(plan: MigrationPlanView): string {
    return JSON.stringify({
      ...plan,
      instructions: plan.instructions.map((instruction) => ({
        ...instruction,
        updateEventTrigger: false,
      })),
    });
  }

  static inspect(instanceId: string): string[] {
    return ['inspect', EngineCliArguments.identifier(instanceId), '--stacktrace', '--history'];
  }

  static activityInstances(instanceId: string): string[] {
    return [
      'process-instance',
      'get-activity-instance-tree',
      EngineCliArguments.identifier(instanceId),
    ];
  }

  static variables(instanceId: string): string[] {
    return [
      'variable-instance',
      'list',
      ...['--process-instance-id-in', EngineCliArguments.identifier(instanceId)],
      ...['--no-deserialize-values', '--max-results', String(MAX_VARIABLES)],
    ];
  }

  static jobStacktrace(jobId: string): string[] {
    return ['job', 'get-stacktrace', EngineCliArguments.identifier(jobId)];
  }

  static externalTaskErrorDetails(externalTaskId: string): string[] {
    return ['external-task', 'get-error-details', EngineCliArguments.identifier(externalTaskId)];
  }

  private static pageArgs(page: OffsetPage | undefined): string[] {
    return page === undefined
      ? ['--all']
      : ['--first-result', String(page.firstResult), '--max-results', String(page.maxResults)];
  }

  private static flag(name: string, value: string | undefined): string[] {
    return value === undefined ? [] : [name, EngineCliArguments.identifier(value)];
  }

  private static identifierList(values: readonly string[] | undefined): string | undefined {
    return values?.map((value) => EngineCliArguments.identifier(value)).join(',');
  }

  private static incidentFilterArgs(query: IncidentQuery): string[] {
    return [
      ...ReadCommands.flag('--process-definition-id', query.processDefinitionId),
      ...ReadCommands.flag(
        '--process-definition-key-in',
        ReadCommands.identifierList(query.processDefinitionKeyIn),
      ),
      ...ReadCommands.flag('--process-instance-id', query.processInstanceId),
    ];
  }
}
