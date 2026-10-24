/**
 * Example command lines for `--help` and `operate describe`: curated examples for the everyday
 * commands, otherwise one generic example built from the positional arguments and the required
 * options. A unit test checks every example against the catalog, so examples cannot drift.
 */

import { loadCatalog } from '../catalog/catalog.js';
import { requiresConfirmation } from '../catalog/rules.js';
import type { Schemas } from '../catalog/schema.js';
import type { OperationSpec } from '../catalog/types.js';
import {
  type ArgumentDoc,
  type OptionDoc,
  operationArguments,
  operationOptions,
} from './options.js';

const INSTANCE = '6f2b8c3e-0f4a-11ef-a1b2-0242ac120002';
const TASK = '7c1d9e20-0f4a-11ef-a1b2-0242ac120002';
const EXTERNAL_TASK = '8a3e1f42-0f4a-11ef-a1b2-0242ac120002';
const INCIDENT = '9b4f2a53-0f4a-11ef-a1b2-0242ac120002';
const JOB = 'ac5a3b64-0f4a-11ef-a1b2-0242ac120002';
const TOPICS = `'{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'`;

/**
 * Curated examples keyed by operationId. Presets share the operationId of their base operation, so
 * an operation only shows the examples that start with its own command.
 */
const CURATED: Readonly<Record<string, readonly string[]>> = {
  createDeployment: [
    'operate deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice',
    'operate deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only',
  ],
  getProcessDefinitions: [
    'operate process-definition list --latest-version --sort-by key --sort-order asc',
    'operate process-definition list --key invoice --fields id,key,version,deploymentId -o table',
  ],
  startProcessInstanceByKey: [
    'operate process-definition start invoice --business-key INV-1001 --var amount=250 --var approved=false',
    'operate process-definition start invoice --var invoiceDate:Date=2024-05-01 --var zip:String=01234',
    'operate process-definition start invoice --body @start.json --business-key INV-1002',
  ],
  getProcessDefinitionBpmn20XmlByKey: ['operate process-definition xml invoice'],
  getProcessInstances: [
    'operate process-instance list --process-definition-key invoice --business-key INV-1001',
    'operate process-instance list --with-incident --fields id,businessKey,definitionId -o table',
    'operate process-instance list --variables amount_gt_1000 --all',
  ],
  getProcessInstance: [`operate process-instance get ${INSTANCE}`],
  getProcessInstanceVariables: [
    `operate process-instance get-variables ${INSTANCE}`,
    `operate process-instance get-variables ${INSTANCE} --fields amount,approved`,
  ],
  deleteProcessInstance: [
    `operate process-instance delete ${INSTANCE} --yes`,
    `operate process-instance delete ${INSTANCE} --skip-custom-listeners --skip-io-mappings --yes`,
  ],
  modifyProcessInstance: [
    `operate process-instance modify ${INSTANCE} --body @modification.json --dry-run`,
    `operate process-instance modify ${INSTANCE} --annotation 'Back to review' --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}'`,
  ],
  updateSuspensionStateById: [
    `operate process-instance suspend ${INSTANCE}`,
    `operate process-instance activate ${INSTANCE}`,
  ],
  getTasks: [
    'operate task list --process-definition-key invoice --unassigned',
    'operate task list --candidate-group accounting --sort-by created --sort-order desc',
    'operate task list --assignee demo --fields id,name,created,processInstanceId -o table',
  ],
  claim: [`operate task claim ${TASK} --user-id demo`],
  complete: [
    `operate task complete ${TASK} --var approved=true --var 'comment=Looks good'`,
    `operate task complete ${TASK} --with-variables-in-return --body '{"variables":{"approved":{"value":false,"type":"Boolean"}}}'`,
  ],
  fetchAndLock: [
    `operate external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body ${TOPICS}`,
    'operate external-task fetch-and-lock --worker-id worker-1 --max-tasks 1 --async-response-timeout 30000 --body @topics.json',
  ],
  completeExternalTaskResource: [
    `operate external-task complete ${EXTERNAL_TASK} --worker-id worker-1 --var invoiceSent=true`,
  ],
  handleFailure: [
    `operate external-task handle-failure ${EXTERNAL_TASK} --worker-id worker-1 --error-message 'SMTP timeout' --retries 2 --retry-timeout 60000`,
    `operate external-task handle-failure ${EXTERNAL_TASK} --worker-id worker-1 --error-message 'Invalid address' --retries 0`,
  ],
  getIncidents: [
    `operate incident list --process-instance-id ${INSTANCE}`,
    'operate incident list --incident-type failedJob --fields id,activityId,incidentMessage -o table',
  ],
  resolveIncident: [`operate incident resolve ${INCIDENT} --yes`],
  getJobs: [
    `operate job list --process-instance-id ${INSTANCE} --with-exception`,
    'operate job list --no-retries-left --fields id,processInstanceId,exceptionMessage',
  ],
  setJobRetries: [`operate job set-retries ${JOB} --retries 3`],
  getHistoricProcessInstances: [
    'operate historic-process-instance list --process-definition-key invoice --finished --started-after 2024-05-01',
    'operate historic-process-instance list --process-instance-business-key INV-1001 --sort-by startTime --sort-order desc',
  ],
  deliverMessage: [
    'operate message correlate --message-name InvoiceReceived --business-key INV-1001 --var amount=250',
    'operate message correlate --message-name PaymentReceived --correlation-key orderId=A-17 --result-enabled',
  ],
  evaluateDecisionByKey: [
    'operate decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel',
  ],
  setProcessInstanceVariable: [
    `operate process-instance set-variable ${INSTANCE} amount --value 300`,
    `operate process-instance set-variable ${INSTANCE} dueDate --value 2024-06-01T12:00 --type Date`,
    `operate process-instance set-variable ${INSTANCE} order --value '{"id":42}' --type Json`,
  ],
};

/** Placeholder values of required options by option type; other types get `my-<flag>`. */
const PLACEHOLDERS: Readonly<Record<string, string>> = {
  integer: '1',
  number: '1.5',
  'date-time': '2024-05-01T10:00:00Z',
};

/** Placeholders of the positional arguments: the first allowed value of an enum path parameter. */
function argumentPlaceholders(operation: OperationSpec): string[] {
  const pathParams = operation.params.filter((param) => param.in === 'path');
  return operationArguments(operation).map((argument: ArgumentDoc, index) =>
    argument.variadic ? 'process.bpmn' : (pathParams[index]?.enum?.[0] ?? `my-${argument.name}`),
  );
}

function optionPlaceholder(option: OptionDoc): string[] {
  if (option.valueName === undefined) return [`--${option.flag}`];
  const value = option.enum?.[0] ?? PLACEHOLDERS[option.type] ?? `my-${option.flag}`;
  return [`--${option.flag}`, value];
}

/** One example from the positional arguments and the required options. */
function genericExample(operation: OperationSpec, schemas: Schemas): string {
  const required = operationOptions(operation, schemas).filter((option) => option.required);
  const confirm = requiresConfirmation(operation.effect) ? ['--yes'] : [];
  return [
    'operate',
    operation.group,
    operation.name,
    ...argumentPlaceholders(operation),
    ...required.flatMap(optionPlaceholder),
    ...confirm,
  ].join(' ');
}

/**
 * Curated examples of the operation, else one generic example. `schemas` resolve the required body
 * properties of the generic example; they default to the schemas of the catalog.
 */
export function examplesFor(
  operation: OperationSpec,
  schemas: Schemas = loadCatalog().schemas,
): string[] {
  const command = `operate ${operation.group} ${operation.name}`;
  const curated =
    CURATED[operation.operationId]?.filter((example) => `${example} `.startsWith(`${command} `)) ??
    [];
  return curated.length > 0 ? curated : [genericExample(operation, schemas)];
}
