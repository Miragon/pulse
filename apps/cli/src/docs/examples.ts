/**
 * Example command lines for `--help` and `pulse describe`: curated examples for the everyday
 * commands, otherwise one generic example built from the positional arguments and the required
 * options. A unit test checks every example against the catalog, so examples cannot drift.
 */

import { loadCatalog } from "../catalog/catalog.js"
import { requiresConfirmation } from "../catalog/rules.js"
import type { Schemas } from "../catalog/schema.js"
import type { OperationSpec } from "../catalog/types.js"
import { CLI_NAME } from "../util.js"
import {
  type ArgumentDoc,
  type OptionDoc,
  operationArguments,
  operationOptions,
} from "./options.js"

const INSTANCE = "6f2b8c3e-0f4a-11ef-a1b2-0242ac120002"
const TASK = "7c1d9e20-0f4a-11ef-a1b2-0242ac120002"
const EXTERNAL_TASK = "8a3e1f42-0f4a-11ef-a1b2-0242ac120002"
const INCIDENT = "9b4f2a53-0f4a-11ef-a1b2-0242ac120002"
const JOB = "ac5a3b64-0f4a-11ef-a1b2-0242ac120002"
const TOPICS = `'{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'`

/**
 * Curated examples keyed by operationId. Presets share the operationId of their base operation, so
 * an operation only shows the examples that start with its own command.
 */
const CURATED: Readonly<Record<string, readonly string[]>> = {
  createDeployment: [
    "pulse deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice",
    "pulse deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only",
  ],
  getProcessDefinitions: [
    "pulse process-definition list --latest-version --sort-by key --sort-order asc",
    "pulse process-definition list --key invoice --fields id,key,version,deploymentId -o table",
  ],
  startProcessInstanceByKey: [
    "pulse process-definition start invoice --business-key INV-1001 --var amount=250 --var approved=false",
    "pulse process-definition start invoice --var invoiceDate:Date=2024-05-01 --var zip:String=01234",
    "pulse process-definition start invoice --body @start.json --business-key INV-1002",
  ],
  getProcessDefinitionBpmn20XmlByKey: ["pulse process-definition xml invoice"],
  getProcessInstances: [
    "pulse process-instance list --process-definition-key invoice --business-key INV-1001",
    "pulse process-instance list --with-incident --fields id,businessKey,definitionId -o table",
    "pulse process-instance list --variables amount_gt_1000 --all",
  ],
  getProcessInstance: [`pulse process-instance get ${INSTANCE}`],
  getProcessInstanceVariables: [
    `pulse process-instance get-variables ${INSTANCE}`,
    `pulse process-instance get-variables ${INSTANCE} --fields amount,approved`,
  ],
  deleteProcessInstance: [
    `pulse process-instance delete ${INSTANCE} --yes`,
    `pulse process-instance delete ${INSTANCE} --skip-custom-listeners --skip-io-mappings --yes`,
  ],
  modifyProcessInstance: [
    `pulse process-instance modify ${INSTANCE} --body @modification.json --dry-run`,
    `pulse process-instance modify ${INSTANCE} --annotation 'Back to review' --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}'`,
  ],
  updateSuspensionStateById: [
    `pulse process-instance suspend ${INSTANCE}`,
    `pulse process-instance activate ${INSTANCE}`,
  ],
  getTasks: [
    "pulse task list --process-definition-key invoice --unassigned",
    "pulse task list --candidate-group accounting --sort-by created --sort-order desc",
    "pulse task list --assignee demo --fields id,name,created,processInstanceId -o table",
  ],
  claim: [`pulse task claim ${TASK} --user-id demo`],
  complete: [
    `pulse task complete ${TASK} --var approved=true --var 'comment=Looks good'`,
    `pulse task complete ${TASK} --with-variables-in-return --body '{"variables":{"approved":{"value":false,"type":"Boolean"}}}'`,
  ],
  fetchAndLock: [
    `pulse external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body ${TOPICS}`,
    "pulse external-task fetch-and-lock --worker-id worker-1 --max-tasks 1 --async-response-timeout 30000 --body @topics.json",
  ],
  completeExternalTaskResource: [
    `pulse external-task complete ${EXTERNAL_TASK} --worker-id worker-1 --var invoiceSent=true`,
  ],
  handleFailure: [
    `pulse external-task handle-failure ${EXTERNAL_TASK} --worker-id worker-1 --error-message 'SMTP timeout' --retries 2 --retry-timeout 60000`,
    `pulse external-task handle-failure ${EXTERNAL_TASK} --worker-id worker-1 --error-message 'Invalid address' --retries 0`,
  ],
  getIncidents: [
    `pulse incident list --process-instance-id ${INSTANCE}`,
    "pulse incident list --incident-type failedJob --fields id,activityId,incidentMessage -o table",
  ],
  resolveIncident: [`pulse incident resolve ${INCIDENT} --yes`],
  getJobs: [
    `pulse job list --process-instance-id ${INSTANCE} --with-exception`,
    "pulse job list --no-retries-left --fields id,processInstanceId,exceptionMessage",
  ],
  setJobRetries: [`pulse job set-retries ${JOB} --retries 3`],
  getHistoricProcessInstances: [
    "pulse historic-process-instance list --process-definition-key invoice --finished --started-after 2024-05-01",
    "pulse historic-process-instance list --process-instance-business-key INV-1001 --sort-by startTime --sort-order desc",
  ],
  deliverMessage: [
    "pulse message correlate --message-name InvoiceReceived --business-key INV-1001 --var amount=250",
    "pulse message correlate --message-name PaymentReceived --correlation-key orderId=A-17 --result-enabled",
  ],
  evaluateDecisionByKey: [
    "pulse decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel",
  ],
  setProcessInstanceVariable: [
    `pulse process-instance set-variable ${INSTANCE} amount --value 300`,
    `pulse process-instance set-variable ${INSTANCE} dueDate --value 2024-06-01T12:00 --type Date`,
    `pulse process-instance set-variable ${INSTANCE} order --value '{"id":42}' --type Json`,
  ],
}

/** Placeholder values of required options by option type; other types get `my-<flag>`. */
const PLACEHOLDERS: Readonly<Record<string, string>> = {
  integer: "1",
  number: "1.5",
  "date-time": "2024-05-01T10:00:00Z",
}

/** Placeholders of the positional arguments: the first allowed value of an enum path parameter. */
function argumentPlaceholders(operation: OperationSpec): string[] {
  const pathParams = operation.params.filter((param) => param.in === "path")
  return operationArguments(operation).map((argument: ArgumentDoc, index) =>
    argument.variadic ? "process.bpmn" : (pathParams[index]?.enum?.[0] ?? `my-${argument.name}`),
  )
}

function optionPlaceholder(option: OptionDoc): string[] {
  if (option.valueName === undefined) return [`--${option.flag}`]
  const value = option.enum?.[0] ?? PLACEHOLDERS[option.type] ?? `my-${option.flag}`
  return [`--${option.flag}`, value]
}

/** One example from the positional arguments and the required options. */
function genericExample(operation: OperationSpec, schemas: Schemas): string {
  const required = operationOptions(operation, schemas).filter((option) => option.required)
  const confirm = requiresConfirmation(operation.effect) ? ["--yes"] : []
  return [
    CLI_NAME,
    operation.group,
    operation.name,
    ...argumentPlaceholders(operation),
    ...required.flatMap(optionPlaceholder),
    ...confirm,
  ].join(" ")
}

/**
 * Curated examples of the operation, else one generic example. `schemas` resolve the required body
 * properties of the generic example; they default to the schemas of the catalog.
 */
export function examplesFor(
  operation: OperationSpec,
  schemas: Schemas = loadCatalog().schemas,
): string[] {
  const command = `pulse ${operation.group} ${operation.name}`
  const curated =
    CURATED[operation.operationId]?.filter((example) => `${example} `.startsWith(`${command} `)) ??
    []
  return curated.length > 0 ? curated : [genericExample(operation, schemas)]
}
