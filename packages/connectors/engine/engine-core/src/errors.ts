/**
 * The errors of the workflow domain: a structured reason, never a message to show. A caller
 * renders each reason in its own words (the CLI's flags and commands, the MCP tools' parameter
 * names).
 */

import type {
  AdvanceOption,
  Candidate,
  InstanceState,
  Selection,
  WaitKind,
  WaitState,
} from "./types.js"

/** Why a workflow refused or failed, with what a message about it needs. */
export type WorkflowErrorReason =
  // selection
  /** An id together with filters or `latest`. */
  | { readonly kind: "selection-conflict" }
  /** Neither an id nor a filter; `latest` tells whether `latest` was given alone. */
  | { readonly kind: "selection-missing"; readonly latest: boolean }
  | { readonly kind: "selection-not-found"; readonly selection: Selection }
  /** The first 10 merged candidates, in order; `more` when the engine had more matches. */
  | {
      readonly kind: "selection-ambiguous"
      readonly selection: Selection
      readonly candidates: readonly Candidate[]
      readonly more: boolean
    }
  /** `latest` among several running instances without a history to order them. */
  | { readonly kind: "latest-needs-history" }
  // inspect
  | { readonly kind: "instance-missing"; readonly id: string }
  // conditions
  | { readonly kind: "condition-invalid"; readonly raw: string; readonly forms: readonly string[] }
  // retry plan
  | { readonly kind: "retry-selection-conflict" }
  | { readonly kind: "retry-selection-missing" }
  | {
      readonly kind: "retry-too-many"
      readonly max: number
      readonly processDefinitionKey?: string
    }
  // advance plan
  | {
      readonly kind: "advance-input"
      readonly rule:
        "bpmn-error-excludes-fail" | "error-message-needs-bpmn-error" | "retries-need-fail"
    }
  | { readonly kind: "advance-ended"; readonly id: string; readonly state: InstanceState }
  | { readonly kind: "advance-suspended"; readonly id: string }
  /**
   * Nothing to move (at `activityId`): `waiting` are the advanceable wait states, `conditional`
   * tells a conditional event, `firstChildId` the first called instance of a cut tree.
   */
  | {
      readonly kind: "advance-nothing"
      readonly id: string
      readonly activityId?: string
      readonly waiting: readonly { readonly activityId: string; readonly kind: WaitKind }[]
      readonly conditional: boolean
      readonly firstChildId?: string
    }
  /** Several wait states could move: `waits` in the order of the view. */
  | {
      readonly kind: "advance-ambiguous"
      readonly id: string
      readonly waits: readonly WaitState[]
    }
  /** `appliesTo`: the wait kinds the option applies to, in the order the rule lists them. */
  | {
      readonly kind: "advance-option-kind"
      readonly option: AdvanceOption
      readonly appliesTo: readonly WaitKind[]
      readonly activityId: string
      readonly waitKind: WaitKind
    }
  | { readonly kind: "advance-job-suspended"; readonly jobId: string; readonly activityId: string }
  | {
      readonly kind: "advance-locked"
      readonly externalTaskId: string
      readonly workerId: string
      readonly lockExpirationTime?: string
    }

/** A refusal or failure of the workflow domain; its message is the reason's kind. */
export class WorkflowError extends Error {
  readonly reason: WorkflowErrorReason

  constructor(reason: WorkflowErrorReason) {
    super(reason.kind)
    this.name = "WorkflowError"
    this.reason = reason
  }
}

export function isWorkflowError(error: unknown): error is WorkflowError {
  return error instanceof WorkflowError
}
