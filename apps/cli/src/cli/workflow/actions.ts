/**
 * The actions of the workflow commands: option values → typed options of src/workflow, the guard
 * with the effect the options give, then the command and its output.
 */

import { usageError } from '../../errors.js';
import { parseDuration } from '../../operation/durations.js';
import { advance } from '../../workflow/advance.js';
import { deploy } from '../../workflow/deploy.js';
import { inspect } from '../../workflow/inspect.js';
import { retry } from '../../workflow/retry.js';
import { retryEffect, retryMode } from '../../workflow/retry-plan.js';
import { status } from '../../workflow/status-command.js';
import { instanceText } from '../../workflow/text.js';
import {
  advanceText,
  batchText,
  deployText,
  retryText,
  statusText,
} from '../../workflow/text-views.js';
import { waitCommand, type WaitView } from '../../workflow/wait-command.js';
import { compact } from '../../util.js';
import { emitResult, guard, type WorkflowRun } from './register.js';
import {
  choice,
  given,
  integer,
  list,
  selectionOf,
  text,
  variables,
  optionalWaitSettings,
  waitSettings,
} from './values.js';

const NO_RETRIES = { min: 0, max: 2_147_483_647 };
/** Options given in their `--no-` form. */
const NEGATED: ReadonlySet<string> = new Set(['fail-on-incident', 'variables']);

function dryRun(run: WorkflowRun): boolean {
  return run.session.globals.dryRun;
}

function shown(run: WorkflowRun): boolean {
  return run.values.flags.variables !== false;
}

export async function runInspect(run: WorkflowRun): Promise<void> {
  const { flags } = run.values;
  guard(run, 'read');
  const options = {
    variables: shown(run),
    history: flags.history === true,
    stacktrace: flags.stacktrace === true,
    dryRun: dryRun(run),
  };
  await emitResult(
    run,
    await inspect(run.port, selectionOf(run.values, run.context.state.argv), options),
    instanceText,
  );
}

function checkBatchOptions(run: WorkflowRun): void {
  const { flags, args } = run.values;
  const conflicts = [
    'business-key',
    'process-definition-key',
    'latest',
    'until',
    'execute-jobs',
    'fail-on-incident',
    'variables',
  ].filter((name) => given(flags, name));
  if (args.length > 0 || conflicts.length > 0) {
    const names = [
      ...(args.length > 0 ? ['the process instance id'] : []),
      ...conflicts.map((name) => (NEGATED.has(name) ? `--no-${name}` : `--${name}`)),
    ];
    throw usageError(
      `--batch excludes ${names.join(', ')}`,
      'Wait for a batch (--batch <id>) or for a process instance, not both.',
    );
  }
}

function viewText(view: WaitView, maxWidth: number): string {
  return 'batch' in view ? batchText(view) : instanceText(view, maxWidth);
}

export async function runWait(run: WorkflowRun): Promise<void> {
  const { flags } = run.values;
  const batchId = text(flags, 'batch');
  if (batchId !== undefined) checkBatchOptions(run);
  const settings = waitSettings(flags);
  guard(run, settings.executeJobs ? 'write' : 'read');
  const options = {
    ...settings,
    selection: selectionOf(run.values, run.context.state.argv),
    ...compact({ batchId }),
    variables: shown(run),
    dryRun: dryRun(run),
  };
  await emitResult(run, await waitCommand(run.deps, options), viewText);
}

export async function runAdvance(run: WorkflowRun): Promise<void> {
  const { flags } = run.values;
  const wait = optionalWaitSettings(flags);
  const input = compact({
    activityId: text(flags, 'activity-id'),
    variables: variables(flags, 'var'),
    localVariables: variables(flags, 'local-var'),
    bpmnError: text(flags, 'bpmn-error'),
    errorMessage: text(flags, 'error-message'),
    fail: text(flags, 'fail'),
    retries: integer(flags, 'retries', NO_RETRIES),
    workerId: text(flags, 'worker-id'),
  });
  guard(run, 'write');
  const options = {
    ...input,
    selection: selectionOf(run.values, run.context.state.argv),
    ...compact({ wait }),
    variablesShown: shown(run),
    dryRun: dryRun(run),
  };
  await emitResult(run, await advance(run.deps, options), advanceText);
}

export async function runRetry(run: WorkflowRun): Promise<void> {
  const { flags } = run.values;
  const selection = selectionOf(run.values, run.context.state.argv);
  const incidentIds = list(flags, 'incident');
  const wait = optionalWaitSettings(flags);
  const retries = integer(flags, 'retries', { min: 1, max: NO_RETRIES.max }) ?? 1;
  const incidentType = choice(flags, 'incident-type', ['failedJob', 'failedExternalTask']);
  const filter = compact({ activityId: text(flags, 'activity-id'), incidentType });
  guard(run, retryEffect(retryMode(selection, incidentIds)));
  const options = {
    selection,
    incidentIds,
    filter,
    retries,
    executeNow: flags.now === true,
    ...compact({ wait }),
    variablesShown: shown(run),
    dryRun: dryRun(run),
  };
  await emitResult(run, await retry(run.deps, options), retryText);
}

function checkStartOptions(run: WorkflowRun, starts: boolean): void {
  if (starts) return;
  const { flags } = run.values;
  const names = [
    'business-key',
    'var',
    'wait',
    'until',
    'wait-timeout',
    'fail-on-incident',
    'variables',
  ];
  const name = names.find((candidate) => given(flags, candidate));
  if (name === undefined) return;
  const flag = NEGATED.has(name) ? `--no-${name}` : `--${name}`;
  throw usageError(
    `${flag} needs --start or --start-key`,
    'Example: operate deploy order.bpmn --start --business-key B-1 --var amount=250',
  );
}

export async function runDeploy(run: WorkflowRun): Promise<void> {
  const { flags, args } = run.values;
  const startKey = text(flags, 'start-key');
  const starts = startKey !== undefined || flags.start === true;
  checkStartOptions(run, starts);
  const wait = starts ? optionalWaitSettings(flags) : undefined;
  guard(run, 'write');
  const options = {
    paths: args,
    ...compact({
      name: text(flags, 'name'),
      baseDir: text(flags, 'base-dir'),
      tenantId: text(flags, 'tenant-id'),
    }),
    ...(starts ? { start: compact({ key: startKey }) } : {}),
    ...compact({
      businessKey: text(flags, 'business-key'),
      variables: variables(flags, 'var'),
      wait,
    }),
    variablesShown: shown(run),
    dryRun: dryRun(run),
  };
  const deps = { ...run.deps, fs: run.context.runtime.fs, catalog: run.context.catalog };
  await emitResult(run, await deploy(deps, options), deployText);
}

export async function runStatus(run: WorkflowRun): Promise<void> {
  const { flags } = run.values;
  const staleAfter = text(flags, 'stale-after');
  const failOn = choice(flags, 'fail-on', ['warning', 'critical'] as const);
  const options = {
    keys: list(flags, 'process-definition-key'),
    staleAfterMs: staleAfter === undefined ? 300_000 : parseDuration(staleAfter, '--stale-after'),
    maxGroups: integer(flags, 'max-groups', { min: 1, max: 100 }) ?? 10,
    ...compact({ failOn }),
    dryRun: dryRun(run),
    engine: {
      url: run.session.config.url,
      ...compact({ engine: run.session.config.engine }),
      showSecrets: run.session.globals.showSecrets,
    },
  };
  guard(run, 'read');
  await emitResult(run, await status(run.deps, options), statusText);
}
