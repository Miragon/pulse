/**
 * Planning of `operate advance` (design §17.6): which wait state to move, which options apply to
 * it, and the requests that move it. Pure.
 */

import { OperateError, usageError } from '../errors.js';
import type { TypedValue } from '../operation/variables.js';
import { compact } from '../util.js';
import { byActivity, isAdvanceable, isSuspendedJob, itemCommand } from './next.js';
import { engineTime } from './records.js';
import { shellWord } from './shell.js';
import type { InstanceView, PlannedWrite, WaitKind, WaitState } from './types.js';
import { waitId } from './waits.js';

export interface AdvanceInput {
  readonly activityId?: string;
  /** `--var`; absent when not given. */
  readonly variables?: Readonly<Record<string, TypedValue>>;
  readonly localVariables?: Readonly<Record<string, TypedValue>>;
  readonly bpmnError?: string;
  readonly errorMessage?: string;
  readonly fail?: string;
  readonly retries?: number;
  readonly workerId?: string;
}

const DEFAULT_WORKER = 'operate';
const LOCK_DURATION_MS = 60_000;
const READY_COMMANDS = 3;

type OptionKey = Exclude<keyof AdvanceInput, 'activityId'>;

const TASKS: readonly WaitKind[] = ['userTask', 'externalTask'];

/** The kinds an option applies to, and how the usage error names them. */
const APPLIES: Readonly<
  Record<
    OptionKey,
    { readonly flag: string; readonly kinds: readonly WaitKind[]; readonly text: string }
  >
> = {
  variables: {
    flag: '--var',
    kinds: ['userTask', 'externalTask', 'message', 'signal', 'other'],
    text: 'user tasks, external tasks, messages, signals and receive tasks',
  },
  localVariables: { flag: '--local-var', kinds: ['externalTask'], text: 'external tasks' },
  bpmnError: { flag: '--bpmn-error', kinds: TASKS, text: 'user tasks and external tasks' },
  errorMessage: { flag: '--error-message', kinds: TASKS, text: 'user tasks and external tasks' },
  fail: { flag: '--fail', kinds: ['externalTask'], text: 'external tasks' },
  retries: { flag: '--retries', kinds: ['externalTask'], text: 'external tasks' },
  workerId: { flag: '--worker-id', kinds: ['externalTask'], text: 'external tasks' },
};

/** Option combinations, checked before any request. */
export function checkAdvanceInput(input: AdvanceInput): void {
  if (input.bpmnError !== undefined && input.fail !== undefined) {
    throw usageError(
      '--bpmn-error excludes --fail',
      'Throw a BPMN error or report a failure, not both.',
    );
  }
  if (input.errorMessage !== undefined && input.bpmnError === undefined) {
    throw usageError(
      '--error-message needs --bpmn-error',
      '--fail <message> carries the message of a failure.',
    );
  }
  if (input.retries !== undefined && input.fail === undefined) {
    throw usageError('--retries needs --fail', 'Example: --fail "Card declined" --retries 2');
  }
}

function ended(view: InstanceView): boolean {
  return view.state !== 'ACTIVE' && view.state !== 'SUSPENDED';
}

/** The generated command that moves one wait state, for multi-instance hints. */
function itemHint(wait: WaitState): string {
  if (wait.kind === 'userTask') return `${itemCommand(wait) ?? ''} --var ...`;
  return (
    itemCommand(wait) ??
    `operate external-task complete ${waitId(wait)} --worker-id <worker> (after locking it)`
  );
}

function candidate(view: InstanceView, wait: WaitState) {
  return {
    activityId: wait.activityId,
    kind: wait.kind,
    id: waitId(wait),
    processInstanceId: wait.processInstanceId ?? view.id,
  };
}

/**
 * A ready command per place: `operate advance <id> --activity-id <a>` with the other options of
 * the command line, or the generated command of the first item of a multi-instance activity
 * (`advance --activity-id` refuses to pick one of its items).
 */
function placeCommand(view: InstanceView, waits: readonly WaitState[], options: string): string {
  const [first, ...more] = waits;
  if (first === undefined) return '';
  if (more.length > 0) return itemHint(first);
  return `operate advance ${view.id} --activity-id ${shellWord(first.activityId)}${options}`;
}

function several(
  view: InstanceView,
  waits: readonly WaitState[],
  options: readonly string[],
): OperateError {
  const places = [...byActivity(waits).values()];
  const data = { candidates: waits.map((wait) => candidate(view, wait)) };
  if (places.length === 1) {
    const items = waits.slice(0, READY_COMMANDS).map(itemHint);
    return new OperateError(
      'USAGE',
      `Process instance ${view.id} waits ${waits.length} times at ${waits[0]?.activityId ?? ''}`,
      { hint: `Move one item with its generated command: ${items.join(', ')}.`, data },
    );
  }
  const others = options.map((word) => ` ${word}`).join('');
  const ready = places.slice(0, READY_COMMANDS).map((place) => placeCommand(view, place, others));
  return new OperateError(
    'USAGE',
    `Process instance ${view.id} waits at ${places.length} places; choose one with --activity-id`,
    { hint: `Choose one: ${ready.join(', ')}.`, data },
  );
}

function nothing(view: InstanceView, activityId: string | undefined) {
  const waiting = view.waitingAt
    .filter(isAdvanceable)
    .map((wait) => `${wait.activityId} (${wait.kind})`);
  if (activityId !== undefined && waiting.length > 0) {
    return usageError(
      `Process instance ${view.id} does not wait at ${activityId}`,
      `It waits at: ${waiting.join(', ')}.`,
    );
  }
  let hint = `\`operate inspect ${view.id}\` shows where it waits.`;
  if (view.waitingAt.some((wait) => wait.kind === 'conditional')) {
    hint = `Conditional events react to variables: \`operate process-instance set-variable ${view.id} <name> --value <value>\`.`;
  } else if (view.truncated === true && view.children[0] !== undefined) {
    hint = `The instance tree was cut; inspect the called instances, e.g. \`operate inspect ${view.children[0].id}\`.`;
  }
  return usageError(`Process instance ${view.id} waits at nothing operate can advance`, hint);
}

/**
 * The wait state to move: the only advanceable one (of `activityId`). `options` are the other
 * words of the command line (shell quoted); the ready commands of a choice keep them.
 */
export function chooseWait(
  view: InstanceView,
  activityId?: string,
  options: readonly string[] = [],
): WaitState {
  if (ended(view)) {
    throw usageError(
      `Process instance ${view.id} has ended (${view.state}); nothing to advance`,
      `\`operate inspect ${view.id} --history\` shows the path it took.`,
    );
  }
  if (view.state === 'SUSPENDED') {
    throw usageError(
      `Process instance ${view.id} is suspended`,
      `Activate it first: \`operate process-instance activate ${view.id}\`.`,
    );
  }
  const matching = view.waitingAt.filter(
    (wait) => isAdvanceable(wait) && (activityId === undefined || wait.activityId === activityId),
  );
  // a suspended job does not count as a place while something else can move (like `next`)
  const movable = matching.filter((wait) => !isSuspendedJob(wait));
  const waits = movable.length > 0 ? movable : matching;
  const [only, ...others] = waits;
  if (only === undefined) throw nothing(view, activityId);
  if (others.length > 0) throw several(view, waits, options);
  return only;
}

/** Options that do not apply to the chosen wait state are usage errors. */
export function checkOptions(wait: WaitState, input: AdvanceInput): void {
  for (const [key, rule] of Object.entries(APPLIES) as [OptionKey, (typeof APPLIES)[OptionKey]][]) {
    if (input[key] !== undefined && !rule.kinds.includes(wait.kind)) {
      throw usageError(
        `${rule.flag} applies to ${rule.text} only; ${wait.activityId} is a ${wait.kind}`,
        'Run `operate advance --help` for the options per kind.',
      );
    }
  }
}

/** A suspended job is not executed behind the operator's back. */
export function checkSuspended(wait: WaitState): void {
  if (!isSuspendedJob(wait) || !('jobId' in wait)) return;
  throw usageError(
    `Job ${wait.jobId} at ${wait.activityId} is suspended; the job executor does not run it`,
    `Activate it first: \`operate job activate ${wait.jobId}\` (a suspended job definition suspends its new jobs too: \`operate job-definition activate <id>\`).`,
  );
}

/** A lock of another worker that has not expired is a usage error. */
export function checkLock(wait: WaitState, input: AdvanceInput, now: number): void {
  if (wait.kind !== 'externalTask' || wait.workerId === undefined) return;
  const worker = input.workerId ?? DEFAULT_WORKER;
  const until = engineTime(wait.lockExpirationTime);
  if (wait.workerId === worker || until === undefined || until <= now) return;
  throw usageError(
    `External task ${wait.externalTaskId} is locked by worker ${wait.workerId} until ${wait.lockExpirationTime ?? ''}`,
    `Pass --worker-id ${wait.workerId}, or unlock it: \`operate external-task unlock ${wait.externalTaskId}\`.`,
  );
}

function write(
  summary: string,
  operationId: string,
  pathArgs: readonly string[],
  body?: unknown,
): PlannedWrite {
  return {
    summary,
    operationId,
    input: { pathArgs, query: {}, ...(body === undefined ? {} : { body }) },
  };
}

function variablesOf(input: AdvanceInput) {
  return compact({ variables: input.variables, localVariables: input.localVariables });
}

function userTaskSteps(taskId: string, input: AdvanceInput): PlannedWrite[] {
  if (input.bpmnError === undefined) {
    return [
      write(
        `complete user task ${taskId}`,
        'complete',
        [taskId],
        compact({ variables: input.variables }),
      ),
    ];
  }
  const body = {
    errorCode: input.bpmnError,
    ...compact({ errorMessage: input.errorMessage, variables: input.variables }),
  };
  return [
    write(
      `throw BPMN error ${input.bpmnError} on user task ${taskId}`,
      'handleBpmnError',
      [taskId],
      body,
    ),
  ];
}

function externalTaskSteps(id: string, input: AdvanceInput): PlannedWrite[] {
  const workerId = input.workerId ?? DEFAULT_WORKER;
  const lock = write(`lock external task ${id} as ${workerId}`, 'lock', [id], {
    workerId,
    lockDuration: LOCK_DURATION_MS,
  });
  if (input.bpmnError !== undefined) {
    const body = {
      workerId,
      errorCode: input.bpmnError,
      ...compact({ errorMessage: input.errorMessage, variables: input.variables }),
    };
    return [
      lock,
      write(
        `throw BPMN error ${input.bpmnError} on external task ${id}`,
        'handleExternalTaskBpmnError',
        [id],
        body,
      ),
    ];
  }
  if (input.fail !== undefined) {
    const body = {
      workerId,
      errorMessage: input.fail,
      retries: input.retries ?? 0,
      retryTimeout: 0,
      ...variablesOf(input),
    };
    return [lock, write(`report a failure of external task ${id}`, 'handleFailure', [id], body)];
  }
  return [
    lock,
    write(`complete external task ${id}`, 'completeExternalTaskResource', [id], {
      workerId,
      ...variablesOf(input),
    }),
  ];
}

/** The write of a message, a signal or a receive task (`other`). */
function eventStep(wait: WaitState, input: AdvanceInput): PlannedWrite {
  const variables = compact({ variables: input.variables });
  if (wait.kind === 'message') {
    const name = wait.eventName ?? '';
    const summary = `trigger message ${name} of execution ${wait.executionId}`;
    return write(summary, 'triggerEvent', [wait.executionId, name], variables);
  }
  if (wait.kind === 'signal') {
    const name = wait.eventName ?? '';
    const body = { name, executionId: wait.executionId, ...variables };
    return write(`send signal ${name} to execution ${wait.executionId}`, 'throwSignal', [], body);
  }
  const executionId = waitId(wait);
  return write(`signal execution ${executionId}`, 'signalExecution', [executionId], variables);
}

/** The writes that move the wait state, in order. */
export function advanceSteps(wait: WaitState, input: AdvanceInput): PlannedWrite[] {
  switch (wait.kind) {
    case 'userTask':
      return userTaskSteps(wait.taskId, input);
    case 'externalTask':
      return externalTaskSteps(wait.externalTaskId, input);
    case 'timer':
    case 'asyncContinuation':
      return [write(`execute job ${wait.jobId}`, 'executeJob', [wait.jobId])];
    default:
      return [eventStep(wait, input)];
  }
}
