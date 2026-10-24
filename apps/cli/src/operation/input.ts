/**
 * Turns the parsed command line of an operation command into an `OperationInput`: path arguments,
 * typed query values and the JSON or multipart body. Files and stdin are read through `InputDeps`.
 */

import type { OperationSpec } from '../catalog/types.js';
import { buildJsonBody } from './body.js';
import type { CommandValues, InputDeps } from './command-values.js';
import { buildMultipart } from './multipart.js';
import { buildQuery, splitArgs } from './params.js';
import type { OperationInput } from './request.js';

export type { CommandValues, FlagValue, InputDeps } from './command-values.js';

export async function buildInput(
  operation: OperationSpec,
  values: CommandValues,
  deps: InputDeps,
): Promise<OperationInput> {
  const { pathArgs, files } = splitArgs(operation, values.args);
  const query = buildQuery(operation, values.flags);
  const body = operation.body;
  if (body?.kind === 'multipart') {
    return { pathArgs, query, multipart: await buildMultipart(body, files, values.flags, deps.fs) };
  }
  if (body?.kind === 'json') {
    return { pathArgs, query, body: await buildJsonBody(operation, body, values.flags, deps) };
  }
  return { pathArgs, query };
}
