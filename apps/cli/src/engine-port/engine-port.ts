/**
 * What the workflow commands need from an engine: the port of @miragon/pulse-engine-core plus the
 * catalog request, the `--dry-run` preview and the route of a request. Types only: the engine
 * adapters in src/engines implement it.
 */

import type * as core from "@miragon/pulse-engine-core"
import type { OperationInput } from "../operation/request.js"
import type { OperationResult, RequestPreview } from "../operation/result.js"

/** A request a workflow command sends, or previews with `--dry-run`; `summary` names a write. */
export interface PlannedRequest extends core.PlannedRequest {
  readonly summary?: string
  readonly input: OperationInput
}

/** A request preview and the note of the auth provider, if any. */
export interface AuthorizedPreview {
  readonly request: RequestPreview
  readonly note?: string
}

export interface EnginePort extends core.EnginePort {
  /** Sends the catalog operation; HTTP errors as error codes, with the command of that operation. */
  call(operationId: string, input: OperationInput): Promise<OperationResult>
  /**
   * The `--dry-run` preview of a request with the auth headers known without network access, plus
   * the auth provider's note (e.g. that there is no OAuth login).
   */
  preview(request: PlannedRequest): Promise<AuthorizedPreview>
  /** `METHOD /path` relative to the REST root, as the `Done:` line shows it. */
  route(operationId: string, input: OperationInput): string
}
