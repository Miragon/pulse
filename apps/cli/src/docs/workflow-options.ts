/**
 * The options of the workflow commands (design §17), in the option model of options.ts, so
 * registration, `--help`, `describe` and completion share one source. Pure.
 */

import { type OptionDoc, type OptionKind, VARIABLE_HELP } from './options.js';

/** An option of a workflow command; `complete` names a path value for shell completion. */
export interface WorkflowOptionDoc extends OptionDoc {
  readonly complete?: 'files' | 'dirs';
  /** Values shell completion offers (not validated, e.g. `task:` of `--until`). */
  readonly suggest?: readonly string[];
}

interface Extras {
  readonly valueName?: string;
  readonly type?: string;
  readonly enum?: readonly string[];
  readonly complete?: 'files' | 'dirs';
  readonly suggest?: readonly string[];
}

function takesValue(kind: OptionKind): boolean {
  return kind === 'value' || kind === 'repeatable';
}

function syntaxOf(flag: string, kind: OptionKind, valueName: string | undefined): string {
  if (kind === 'negated') return `--no-${flag}`;
  return valueName === undefined ? `--${flag}` : `--${flag} ${valueName}`;
}

/** An option doc: the syntax follows from the kind and the value name. */
export function option(
  flag: string,
  kind: OptionKind,
  description: string,
  extras: Extras = {},
): WorkflowOptionDoc {
  const { type, valueName, ...completion } = extras;
  const name = takesValue(kind) ? (valueName ?? '<value>') : undefined;
  return {
    flag,
    syntax: syntaxOf(flag, kind, name),
    kind,
    ...(name === undefined ? {} : { valueName: name }),
    type: type ?? (takesValue(kind) ? 'string' : 'boolean'),
    required: false,
    source: 'workflow',
    description,
    ...completion,
  };
}

/** Completion values of `--until`. */
const CONDITIONS = ['idle', 'ended', 'incident', 'task', 'task:', 'activity:'];

const SELECTION_OPTIONS: readonly WorkflowOptionDoc[] = [
  option(
    'business-key',
    'value',
    'Select the process instance by business key (running or ended)',
    { valueName: '<key>' },
  ),
  option(
    'process-definition-key',
    'value',
    'Select by process definition key; with --latest the most recently started instance',
    { valueName: '<key>' },
  ),
  option('latest', 'presence', 'Take the most recently started instance that matches the filters'),
];

/** `--until`, `--wait-timeout` and `--no-fail-on-incident`; `wait` has no `--wait`. */
const UNTIL_OPTIONS: readonly WorkflowOptionDoc[] = [
  option(
    'until',
    'repeatable',
    'Wait until idle, ended, incident, task, task:<taskDefinitionKey> or activity:<activityId>; repeatable, any one ends the wait',
    { valueName: '<condition>', type: 'condition', suggest: CONDITIONS },
  ),
  option(
    'wait-timeout',
    'value',
    'Total wait budget like 500ms, 30s, 2m or 1h (default 60s; --timeout is per request)',
    { valueName: '<duration>', type: 'duration' },
  ),
  option(
    'fail-on-incident',
    'negated',
    'Keep waiting when an incident appears (default: fail fast with INCIDENT)',
  ),
];

const WAIT_OPTIONS: readonly WorkflowOptionDoc[] = [
  option(
    'wait',
    'presence',
    'After the writes, wait until the instance is idle before printing it',
  ),
  ...UNTIL_OPTIONS.map((doc) =>
    doc.flag === 'until' ? { ...doc, description: `${doc.description} (implies --wait)` } : doc,
  ),
];

const VARIABLES_OPTION = option(
  'variables',
  'negated',
  'Leave out the variables of the instance view (and their request)',
);

function varOption(description: string): WorkflowOptionDoc {
  return option('var', 'repeatable', `${description}: ${VARIABLE_HELP}`, {
    valueName: '<name=value>',
    type: 'variables',
  });
}

export const INSPECT_OPTIONS: readonly WorkflowOptionDoc[] = [
  ...SELECTION_OPTIONS,
  VARIABLES_OPTION,
  option(
    'history',
    'presence',
    'Add the timeline: activities in BPMN order with their incidents, from the history',
  ),
  option('stacktrace', 'presence', 'Add the stacktrace (at most 200 lines) to each incident'),
];

export const WAIT_COMMAND_OPTIONS: readonly WorkflowOptionDoc[] = [
  ...SELECTION_OPTIONS,
  ...UNTIL_OPTIONS,
  option(
    'execute-jobs',
    'presence',
    'Execute due jobs of the instance tree on every poll instead of waiting for the job executor (a write)',
  ),
  VARIABLES_OPTION,
  option('batch', 'value', 'Wait until this batch finished instead of a process instance', {
    valueName: '<batch-id>',
  }),
];

export const ADVANCE_OPTIONS: readonly WorkflowOptionDoc[] = [
  ...SELECTION_OPTIONS,
  option(
    'activity-id',
    'value',
    'The activity to advance when the instance waits at several places',
    { valueName: '<id>' },
  ),
  varOption('Variable of the completion (process scope)'),
  option(
    'local-var',
    'repeatable',
    `Local variable of an external task completion: ${VARIABLE_HELP}`,
    { valueName: '<name=value>', type: 'variables' },
  ),
  option(
    'bpmn-error',
    'value',
    'Throw a BPMN error with this code instead of completing (user and external tasks)',
    { valueName: '<code>' },
  ),
  option('error-message', 'value', 'Message of the BPMN error', { valueName: '<text>' }),
  option(
    'fail',
    'value',
    'Report a failure of the external task with this message instead of completing it',
    { valueName: '<message>' },
  ),
  option('retries', 'value', 'Retries left after --fail (default 0: an incident)', {
    valueName: '<n>',
    type: 'integer',
  }),
  option(
    'worker-id',
    'value',
    'Worker that locks and completes an external task (default operate)',
    { valueName: '<id>' },
  ),
  ...WAIT_OPTIONS,
  VARIABLES_OPTION,
];

export const RETRY_OPTIONS: readonly WorkflowOptionDoc[] = [
  ...SELECTION_OPTIONS,
  option('incident', 'repeatable', 'Retry these incidents; comma separated, repeatable', {
    valueName: '<ids>',
  }),
  option('activity-id', 'value', 'Only incidents at this activity', { valueName: '<id>' }),
  option('incident-type', 'value', 'Only incidents of this type', {
    valueName: '<type>',
    enum: ['failedJob', 'failedExternalTask'],
  }),
  option('retries', 'value', 'Retries to set (default 1)', { valueName: '<n>', type: 'integer' }),
  option(
    'now',
    'presence',
    'Execute the retried jobs at once and report the ones that failed again',
  ),
  ...WAIT_OPTIONS,
  VARIABLES_OPTION,
];

export const DEPLOY_OPTIONS: readonly WorkflowOptionDoc[] = [
  option(
    'name',
    'value',
    'Deployment name (default operate); unchanged files are skipped per name',
    { valueName: '<deployment-name>' },
  ),
  option('base-dir', 'value', 'Name every resource by its path relative to this directory', {
    valueName: '<dir>',
    complete: 'dirs',
  }),
  option('tenant-id', 'value', 'Tenant of the deployment (and of the started instance)', {
    valueName: '<id>',
  }),
  option('start', 'presence', 'Start an instance of the only process of the deployed files'),
  option(
    'start-key',
    'value',
    'Start an instance of this process definition key (implies --start)',
    { valueName: '<key>' },
  ),
  option('business-key', 'value', 'Business key of the started instance', { valueName: '<key>' }),
  varOption('Variable of the started instance'),
  ...WAIT_OPTIONS,
  VARIABLES_OPTION,
];

export const STATUS_OPTIONS: readonly WorkflowOptionDoc[] = [
  option('process-definition-key', 'repeatable', 'Only these process definition keys; repeatable', {
    valueName: '<key>',
  }),
  option(
    'stale-after',
    'value',
    'Jobs and external tasks waiting longer than this are findings (default 5m)',
    { valueName: '<duration>', type: 'duration' },
  ),
  option('max-groups', 'value', 'Incident groups to show, 1 to 100 (default 10)', {
    valueName: '<n>',
    type: 'integer',
  }),
  option('fail-on', 'value', 'Exit with code 9 (CHECK_FAILED) when the status reaches this level', {
    valueName: '<level>',
    enum: ['warning', 'critical'],
  }),
];
