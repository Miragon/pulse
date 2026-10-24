/**
 * Small domain rules about catalog operations, defined once for the generator, the docs and the
 * runtime: which effects need confirmation and which operations page. Pure.
 */

import type { Effect, ParamSpec } from './types.js';

/** Page size of `--all` without `--max-results`. */
export const DEFAULT_PAGE_SIZE = 500;

/** `delete` and `bulk` operations need `--yes` (or `--dry-run`). */
export function requiresConfirmation(effect: Effect): boolean {
  return effect === 'delete' || effect === 'bulk';
}

/** Operations with a `maxResults` query parameter page their results and get `--all`. */
export function isPaginated(operation: { readonly params: readonly ParamSpec[] }): boolean {
  return operation.params.some((param) => param.in === 'query' && param.name === 'maxResults');
}
