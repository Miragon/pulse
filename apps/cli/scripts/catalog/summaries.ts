/**
 * One-line summaries of the commands, shown by `operate commands`, `--help` and `describe`. The
 * upstream summaries are often generic ("Get List", "Get") or shared by the by-id / by-key / by-key
 * and tenant id variants of an operation, so an agent cannot pick a command from them. Rules:
 *
 * 1. an explicit override (keyed by operationId; the generator fails for unknown ids),
 * 2. a summary built from the command name for the standard names (`list` → "List process
 *    instances", `get` → "Get a process instance by id", ...),
 * 3. the upstream summary.
 *
 * Summaries that are still shared within a group get the variant from the path appended:
 * "(by id)", "(by key)" or "(by key and tenant id)". The result must be unique per group.
 */

import type { OperationSpec } from '../../src/catalog/types.js';
import { pluralize } from './naming.js';

type Rule = (noun: Noun, operation: OperationSpec) => string | undefined;

interface Noun {
  readonly singular: string;
  readonly plural: string;
  /** `a` or `an`. */
  readonly article: string;
}

// Stryker disable all: help texts; only the golden catalog test detects a change (stryker.config.js)
/** Explicit summaries keyed by operationId: wrong, generic or misleading upstream texts. */
export const SUMMARY_OVERRIDES: Readonly<Record<string, string>> = {
  getBatchStatistics: 'Get batch statistics',
  getBatchStatisticsCount: 'Count batch statistics',
  updateBatchSuspensionState: 'Activate or suspend a batch by id',
  evaluateCondition: 'Evaluate conditional start events and start process instances',
  evaluateDecisionById: 'Evaluate a decision',
  evaluateDecisionByKey: 'Evaluate a decision',
  evaluateDecisionByKeyAndTenant: 'Evaluate a decision',
  getDecisionDefinitionByKey: 'Get the latest decision definition',
  getDecisionDefinitionByKeyAndTenantId: 'Get the latest decision definition',
  getDecisionDefinitionDiagram: 'Get the decision diagram',
  getDecisionDefinitionDiagramByKey: 'Get the decision diagram',
  getDecisionDefinitionDiagramByKeyAndTenant: 'Get the decision diagram',
  updateHistoryTimeToLiveByDecisionDefinitionId: 'Update the history time to live',
  updateHistoryTimeToLiveByDecisionDefinitionKey: 'Update the history time to live',
  updateHistoryTimeToLiveByDecisionDefinitionKeyAndTenant: 'Update the history time to live',
  getDecisionDefinitionDmnXmlByKey: 'Get the DMN XML',
  getDecisionDefinitionDmnXmlById: 'Get the DMN XML',
  getDecisionDefinitionDmnXmlByKeyAndTenant: 'Get the DMN XML',
  getDecisionRequirementsDefinitionByKey: 'Get the latest decision requirements definition',
  getDecisionRequirementsDefinitionByKeyAndTenantId:
    'Get the latest decision requirements definition',
  getDecisionRequirementsDefinitionDiagramById: 'Get the decision requirements diagram',
  getDecisionRequirementsDefinitionDiagramByKey: 'Get the decision requirements diagram',
  getDecisionRequirementsDefinitionDiagramByKeyAndTenantId: 'Get the decision requirements diagram',
  getDecisionRequirementsDefinitionDmnXmlByKey: 'Get the DMN XML',
  getDecisionRequirementsDefinitionDmnXmlById: 'Get the DMN XML',
  getDecisionRequirementsDefinitionDmnXmlByKeyAndTenantId: 'Get the DMN XML',
  getDeploymentResource: 'Get a resource of a deployment',
  getDeploymentResourceData: 'Get the content of a deployment resource (binary)',
  getDeploymentResources: 'List the resources of a deployment',
  redeploy: 'Redeploy the resources of a deployment',
  getProcessEngineNames: 'List the process engines',
  createIncident: 'Create a custom incident for an execution',
  modifyLocalExecutionVariables: 'Update or delete local execution variables',
  putLocalExecutionVariable: 'Set a local execution variable',
  setLocalExecutionVariableBinary: 'Set a binary local execution variable',
  signalExecution: 'Signal (trigger) a waiting execution',
  completeExternalTaskResource: 'Complete an external task',
  extendLock: 'Extend the lock of an external task',
  fetchAndLock: 'Fetch and lock external tasks',
  getExternalTaskErrorDetails: 'Get the error details of an external task',
  handleExternalTaskBpmnError: 'Report a BPMN error for an external task',
  handleFailure: 'Report a failure of an external task',
  lock: 'Lock an external task',
  unlock: 'Unlock an external task',
  setExternalTaskResourcePriority: 'Set the priority of an external task',
  setExternalTaskResourceRetries: 'Set the retries of an external task',
  setExternalTaskRetries: 'Set the retries of many external tasks (synchronously)',
  setExternalTaskRetriesAsyncOperation: 'Set the retries of many external tasks (batch)',
  executeFilterCount: 'Count the results of a filter',
  executeFilterList: 'List the results of a filter',
  executeFilterSingleResult: 'Get the single result of a filter',
  postExecuteFilterCount: 'Count the results of a filter (extra filters in the JSON body)',
  postExecuteFilterList: 'List the results of a filter (extra filters in the JSON body)',
  postExecuteFilterSingleResult:
    'Get the single result of a filter (extra filters in the JSON body)',
  createGroupMember: 'Add a user to a group',
  deleteGroupMember: 'Remove a user from a group',
  setRemovalTimeAsyncHistoricBatch: 'Set the removal time of historic batches (batch)',
  deleteAsync: 'Delete historic decision instances (batch)',
  setRemovalTimeAsyncHistoricDecisionInstance:
    'Set the removal time of historic decision instances (batch)',
  deleteHistoricProcessInstancesAsync: 'Delete historic process instances (batch)',
  deleteHistoricVariableInstancesOfHistoricProcessInstance:
    'Delete all historic variables of a historic process instance',
  getHistoricProcessInstanceDurationReport: 'Get a duration report of historic process instances',
  setRemovalTimeAsync: 'Set the removal time of historic process instances (batch)',
  getHistoricTaskInstanceReport: 'Get a report of historic task instances',
  clearAnnotationUserOperationLog: 'Clear the annotation of a user operation log entry',
  setAnnotationUserOperationLog: 'Set the annotation of a user operation log entry',
  cleanupAsync: 'Start the history cleanup',
  findCleanupJob: 'Get the history cleanup job',
  findCleanupJobs: 'List the history cleanup jobs',
  getGroupInfo: 'Get the groups of a user',
  resolveIncident: 'Resolve a custom incident',
  getStacktrace: 'Get the exception stacktrace of a job',
  setJobRetriesAsyncOperation: 'Set the retries of many jobs (batch)',
  updateSuspensionStateBy: 'Activate or suspend jobs (selected in the JSON body)',
  updateJobSuspensionState: 'Activate or suspend a job by id',
  updateSuspensionStateJobDefinitions:
    'Activate or suspend job definitions (selected in the JSON body)',
  updateSuspensionStateJobDefinition: 'Activate or suspend a job definition by id',
  deliverMessage: 'Correlate a message to process instances or start events',
  getMetrics: 'Get the sum of a metric',
  throwSignal: 'Throw a signal',
  deleteProcessDefinitionsByKey: 'Delete all versions of a process definition',
  deleteProcessDefinitionsByKeyAndTenantId: 'Delete all versions of a process definition',
  getProcessDefinitionByKey: 'Get the latest process definition',
  getLatestProcessDefinitionByTenantId: 'Get the latest process definition',
  getProcessDefinitionDiagram: 'Get the BPMN diagram',
  getProcessDefinitionDiagramByKey: 'Get the BPMN diagram',
  getProcessDefinitionDiagramByKeyAndTenantId: 'Get the BPMN diagram',
  getProcessDefinitionBpmn20XmlByKey: 'Get the BPMN 2.0 XML',
  getProcessDefinitionBpmn20Xml: 'Get the BPMN 2.0 XML',
  getProcessDefinitionBpmn20XmlByKeyAndTenantId: 'Get the BPMN 2.0 XML',
  startProcessInstanceByKey: 'Start a process instance',
  startProcessInstance: 'Start a process instance',
  startProcessInstanceByKeyAndTenantId: 'Start a process instance',
  restartProcessInstance: 'Restart finished process instances of a process definition',
  restartProcessInstanceAsyncOperation:
    'Restart finished process instances of a process definition (batch)',
  updateProcessDefinitionSuspensionState:
    'Activate or suspend process definitions (selected in the JSON body)',
  updateProcessDefinitionSuspensionStateById: 'Activate or suspend a process definition by id',
  updateProcessDefinitionSuspensionStateByKey:
    'Activate or suspend all versions of a process definition',
  updateProcessDefinitionSuspensionStateByKeyAndTenantId:
    'Activate or suspend all versions of a process definition',
  deleteProcessInstanceComments: 'Delete all comments of a process instance',
  correlateMessageAsyncOperation: 'Correlate a message to many process instances (batch)',
  deleteProcessInstancesAsyncOperation: 'Delete process instances (batch)',
  deleteAsyncHistoricQueryBased: 'Delete process instances selected by a historic query (batch)',
  deleteProcessInstanceVariable: 'Delete a process variable',
  getActivityInstanceTree: 'Get the activity instance tree of a process instance',
  getProcessInstanceVariable: 'Get a process variable',
  getProcessInstanceVariableBinary: 'Get the content of a binary process variable',
  getProcessInstanceVariables: 'Get the variables of a process instance',
  modifyProcessInstance: 'Modify the execution state of a process instance',
  modifyProcessInstanceAsyncOperation: 'Modify the execution state of a process instance (batch)',
  modifyProcessInstanceVariables: 'Update or delete process variables',
  setRetriesByProcess: 'Set the job retries of many process instances (batch)',
  setRetriesByProcessHistoricQueryBased:
    'Set the job retries of process instances selected by a historic query (batch)',
  setProcessInstanceVariable: 'Set a process variable',
  setProcessInstanceVariableBinary: 'Set a binary process variable',
  setVariablesAsyncOperation: 'Set variables of many process instances (batch)',
  updateSuspensionState: 'Activate or suspend process instances (selected in the JSON body)',
  updateSuspensionStateAsyncOperation: 'Activate or suspend many process instances (batch)',
  updateSuspensionStateById: 'Activate or suspend a process instance by id',
  getAttachmentData: 'Get the content of a task attachment',
  deleteTaskComments: 'Delete all comments of a task',
  modifyTaskLocalVariables: 'Update or delete task local variables',
  putTaskLocalVariable: 'Set a task local variable',
  setBinaryTaskLocalVariable: 'Set a binary task local variable',
  modifyTaskVariables: 'Update or delete task variables',
  putTaskVariable: 'Set a task variable',
  setBinaryTaskVariable: 'Set a binary task variable',
  claim: 'Claim a task for a user',
  complete: 'Complete a task',
  delegateTask: 'Delegate a task to another user',
  resolve: 'Resolve a delegated task',
  unclaim: 'Unclaim a task',
  setAssignee: 'Set the assignee of a task',
  submit: 'Submit the form of a task',
  getForm: 'Get the form key of a task',
  getDeployedForm: 'Get the deployed form of a task',
  getRenderedForm: 'Get the rendered form of a task',
  handleBpmnError: 'Report a BPMN error for a task',
  handleEscalation: 'Report a BPMN escalation for a task',
  createGroupMembership: 'Add a group to a tenant',
  deleteGroupMembership: 'Remove a group from a tenant',
  createUserMembership: 'Add a user to a tenant',
  deleteUserMembership: 'Remove a user from a tenant',
  getUserProfile: 'Get the profile of a user',
  updateCredentials: 'Update the password of a user',
  updateProfile: 'Update the profile of a user',
  unlockUser: 'Unlock a user',
  getRestAPIVersion: 'Get the REST API version',
};
// Stryker restore all

function nounOf(group: string): Noun {
  const words = group.split('-');
  const last = words.pop() ?? group;
  const singular = [...words, last].join(' ');
  return {
    singular,
    plural: [...words, pluralize(last)].join(' '),
    article: /^[aeio]/.test(singular) ? 'an' : 'a',
  };
}

function pathParams(operation: OperationSpec): number {
  return operation.params.filter((param) => param.in === 'path').length;
}

/** ` by id` for operations on `/.../{id}` with no other path parameter. */
function byId(operation: OperationSpec): string {
  return pathParams(operation) === 1 && operation.path.endsWith('/{id}') ? ' by id' : '';
}

function onOne(verb: string): Rule {
  return (noun, operation) =>
    pathParams(operation) === 0
      ? undefined
      : `${verb} ${noun.article} ${noun.singular}${byId(operation)}`;
}

const NAME_RULES: Readonly<Record<string, Rule>> = {
  list: (noun) => `List ${noun.plural}`,
  count: (noun) => `Count ${noun.plural}`,
  query: (noun) => `List ${noun.plural} (filters in the JSON body)`,
  'query-count': (noun) => `Count ${noun.plural} (filters in the JSON body)`,
  get: onOne('Get'),
  delete: onOne('Delete'),
  update: onOne('Update'),
  create: (noun) => `Create ${noun.article} ${noun.singular}`,
  add: (noun) => `Add ${noun.article} ${noun.singular}`,
};

function baseSummary(
  operation: OperationSpec,
  overrides: Readonly<Record<string, string>>,
): string {
  const override = overrides[operation.operationId];
  if (override !== undefined) return override;
  const rule = Object.hasOwn(NAME_RULES, operation.name) ? NAME_RULES[operation.name] : undefined;
  return rule?.(nounOf(operation.group), operation) ?? operation.summary;
}

/** `by key and tenant id`, `by key` or `by id` from the path of the operation. */
function variantOf(path: string): string | undefined {
  if (path.includes('/key/{key}/tenant-id/')) return 'by key and tenant id';
  if (path.includes('/key/{key}')) return 'by key';
  return /\/\{id\}(?:\/|$)/.test(path) ? 'by id' : undefined;
}

function duplicates(operations: readonly OperationSpec[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { group, summary } of operations) {
    const key = `${group}\n${summary}`;
    if (seen.has(key)) shared.add(key);
    seen.add(key);
  }
  return shared;
}

/** Fails when two commands of a group share a summary. */
export function assertUniqueSummaries(operations: readonly OperationSpec[]): void {
  const [shared] = duplicates(operations);
  if (shared !== undefined) {
    const [group, summary] = shared.split('\n');
    throw new Error(`Commands of group ${group} share the summary "${summary}"`);
  }
}

/** Applies the summary rules (see the module comment) to named operations. */
export function summarize(
  operations: readonly OperationSpec[],
  overrides: Readonly<Record<string, string>> = SUMMARY_OVERRIDES,
): OperationSpec[] {
  const known = new Set(operations.map((operation) => operation.operationId));
  const stale = Object.keys(overrides).filter((id) => !known.has(id));
  if (stale.length > 0)
    throw new Error(`Summary overrides for unknown operations: ${stale.join(', ')}`);
  const based = operations.map((operation) => ({
    ...operation,
    summary: baseSummary(operation, overrides),
  }));
  const shared = duplicates(based);
  return based.map((operation) => {
    const variant = variantOf(operation.path);
    return shared.has(`${operation.group}\n${operation.summary}`) && variant !== undefined
      ? { ...operation, summary: `${operation.summary} (${variant})` }
      : operation;
  });
}
