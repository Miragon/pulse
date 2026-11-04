/**
 * The reasons of @miragon/pulse-engine-core as the usage and NOT_FOUND errors of the workflow
 * commands: one entry per reason, naming the flags and the ready commands. Pure.
 */

import {
  isWorkflowError,
  type Selection,
  type WorkflowErrorReason,
} from "@miragon/pulse-engine-core"
import { PulseCliError, usageError } from "../errors.js"
import { inputRule, nothing, optionKind, several } from "./advance-text.js"

/** What only the command line knows: the command and its other words (shell quoted). */
export interface ErrorContext {
  readonly command?: string
  readonly options?: readonly string[]
}

type Kind = WorkflowErrorReason["kind"]
type Reason<K extends Kind> = Extract<WorkflowErrorReason, { kind: K }>
type Render<K extends Kind> = (reason: Reason<K>, context: ErrorContext) => PulseCliError

const READY_COMMANDS = 3

const SELECTION_HINT =
  "Pass a process instance id, --business-key <key> (optionally with --process-definition-key <key>), or --process-definition-key <key> --latest."

const MODES_HINT =
  "Select what to retry: a process instance (id, --business-key, or --process-definition-key with --latest), incidents (--incident <id>), or every incident of a process definition (--process-definition-key <key>)."

/** NOT_FOUND for an id that neither the runtime nor the history knows. */
export function instanceMissing(id: string): PulseCliError {
  return new PulseCliError(
    "NOT_FOUND",
    `Process instance ${id} does not exist (neither running nor in the history)`,
    {
      hint: "List instances with `pulse process-instance list` (running) or `pulse historic-process-instance list` (also ended); with history level none, ended instances cannot be found.",
    },
  )
}

/** `business key "B-1"`, `process definition key "k"` or both. */
function filterText(selection: Selection): string {
  const parts = [
    selection.businessKey === undefined ? undefined : `business key "${selection.businessKey}"`,
    selection.processDefinitionKey === undefined
      ? undefined
      : `process definition key "${selection.processDefinitionKey}"`,
  ].filter((part) => part !== undefined)
  return parts.join(" and ")
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

function notFound(selection: Selection): PulseCliError {
  return new PulseCliError("NOT_FOUND", `No process instance with ${filterText(selection)}`, {
    hint: "Check the filters with `pulse process-instance list` (running instances) and `pulse historic-process-instance list` (also ended ones); with history level none, ended instances cannot be found.",
  })
}

function ambiguous(reason: Reason<"selection-ambiguous">, context: ErrorContext): PulseCliError {
  const { selection, candidates } = reason
  const both = selection.businessKey !== undefined && selection.processDefinitionKey !== undefined
  const count = reason.more ? `more than ${candidates.length}` : String(candidates.length)
  const options = context.options?.map((word) => ` ${word}`).join("") ?? ""
  const ready = candidates
    .slice(0, READY_COMMANDS)
    .map((candidate) => `pulse ${context.command ?? ""} ${candidate.id}${options}`)
  return new PulseCliError(
    "USAGE",
    `${capitalized(filterText(selection))} ${both ? "match" : "matches"} ${count} process instances`,
    {
      hint: `Choose one: ${ready.join(", ")}; or narrow the selection with --process-definition-key <key>, or take the most recently started one with --latest.`,
      data: { candidates },
    },
  )
}

function tooMany(reason: Reason<"retry-too-many">): PulseCliError {
  const definition = reason.processDefinitionKey ?? "<key>"
  return usageError(
    `More than ${reason.max} incidents to retry; pulse retries them one by one`,
    `Set the retries asynchronously instead: \`pulse job set-retries-async --body '{"jobQuery":{"processDefinitionKey":"${definition}","noRetriesLeft":true},"retries":1}' --yes\` and \`pulse external-task set-retries-async\`.`,
  )
}

const RENDER: { readonly [K in Kind]: Render<K> } = {
  "selection-conflict": () =>
    usageError(
      "The process instance id excludes --business-key, --process-definition-key and --latest",
      SELECTION_HINT,
    ),
  "selection-missing": (reason) =>
    usageError(
      reason.latest
        ? "--latest needs --business-key or --process-definition-key"
        : "Select a process instance",
      SELECTION_HINT,
    ),
  "selection-not-found": (reason) => notFound(reason.selection),
  "selection-ambiguous": ambiguous,
  "latest-needs-history": () =>
    usageError(
      "--latest needs the history (level activity or higher) to order instances",
      "Pass the process instance id instead; `pulse process-instance list` lists the running ones.",
    ),
  "instance-missing": (reason) => instanceMissing(reason.id),
  "condition-invalid": (reason) =>
    usageError(
      `--until expects one of ${reason.forms.join(", ")}, got "${reason.raw}"`,
      "Example: --until task:approve --until ended (any one of them ends the wait).",
    ),
  "retry-selection-conflict": () =>
    usageError(
      "--incident excludes the process instance id, --business-key, --process-definition-key and --latest",
      MODES_HINT,
    ),
  "retry-selection-missing": () => usageError("Select what to retry", MODES_HINT),
  "retry-too-many": tooMany,
  "advance-input": inputRule,
  "advance-ended": (reason) =>
    usageError(
      `Process instance ${reason.id} has ended (${reason.state}); nothing to advance`,
      `\`pulse inspect ${reason.id} --history\` shows the path it took.`,
    ),
  "advance-suspended": (reason) =>
    usageError(
      `Process instance ${reason.id} is suspended`,
      `Activate it first: \`pulse process-instance activate ${reason.id}\`.`,
    ),
  "advance-nothing": nothing,
  "advance-ambiguous": (reason, context) => several(reason, context.options ?? []),
  "advance-option-kind": optionKind,
  "advance-job-suspended": (reason) =>
    usageError(
      `Job ${reason.jobId} at ${reason.activityId} is suspended; the job executor does not run it`,
      `Activate it first: \`pulse job activate ${reason.jobId}\` (a suspended job definition suspends its new jobs too: \`pulse job-definition activate <id>\`).`,
    ),
  "advance-locked": (reason) =>
    usageError(
      `External task ${reason.externalTaskId} is locked by worker ${reason.workerId} until ${reason.lockExpirationTime ?? ""}`,
      `Pass --worker-id ${reason.workerId}, or unlock it: \`pulse external-task unlock ${reason.externalTaskId}\`.`,
    ),
}

/** The CLI error of a reason. */
function reasonError(reason: WorkflowErrorReason, context: ErrorContext = {}): PulseCliError {
  const render = RENDER[reason.kind] as Render<Kind>
  return render(reason, context)
}

/** A WorkflowError as its CLI error; any other error unchanged. */
function cliError(error: unknown, context: ErrorContext = {}): unknown {
  return isWorkflowError(error) ? reasonError(error.reason, context) : error
}

/** Runs `fn`; a WorkflowError it throws is rethrown as its CLI error. */
export function rendered<T>(fn: () => T, context: ErrorContext = {}): T {
  try {
    return fn()
  } catch (error) {
    throw cliError(error, context)
  }
}

/** Awaits `promise`; a WorkflowError it rejects with is rethrown as its CLI error. */
export async function renderedAsync<T>(
  promise: Promise<T>,
  context: ErrorContext = {},
): Promise<T> {
  try {
    return await promise
  } catch (error) {
    throw cliError(error, context)
  }
}
