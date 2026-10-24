/**
 * `operate wait` (design §17.5): waits for a process instance (selection, then polling with the
 * default condition `idle`) or, with `--batch`, for a batch.
 */

import { type BatchView, batchRequests, waitForBatch } from './batch.js';
import { instanceRequests } from './inspect.js';
import { checkSelection, type Selection, selectInstance, selectionRequests } from './select.js';
import type { EndedInstance, InstanceView, WorkflowResult } from './types.js';
import { checkUntil } from './until-check.js';
import { type WaitDeps, type WaitSettings, waitAndInspect } from './wait.js';

export interface WaitCommandOptions extends WaitSettings {
  readonly selection: Selection;
  readonly batchId?: string;
  readonly variables: boolean;
  readonly dryRun: boolean;
}

export type WaitView = InstanceView | EndedInstance | BatchView;

/** The first poll: the selection, else the instance (or batch) request. */
function firstRound(options: WaitCommandOptions) {
  if (options.batchId !== undefined) return batchRequests(options.batchId);
  const selection = selectionRequests(options.selection);
  return selection.length > 0
    ? selection
    : instanceRequests(options.selection.id ?? '').slice(0, 1);
}

export async function waitCommand(
  deps: WaitDeps,
  options: WaitCommandOptions,
): Promise<WorkflowResult<WaitView>> {
  if (options.batchId === undefined) checkSelection(options.selection);
  if (options.dryRun) return { kind: 'dry-run', requests: firstRound(options) };
  if (options.batchId !== undefined) return waitForBatch(deps, options.batchId, options.timeoutMs);
  const id = await selectInstance(deps.port, options.selection, 'wait');
  await checkUntil(deps.port, id, options.conditions);
  const known = options.selection.id === undefined;
  const result = await waitAndInspect(deps, { id, known }, options, {
    variables: options.variables,
    history: false,
    stacktrace: false,
  });
  return { kind: 'view', ...result };
}
