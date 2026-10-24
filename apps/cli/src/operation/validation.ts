/** Client side validation of JSON request bodies before they are sent (`--no-validate` skips it). */

import type { Schemas } from '../catalog/schema.js';
import type { OperationSpec } from '../catalog/types.js';
import { type Problem, validateBody } from '../catalog/validate.js';
import { OperateError } from '../errors.js';
import { jsonBody, type OperationInput } from './request.js';

const MAX_LISTED = 5;

function formatProblems(problems: readonly Problem[]): string {
  const listed = problems
    .slice(0, MAX_LISTED)
    .map((problem) => `${problem.path}: ${problem.message}`);
  const more = problems.length - MAX_LISTED;
  return `${listed.join('; ')}${more > 0 ? ` (and ${more} more)` : ''}`;
}

/** Throws VALIDATION with every problem in `details.data` if the JSON body violates its schema. */
export function checkBody(operation: OperationSpec, input: OperationInput, schemas: Schemas): void {
  if (operation.body?.kind !== 'json') return;
  const problems = validateBody(operation.body.schema, jsonBody(input), schemas);
  if (problems.length === 0) return;
  throw new OperateError('VALIDATION', `Invalid request body: ${formatProblems(problems)}`, {
    hint: `Run \`operate describe ${operation.group} ${operation.name}\` to see the body schema, or pass --no-validate to skip this check.`,
    data: problems,
  });
}
