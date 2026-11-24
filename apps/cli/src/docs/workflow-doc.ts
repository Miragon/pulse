/**
 * The entry of a workflow command in WORKFLOW_DOCS (workflow.ts), in a module of its own so that
 * entries kept in other modules (workflow-plan-migration.ts) type against it without a cycle.
 * Types only.
 */

import type { Effect } from "../catalog/types.js"
import type { ArgumentDoc, OptionDoc } from "./options.js"

export interface WorkflowDoc {
  readonly name: string
  /** `pulse inspect [process-instance-id] [options]` */
  readonly usage: string
  readonly summary: string
  /** What the command does, in paragraphs. */
  readonly description: string
  /** The REST calls in order, as prose for `--help`. */
  readonly requests: string
  /** The base effect (for `commands --effect` and the guards). */
  readonly effect: Effect
  readonly effectNote?: string
  readonly arguments: readonly ArgumentDoc[]
  readonly options: readonly OptionDoc[]
  /** Every operationId the command may send. */
  readonly calls: readonly string[]
  readonly examples: readonly string[]
}
