/**
 * Executes a catalog operation: guards (read-only, confirmation), body validation, request
 * building, then `--dry-run` preview, `--all` pagination or a single request.
 */

import type { Schema, OperationSpec } from '../catalog/types.js';
import type { ClientOptions } from '../http/client.js';
import type { CommandRef } from '../http/errors.js';
import { checkEffect, type GuardOptions } from './guards.js';
import { isPaginated } from '../catalog/rules.js';
import { fetchAllPages, firstPageInput } from './paginate.js';
import { dryRunPreview } from './preview.js';
import { buildRequest, type OperationInput, type Target } from './request.js';
import type { OperationResult } from './result.js';
import { sendRequest } from './send.js';
import { checkBody } from './validation.js';

export { checkEffect } from './guards.js';
export { dryRunPreview } from './preview.js';
export { sendRequest } from './send.js';

export interface ExecuteOptions extends GuardOptions {
  /** baseUrl, engine, headers */
  readonly target: Target;
  readonly client: ClientOptions;
  readonly all: boolean;
  readonly validate: boolean;
  readonly schemas: Readonly<Record<string, Schema>>;
  /** The command for the hints of HTTP errors (see `commandRef`); generic hints without it. */
  readonly ref?: CommandRef;
}

export async function executeOperation(
  operation: OperationSpec,
  input: OperationInput,
  options: ExecuteOptions,
): Promise<OperationResult> {
  checkEffect(operation.effect, `operate ${operation.group} ${operation.name}`, options);
  if (options.validate) checkBody(operation, input, options.schemas);
  const paginate = options.all && isPaginated(operation);
  if (options.dryRun) {
    const pageInput = paginate ? firstPageInput(input) : input;
    return dryRunPreview(buildRequest(operation, pageInput, options.target), options.client.auth);
  }
  if (paginate) return fetchAllPages(operation, input, options);
  return sendRequest(buildRequest(operation, input, options.target), options.client, options.ref);
}
