/**
 * `--all` for operations with a `maxResults` query parameter: fetches pages (`firstResult` from
 * `--first-result` or 0, page size `--max-results` or DEFAULT_PAGE_SIZE) and concatenates them until a page is
 * shorter than the page size.
 */

import { DEFAULT_PAGE_SIZE } from '../catalog/rules.js';
import type { OperationSpec } from '../catalog/types.js';
import { OperateError, usageError } from '../errors.js';
import type { ClientOptions } from '../http/client.js';
import type { CommandRef } from '../http/errors.js';
import { buildRequest, type OperationInput, type Target } from './request.js';
import type { OperationResult, RequestPreview } from './result.js';
import { sendRequest } from './send.js';

interface Page {
  readonly first: number;
  readonly size: number;
}

function firstPage(input: OperationInput): Page {
  const { firstResult, maxResults } = input.query;
  const size = maxResults === undefined ? DEFAULT_PAGE_SIZE : Number(maxResults);
  if (!Number.isInteger(size) || size < 1) {
    throw usageError(
      `--max-results must be at least 1 with --all, got ${String(maxResults)}`,
      `Omit --max-results to use pages of ${DEFAULT_PAGE_SIZE}.`,
    );
  }
  return { first: firstResult === undefined ? 0 : Number(firstResult), size };
}

function withPage(input: OperationInput, page: Page): OperationInput {
  return {
    ...input,
    query: { ...input.query, firstResult: String(page.first), maxResults: String(page.size) },
  };
}

/** The input of the first page request, as shown by `--dry-run --all`. */
export function firstPageInput(input: OperationInput): OperationInput {
  return withPage(input, firstPage(input));
}

interface PageResult {
  readonly status: number;
  readonly items: readonly unknown[];
}

function pageResult(result: OperationResult): PageResult {
  if (result.kind === 'json' && Array.isArray(result.value)) {
    return { status: result.status, items: result.value };
  }
  const { method, url } = result.request;
  throw new OperateError(
    'INTERNAL',
    `Cannot use --all: ${method} ${url} did not return a JSON array (got ${result.kind})`,
    { request: { method, url } },
  );
}

export interface PageContext {
  readonly target: Target;
  readonly client: ClientOptions;
  readonly ref?: CommandRef;
}

export async function fetchAllPages(
  operation: OperationSpec,
  input: OperationInput,
  context: PageContext,
): Promise<OperationResult> {
  const items: unknown[] = [];
  let page = firstPage(input);
  let request: RequestPreview | undefined;
  for (;;) {
    const result = await sendRequest(
      buildRequest(operation, withPage(input, page), context.target),
      context.client,
      context.ref,
    );
    request ??= result.request;
    const { status, items: pageItems } = pageResult(result);
    // one by one: spreading a page of 125,000+ items would overflow the call stack
    for (const item of pageItems) items.push(item);
    // a page of a different size is the last one (shorter, or the engine ignored the paging)
    if (pageItems.length !== page.size) return { kind: 'json', status, value: items, request };
    page = { first: page.first + page.size, size: page.size };
  }
}
