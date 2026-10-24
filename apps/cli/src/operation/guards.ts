/**
 * Guard rails checked before a request is sent: read-only mode refuses every effect other than
 * `read`, and `delete` / `bulk` effects need `--yes`. `--dry-run` passes both guards.
 */

import { requiresConfirmation } from '../catalog/rules.js';
import type { Effect } from '../catalog/types.js';
import { OperateError } from '../errors.js';

export interface GuardOptions {
  readonly readOnly: boolean;
  /** Where read-only mode was enabled, e.g. `--read-only`, `OPERATE_READ_ONLY` or `profile "prod"`. */
  readonly readOnlySource?: string;
  readonly yes: boolean;
  readonly dryRun: boolean;
}

const CONFIRMATION_HINT = 'Re-run with --yes to confirm, or --dry-run to preview.';

function readOnlyHint(source: string | undefined): string {
  const origin =
    source === undefined
      ? 'Read-only mode is enabled (--read-only, OPERATE_READ_ONLY or the profile setting readOnly).'
      : `Read-only mode is enabled by ${source}.`;
  return `${origin} Use --dry-run to preview the request.`;
}

/**
 * Throws READ_ONLY or CONFIRMATION_REQUIRED. `label` names the command in the message, e.g.
 * `operate process-instance delete`.
 */
export function checkEffect(effect: Effect, label: string, options: GuardOptions): void {
  if (options.dryRun || effect === 'read') return;
  if (options.readOnly) {
    throw new OperateError(
      'READ_ONLY',
      `\`${label}\` is a ${effect} operation and read-only mode is enabled`,
      { hint: readOnlyHint(options.readOnlySource) },
    );
  }
  if (requiresConfirmation(effect) && !options.yes) {
    throw new OperateError(
      'CONFIRMATION_REQUIRED',
      `\`${label}\` is a ${effect} operation and needs confirmation`,
      { hint: CONFIRMATION_HINT },
    );
  }
}
