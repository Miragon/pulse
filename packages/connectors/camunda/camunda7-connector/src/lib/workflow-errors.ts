/**
 * The reasons of @miragon/pulse-engine-core as tool errors: a code `withToolErrors` prints as
 * `[CODE] message`, and a message in the tools' parameter names. Names no tool.
 */

import {
  isWorkflowError,
  type Selection,
  type WorkflowErrorReason,
} from "@miragon/pulse-engine-core"

/** An error `withToolErrors` prints with its code. */
export class WorkflowToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "WorkflowToolError"
  }
}

const NO_HISTORY = "If the engine's history level is none, ended instances cannot be found."

/** `businessKey "B-1"`, `processDefinitionKey "order"` or both. */
function filters(selection: Selection): string {
  return [
    selection.businessKey === undefined ? undefined : `businessKey "${selection.businessKey}"`,
    selection.processDefinitionKey === undefined
      ? undefined
      : `processDefinitionKey "${selection.processDefinitionKey}"`,
  ]
    .filter((part) => part !== undefined)
    .join(" and ")
}

/** The filter not given yet that would narrow the selection, if any. */
function narrowing(selection: Selection): string {
  if (selection.businessKey === undefined) return ", narrow with businessKey"
  if (selection.processDefinitionKey === undefined) return ", narrow with processDefinitionKey"
  return ""
}

type Ambiguous = Extract<WorkflowErrorReason, { kind: "selection-ambiguous" }>

function ambiguous({ selection, candidates, more }: Ambiguous): WorkflowToolError {
  const both = selection.businessKey !== undefined && selection.processDefinitionKey !== undefined
  const count = more ? `more than ${String(candidates.length)}` : String(candidates.length)
  return new WorkflowToolError(
    "AMBIGUOUS_SELECTION",
    `${filters(selection)} ${both ? "match" : "matches"} ${count} process instances: pass one as ` +
      `processInstanceId${narrowing(selection)}, or take the most recently started with ` +
      `latest: true. Candidates, running before ended, the most recently started first (running ` +
      `ones without startTime last, in engine order): ${JSON.stringify(candidates)}`,
  )
}

/**
 * The tool error of the reasons the read composites raise; any other reason keeps its kind. A
 * NOT_FOUND names the engine asked (` (engine <id>)`), as the client's engine errors do.
 */
function reasonError(reason: WorkflowErrorReason, engine: string): WorkflowToolError {
  switch (reason.kind) {
    case "selection-conflict":
      return new WorkflowToolError(
        "INVALID_SELECTION",
        "processInstanceId excludes businessKey, processDefinitionKey and latest.",
      )
    case "selection-missing":
      return new WorkflowToolError(
        "INVALID_SELECTION",
        reason.latest
          ? "latest needs businessKey or processDefinitionKey."
          : "Select a process instance: processInstanceId, businessKey (optionally with " +
              "processDefinitionKey) or processDefinitionKey with latest: true.",
      )
    case "selection-not-found":
      return new WorkflowToolError(
        "NOT_FOUND",
        `No process instance with ${filters(reason.selection)}, running or in the history${engine}. ${NO_HISTORY}`,
      )
    case "selection-ambiguous":
      return ambiguous(reason)
    case "latest-needs-history":
      return new WorkflowToolError(
        "INVALID_SELECTION",
        "latest needs the history (level activity or higher) to order instances; pass processInstanceId instead.",
      )
    case "instance-missing":
      return new WorkflowToolError(
        "NOT_FOUND",
        `Process instance ${reason.id} does not exist, neither running nor in the history${engine}. ${NO_HISTORY}`,
      )
    default:
      return new WorkflowToolError("WORKFLOW", reason.kind)
  }
}

/**
 * A WorkflowError as its tool error, a NOT_FOUND naming `engineId`; anything else unchanged
 * (engine errors print as before).
 */
export function asToolError(error: unknown, engineId?: string): unknown {
  const engine = engineId === undefined ? "" : ` (engine ${engineId})`
  return isWorkflowError(error) ? reasonError(error.reason, engine) : error
}
