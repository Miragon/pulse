/**
 * The workflow commands: one entry per top-level command that combines catalog
 * operations. The single source of commander registration, `--help`, `describe`, `commands`,
 * completion and the docs drift tests. Pure.
 */

import type { Effect } from "../catalog/types.js"
import type { ArgumentDoc } from "./options.js"
import {
  ADVANCE_OPTIONS,
  DEPLOY_OPTIONS,
  INSPECT_OPTIONS,
  RETRY_OPTIONS,
  STATUS_OPTIONS,
  WAIT_COMMAND_OPTIONS,
  type WorkflowOptionDoc,
} from "./workflow-options.js"

interface WorkflowArgumentDoc extends ArgumentDoc {
  readonly complete?: "files"
}

export interface WorkflowDoc {
  readonly name: string
  /** `operate inspect [process-instance-id] [options]` */
  readonly usage: string
  readonly summary: string
  /** What the command does, in paragraphs. */
  readonly description: string
  /** The REST calls in order, as prose for `--help`. */
  readonly requests: string
  /** The base effect (for `commands --effect` and the guards). */
  readonly effect: Effect
  readonly effectNote?: string
  readonly arguments: readonly WorkflowArgumentDoc[]
  readonly options: readonly WorkflowOptionDoc[]
  /** Every operationId the command may send. */
  readonly calls: readonly string[]
  readonly examples: readonly string[]
}

const INSTANCE_ARGUMENT: WorkflowArgumentDoc = {
  name: "process-instance-id",
  required: false,
  variadic: false,
  description: "Process instance id; or select it with --business-key / --process-definition-key",
}

const SELECTION_CALLS = ["getHistoricProcessInstances", "getProcessInstances"]

/** What loading the instance view sends. */
const VIEW_CALLS = [
  "getProcessInstance",
  "getHistoricProcessInstance",
  "getHistoricVariableInstances",
  "getProcessInstances",
  "getActivityInstanceTree",
  "getIncidents",
  "getEventSubscriptions",
  "getTasks",
  "getExternalTasks",
  "getJobs",
  "getProcessDefinitions",
  "getJobDefinitions",
  "getProcessInstanceVariables",
  "getStacktrace",
  "getExternalTaskErrorDetails",
]

const POLL_CALLS = [
  "getProcessInstancesCount",
  "getJobsCount",
  "getTasksCount",
  "getHistoricActivityInstancesCount",
]
const JOB_CALLS = ["executeJob", "getJob", "getStacktrace"]
/** `--until activity:<id>` / `task:<key>`: the ids are checked against the BPMN once. */
const UNTIL_CALLS = ["getProcessDefinitionBpmn20Xml", "getProcessDefinitionBpmn20XmlByKey"]

function calls(...lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())]
}

const WAIT_REQUESTS =
  "with --wait or --until the polls of operate wait (GET /process-instance/{id}, the tree, counts of executable jobs, tasks or activities, then of incidents; before idle the instance and the tree once more)"
/** advance and retry check the ids of --until before their writes. */
const CHECKED_WAIT_REQUESTS = `${WAIT_REQUESTS}; before the writes, activity and task ids of --until are looked up in the BPMN (GET /process-definition/{id}/xml)`

export const WORKFLOW_DOCS: readonly WorkflowDoc[] = [
  {
    name: "inspect",
    usage: "operate inspect [process-instance-id] [options]",
    summary:
      "Show where a process instance waits and why: wait states, incidents with root cause, called instances, variables",
    description:
      "Shows where a process instance waits and why in one call: its wait states (user tasks, external tasks, messages, timers, jobs, ...) across the called instances below it, the open root incidents with their root cause, the called instances and the variables. Finds ended instances through the history; --history adds the timeline.",
    requests:
      "the selection (GET /history/process-instance and GET /process-instance, filters only), GET /process-instance/{id} and GET /history/process-instance/{id}, the tree of called instances (GET /process-instance?superProcessInstance=, one round per level), per instance its activity instances, incidents and event subscriptions, once the tasks, external tasks, jobs, process definitions and job definitions of the tree, the variables, with --history the activity and incident history, and the root causes (job stacktraces, external task error details)",
    effect: "read",
    arguments: [INSTANCE_ARGUMENT],
    options: INSPECT_OPTIONS,
    calls: calls(SELECTION_CALLS, VIEW_CALLS, [
      "getHistoricActivityInstances",
      "getHistoricIncidents",
    ]),
    examples: [
      "operate inspect $INSTANCE_ID",
      "operate inspect --business-key B-1 --history",
      "operate inspect --process-definition-key order-process --latest --no-variables",
    ],
  },
  {
    name: "wait",
    usage: "operate wait [process-instance-id] [options]",
    summary:
      "Wait until a process instance is idle, ended, has an incident or reached an activity, or a batch finished",
    description:
      'Waits until the process instance is idle (no executable job left, so it rests in wait states), or until the --until conditions; fails fast with exit code 9 (INCIDENT) when an incident appears, and with WAIT_TIMEOUT after --wait-timeout. Prints the instance view with "waited". Use it instead of sleep after every asynchronous step. With --batch it waits until the batch finished.',
    requests:
      "the selection, for --until activity:<id> or task:<key> the BPMN of the tree and the processes it calls (GET /process-definition/{id}/xml, a typo fails at once), then per poll (after 0, 250, 500, 1000 ms, then every 2 s) GET /process-instance/{id} (the history when it ended), the tree, the counts the conditions need, then the incident count (before it reports idle the instance and the tree once more); with --execute-jobs the due jobs (GET /job, POST /job/{id}/execute); at the end the instance view; with --batch GET /batch/statistics and GET /history/batch/{id}",
    effect: "read",
    effectNote: "write with --execute-jobs",
    arguments: [INSTANCE_ARGUMENT],
    options: WAIT_COMMAND_OPTIONS,
    calls: calls(
      SELECTION_CALLS,
      ["getProcessInstance", "getHistoricProcessInstance", "getProcessInstances"],
      UNTIL_CALLS,
      POLL_CALLS,
      ["getJobs"],
      JOB_CALLS,
      VIEW_CALLS,
      ["getBatchStatistics", "getHistoricBatch"],
    ),
    examples: [
      "operate wait $INSTANCE_ID",
      "operate wait --business-key B-1 --until task --until ended --wait-timeout 2m",
      "operate wait $INSTANCE_ID --until activity:book --execute-jobs",
      "operate wait --batch $BATCH_ID",
    ],
  },
  {
    name: "advance",
    usage: "operate advance [process-instance-id] [options]",
    summary:
      "Complete what a process instance waits for: user task, external task, message, signal, timer or async job",
    description:
      "Completes what the process instance waits for, without passing ids around: completes a user task, locks and completes an external task (or reports a failure or BPMN error), triggers a message or signal at the waiting execution, signals a receive task, or executes a timer or an asynchronous job. Name the activity with --activity-id when the instance waits at several places.",
    requests:
      "the selection and the instance view, then per wait state POST /task/{id}/complete (or /bpmnError); POST /external-task/{id}/lock and /complete (or /failure, /bpmnError; /unlock when that fails); POST /execution/{id}/messageSubscriptions/{name}/trigger; POST /signal; POST /execution/{id}/signal; or POST /job/{id}/execute; " +
      `then the instance view, ${CHECKED_WAIT_REQUESTS}`,
    effect: "write",
    effectNote: "--dry-run sends the reads and previews the writes",
    arguments: [INSTANCE_ARGUMENT],
    options: ADVANCE_OPTIONS,
    calls: calls(
      SELECTION_CALLS,
      VIEW_CALLS,
      [
        "complete",
        "handleBpmnError",
        "lock",
        "completeExternalTaskResource",
        "handleExternalTaskBpmnError",
        "handleFailure",
        "unlock",
        "triggerEvent",
        "throwSignal",
        "signalExecution",
      ],
      JOB_CALLS,
      UNTIL_CALLS,
      POLL_CALLS,
    ),
    examples: [
      "operate advance $INSTANCE_ID --var approved=true",
      "operate advance --business-key B-1 --activity-id charge-card --var charged=true --wait",
      "operate advance $INSTANCE_ID --activity-id charge-card --fail 'Card declined'",
    ],
  },
  {
    name: "retry",
    usage: "operate retry [process-instance-id] [options]",
    summary:
      "Retry the failed jobs and external tasks of open incidents, optionally executing the jobs at once",
    description:
      'Sets the retries of the failed jobs and external tasks behind open incidents: the incidents of a process instance tree, the named incidents (--incident), or every incident of a process definition (--process-definition-key alone, a bulk operation that needs --yes). Propagated incidents are replaced by their root cause; other incident types are skipped with a hint. --now executes the jobs at once and reports a job that failed again as "failed" with its root cause.',
    requests:
      "the selection, GET /process-instance/{id} (GET /history/process-instance/{id} for an id that is not running) and its tree, GET /incident per instance (or GET /incident/{id}, or GET /incident?processDefinitionKeyIn=), GET /incident/{id} for root causes that were not loaded, PUT /job/{id}/retries or PUT /external-task/{id}/retries, with --now POST /job/{id}/execute, " +
      CHECKED_WAIT_REQUESTS,
    effect: "write",
    effectNote:
      "bulk with --process-definition-key alone (requires --yes); --dry-run sends the reads and previews the writes",
    arguments: [INSTANCE_ARGUMENT],
    options: RETRY_OPTIONS,
    calls: calls(
      SELECTION_CALLS,
      [
        "getProcessInstance",
        "getProcessInstances",
        "getIncidents",
        "getIncident",
        "setJobRetries",
        "setExternalTaskResourceRetries",
      ],
      JOB_CALLS,
      UNTIL_CALLS,
      POLL_CALLS,
      VIEW_CALLS,
    ),
    examples: [
      "operate retry $INSTANCE_ID --now",
      "operate retry --incident $INCIDENT_ID",
      "operate retry --process-definition-key payment --activity-id call-psp --dry-run",
    ],
  },
  {
    name: "deploy",
    usage: "operate deploy <paths...> [options]",
    summary:
      "Deploy changed BPMN, DMN and form files, report the versions in effect, optionally start an instance",
    description:
      "Deploys files and directories (scanned for *.bpmn, *.bpmn20.xml, *.dmn, *.dmn11.xml and *.form, skipping dot-directories and node_modules) with the same deployment name and source every time, so unchanged files are skipped and keep their version. Reports per resource whether it was deployed now and the definitions in effect. --start or --start-key starts an instance and prints it.",
    requests:
      "GET /deployment (the latest of the name), POST /deployment/create (multipart, deploy-changed-only, deployment-source operate), GET /deployment/{id}/resources, for unchanged resources GET /deployment (the deployments of the name and source) and GET /process-definition, GET /decision-definition and GET /decision-requirements-definition per resource, with --start POST /process-definition/key/{key}/start and the instance view, " +
      WAIT_REQUESTS,
    effect: "write",
    arguments: [
      {
        name: "paths",
        required: true,
        variadic: true,
        description: "BPMN, DMN and form files and directories to deploy",
        complete: "files",
      },
    ],
    options: DEPLOY_OPTIONS,
    calls: calls(
      [
        "getDeployments",
        "createDeployment",
        "getDeploymentResources",
        "getProcessDefinitions",
        "getDecisionDefinitions",
        "getDecisionRequirementsDefinitions",
        "startProcessInstanceByKey",
        "startProcessInstanceByKeyAndTenantId",
      ],
      VIEW_CALLS,
      POLL_CALLS,
    ),
    examples: [
      "operate deploy src/main/resources",
      "operate deploy order-process.bpmn approval.dmn --start --business-key B-1 --var amount=250 --wait",
    ],
  },
  {
    name: "status",
    usage: "operate status [options]",
    summary:
      "Triage the engine: grouped incidents with root cause, job executor and external task worker health",
    description:
      "Engine triage in one call: the definitions with instances and incidents, the root incidents grouped by definition, activity, type and message with their root cause, overdue executable jobs (is the job executor running?), external task topics with waiting, locked and expired tasks (is a worker subscribed?), open tasks and failed batches. Every finding names the next command; --fail-on makes CI fail on findings.",
    requests:
      "in parallel GET /version, GET /process-definition/statistics, GET /incident and /incident/count, GET /external-task and /external-task/count, GET /job/count and GET /job (executable, created before --stale-after), GET /task/count and GET /batch/statistics; then one root cause per incident group shown",
    effect: "read",
    arguments: [],
    options: STATUS_OPTIONS,
    calls: calls([
      "getRestAPIVersion",
      "getProcessDefinitionStatistics",
      "getIncidents",
      "getIncidentsCount",
      "getExternalTasks",
      "getExternalTasksCount",
      "getJobsCount",
      "getJobs",
      "getTasksCount",
      "getBatchStatistics",
      "getStacktrace",
      "getExternalTaskErrorDetails",
    ]),
    examples: [
      "operate status",
      "operate status --process-definition-key payment --fail-on warning",
    ],
  },
]

/** The workflow command of a name. */
export function findWorkflow(name: string): WorkflowDoc | undefined {
  return WORKFLOW_DOCS.find((doc) => doc.name === name)
}

/** The pseudo group of `operate commands`. */
export const WORKFLOW_GROUP = {
  group: "workflow",
  description: `Top-level commands that combine several requests (operate <command>): ${WORKFLOW_DOCS.map((doc) => doc.name).join(", ")}`,
  commands: WORKFLOW_DOCS.length,
} as const

/** Help description: what it does, the requests in order and the effect. */
export function workflowDescription(doc: WorkflowDoc): string {
  const effect = doc.effectNote === undefined ? doc.effect : `${doc.effect}; ${doc.effectNote}`
  return [doc.description, "", `Requests: ${doc.requests}.`, "", `Effect: ${effect}`].join("\n")
}
