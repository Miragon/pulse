/**
 * What the workflow commands need from an engine. Types only: the engine adapters
 * in src/engines implement it.
 */

import type { OperationInput } from "../operation/request.js"
import type { OperationResult, RequestPreview } from "../operation/result.js"

export type Query = Readonly<Record<string, string | undefined>>

/** A request a workflow command sends, or previews with `--dry-run`. */
export interface PlannedRequest {
  readonly summary?: string
  readonly operationId: string
  readonly input: OperationInput
}

/** A request preview and the note of the auth provider, if any. */
export interface AuthorizedPreview {
  readonly request: RequestPreview
  readonly note?: string
}

interface ListResult {
  readonly items: readonly Readonly<Record<string, unknown>>[]
  /** True when the engine has more than the `cap` items that were loaded. */
  readonly truncated: boolean
}

export interface EnginePort {
  /** Sends the catalog operation; HTTP errors as error codes, with the command of that operation. */
  call(operationId: string, input: OperationInput): Promise<OperationResult>
  /** The JSON value of `call`; an engine 404 (a missing resource) gives undefined. */
  find(operationId: string, input: OperationInput): Promise<unknown>
  /** The objects of a paginated list operation, all pages (500 per page), at most `cap`. */
  list(operationId: string, query: Query, cap?: number): Promise<ListResult>
  /** A text response (stacktraces, error details); 404, 204 or an empty text give undefined. */
  text(operationId: string, pathArgs: readonly string[]): Promise<string | undefined>
  /**
   * The `--dry-run` preview of a request with the auth headers known without network access, plus
   * the auth provider's note (e.g. that there is no OAuth login).
   */
  preview(request: PlannedRequest): Promise<AuthorizedPreview>
  /** `METHOD /path` relative to the REST root, as the `Done:` line shows it. */
  route(operationId: string, input: OperationInput): string
}
