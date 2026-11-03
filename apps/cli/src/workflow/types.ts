/**
 * Views printed by the workflow commands: the views of @miragon/pulse-engine-core with their next
 * steps rendered as `pulse-cli` command lines, and its writes. Types only.
 */

import type * as core from "@miragon/pulse-engine-core"
import type { PlannedRequest } from "../engine-port/engine-port.js"
import type { PulseCliError } from "../errors.js"

/** The instance view with its next steps as ready-to-run command lines. */
export type InstanceView = core.InstanceView<string>

/** A write of a workflow command, previewed by `--dry-run` with its summary. */
export interface PlannedWrite extends PlannedRequest {
  readonly summary: string
}

/**
 * What a workflow command produced: its view (and, for exit code 9, the error to report after
 * printing it), or the requests of a `--dry-run` with the plan of the writes.
 */
export type WorkflowResult<V> =
  | { readonly kind: "view"; readonly view: V; readonly failure?: PulseCliError }
  | {
      readonly kind: "dry-run"
      readonly plan?: unknown
      readonly requests: readonly PlannedRequest[]
    }
