import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import {
  advanceSteps,
  checkAdvanceInput,
  checkLock,
  checkOptions,
  checkSuspended,
  chooseWait,
} from './advance-plan.js';
import type { InstanceView, WaitState } from './types.js';

const USER_TASK: WaitState = { activityId: 'approve', kind: 'userTask', taskId: 't1' };
const EXTERNAL: WaitState = {
  activityId: 'charge',
  kind: 'externalTask',
  externalTaskId: 'e1',
  topic: 'pay',
};
const TIMER: WaitState = {
  activityId: 'cool-down',
  kind: 'timer',
  jobId: 'j1',
  dueDate: 'd',
  retries: 3,
};
const ASYNC: WaitState = { activityId: 'book', kind: 'asyncContinuation', jobId: 'j2', retries: 3 };
const MESSAGE: WaitState = {
  activityId: 'paid',
  kind: 'message',
  eventSubscriptionId: 's1',
  eventName: 'Paid',
  executionId: 'x1',
};
const SIGNAL: WaitState = {
  activityId: 'go',
  kind: 'signal',
  eventSubscriptionId: 's2',
  eventName: 'Go',
  executionId: 'x2',
};
const RECEIVE: WaitState = {
  activityId: 'wait',
  activityType: 'receiveTask',
  kind: 'other',
  executionId: 'x3',
};
const CONDITIONAL: WaitState = {
  activityId: 'cond',
  kind: 'conditional',
  eventSubscriptionId: 's3',
  executionId: 'x4',
};

function view(
  waitingAt: readonly WaitState[],
  overrides: Partial<InstanceView> = {},
): InstanceView {
  return {
    id: 'p1',
    definition: { key: 'k', id: 'k:1:x' },
    state: 'ACTIVE',
    waitingAt,
    incidents: [],
    children: [],
    next: [],
    ...overrides,
  };
}

function usage(fn: () => unknown): OperateError {
  try {
    fn();
  } catch (error) {
    if (error instanceof OperateError) return error;
  }
  throw new Error('expected a usage error');
}

const VARS = { variables: { approved: { value: true, type: 'Boolean' } } };

describe('advanceSteps', () => {
  it.each([
    ['user task', USER_TASK, {}, [['complete', ['t1'], {}]]],
    ['user task with variables', USER_TASK, VARS, [['complete', ['t1'], VARS]]],
    [
      'user task BPMN error',
      USER_TASK,
      { bpmnError: 'REJECTED', errorMessage: 'no' },
      [['handleBpmnError', ['t1'], { errorCode: 'REJECTED', errorMessage: 'no' }]],
    ],
    [
      'external task',
      EXTERNAL,
      { ...VARS, localVariables: { l: { value: 1, type: 'Integer' } } },
      [
        ['lock', ['e1'], { workerId: 'operate', lockDuration: 60000 }],
        [
          'completeExternalTaskResource',
          ['e1'],
          { workerId: 'operate', ...VARS, localVariables: { l: { value: 1, type: 'Integer' } } },
        ],
      ],
    ],
    [
      'external task failure',
      EXTERNAL,
      { fail: 'Card declined', retries: 2, workerId: 'w1' },
      [
        ['lock', ['e1'], { workerId: 'w1', lockDuration: 60000 }],
        [
          'handleFailure',
          ['e1'],
          { workerId: 'w1', errorMessage: 'Card declined', retries: 2, retryTimeout: 0 },
        ],
      ],
    ],
    [
      'external task BPMN error',
      EXTERNAL,
      { bpmnError: 'NO_FUNDS' },
      [
        ['lock', ['e1'], { workerId: 'operate', lockDuration: 60000 }],
        ['handleExternalTaskBpmnError', ['e1'], { workerId: 'operate', errorCode: 'NO_FUNDS' }],
      ],
    ],
    ['timer', TIMER, {}, [['executeJob', ['j1'], undefined]]],
    ['async job', ASYNC, {}, [['executeJob', ['j2'], undefined]]],
    ['message', MESSAGE, VARS, [['triggerEvent', ['x1', 'Paid'], VARS]]],
    ['signal', SIGNAL, {}, [['throwSignal', [], { name: 'Go', executionId: 'x2' }]]],
    ['receive task', RECEIVE, VARS, [['signalExecution', ['x3'], VARS]]],
  ])('moves a %s', (_, wait, input, expected) => {
    const steps = advanceSteps(wait, input);
    expect(steps.map((step) => [step.operationId, step.input.pathArgs, step.input.body])).toEqual(
      expected,
    );
    expect(steps.every((step) => step.summary.length > 0)).toBe(true);
  });

  it('names the writes for the dry-run', () => {
    expect(advanceSteps(EXTERNAL, { workerId: 'w' }).map((step) => step.summary)).toEqual([
      'lock external task e1 as w',
      'complete external task e1',
    ]);
    expect(advanceSteps(MESSAGE, {}).map((step) => step.summary)).toEqual([
      'trigger message Paid of execution x1',
    ]);
  });
});

describe('checkAdvanceInput', () => {
  it.each([
    [{ bpmnError: 'X', fail: 'y' }, '--bpmn-error excludes --fail'],
    [{ errorMessage: 'x' }, '--error-message needs --bpmn-error'],
    [{ retries: 1 }, '--retries needs --fail'],
  ])('refuses %j', (input, message) => {
    expect(
      usage(() => {
        checkAdvanceInput(input);
      }).message,
    ).toBe(message);
  });
});

describe('checkOptions', () => {
  it.each([
    [USER_TASK, { fail: 'x' }, '--fail applies to external tasks only; approve is a userTask'],
    [
      USER_TASK,
      { localVariables: {} },
      '--local-var applies to external tasks only; approve is a userTask',
    ],
    [
      TIMER,
      { variables: {} },
      '--var applies to user tasks, external tasks, messages, signals and receive tasks only; cool-down is a timer',
    ],
    [
      MESSAGE,
      { bpmnError: 'X' },
      '--bpmn-error applies to user tasks and external tasks only; paid is a message',
    ],
    [
      ASYNC,
      { workerId: 'w' },
      '--worker-id applies to external tasks only; book is a asyncContinuation',
    ],
  ])('refuses options that do not apply (%#)', (wait, input, message) => {
    expect(
      usage(() => {
        checkOptions(wait, input);
      }).message,
    ).toBe(message);
  });

  it('accepts the options of the kind', () => {
    expect(() => {
      checkOptions(EXTERNAL, {
        variables: {},
        localVariables: {},
        fail: 'x',
        retries: 1,
        workerId: 'w',
      });
      checkOptions(RECEIVE, { variables: {} });
    }).not.toThrow();
  });
});

describe('checkLock', () => {
  const locked: WaitState = {
    ...EXTERNAL,
    workerId: 'other',
    lockExpirationTime: '2026-01-01T00:01:00.000+0000',
  };
  const now = Date.parse('2026-01-01T00:00:00.000Z');

  it('refuses a lock of another worker that has not expired', () => {
    const error = usage(() => {
      checkLock(locked, {}, now);
    });
    expect(error.message).toBe(
      'External task e1 is locked by worker other until 2026-01-01T00:01:00.000+0000',
    );
    expect(error.details.hint).toBe(
      'Pass --worker-id other, or unlock it: `operate external-task unlock e1`.',
    );
  });

  it('accepts the same worker, an expired lock and other kinds', () => {
    expect(() => {
      checkLock(locked, { workerId: 'other' }, now);
      checkLock(locked, {}, now + 120_000);
      checkLock(EXTERNAL, {}, now);
      checkLock(USER_TASK, {}, now);
    }).not.toThrow();
  });
});

describe('chooseWait', () => {
  it('takes the only advanceable wait state, or the one of --activity-id', () => {
    expect(chooseWait(view([USER_TASK, CONDITIONAL]))).toBe(USER_TASK);
    expect(chooseWait(view([USER_TASK, EXTERNAL]), 'charge')).toBe(EXTERNAL);
  });

  it('refuses ended and suspended instances', () => {
    expect(usage(() => chooseWait(view([], { state: 'COMPLETED' }))).message).toBe(
      'Process instance p1 has ended (COMPLETED); nothing to advance',
    );
    const suspended = usage(() => chooseWait(view([USER_TASK], { state: 'SUSPENDED' })));
    expect(suspended.message).toBe('Process instance p1 is suspended');
    expect(suspended.details.hint).toBe(
      'Activate it first: `operate process-instance activate p1`.',
    );
  });

  it('lists the places with ready commands when the instance waits at several', () => {
    const error = usage(() => chooseWait(view([USER_TASK, EXTERNAL, TIMER, MESSAGE])));
    expect(error.message).toBe(
      'Process instance p1 waits at 4 places; choose one with --activity-id',
    );
    expect(error.details.hint).toBe(
      'Choose one: operate advance p1 --activity-id approve, operate advance p1 --activity-id charge, operate advance p1 --activity-id cool-down.',
    );
    expect((error.details.data as { candidates: unknown[] }).candidates[0]).toEqual({
      activityId: 'approve',
      kind: 'userTask',
      id: 't1',
      processInstanceId: 'p1',
    });
  });

  it('names the generated command per item of a multi-instance activity', () => {
    const second: WaitState = { ...USER_TASK, taskId: 't2', processInstanceId: 'c1' };
    const error = usage(() => chooseWait(view([USER_TASK, second])));
    expect(error.message).toBe('Process instance p1 waits 2 times at approve');
    expect(error.details.hint).toBe(
      'Move one item with its generated command: operate task complete t1 --var ..., operate task complete t2 --var ....',
    );
    const jobs = usage(() => chooseWait(view([ASYNC, { ...ASYNC, jobId: 'j3' }])));
    expect(jobs.details.hint).toContain('operate job execute j2');
    const externals = usage(() =>
      chooseWait(view([EXTERNAL, { ...EXTERNAL, externalTaskId: 'e2' }])),
    );
    expect(externals.details.hint).toContain(
      'operate external-task complete e1 --worker-id <worker>',
    );
    const receive = usage(() => chooseWait(view([RECEIVE, { ...RECEIVE, executionId: 'x9' }])));
    expect(receive.details.hint).toContain('operate execution signal x3');
    // a message goes to its execution, not to the subscription id
    const messages = usage(() =>
      chooseWait(view([MESSAGE, { ...MESSAGE, eventSubscriptionId: 's9', executionId: 'x9' }])),
    );
    expect(messages.details.hint).toContain('operate execution trigger-event');
    expect(messages.details.hint).not.toContain(
      `execution signal ${'eventSubscriptionId' in MESSAGE ? MESSAGE.eventSubscriptionId : ''}`,
    );
  });

  it('counts places by activity when one of them is multi-instance', () => {
    const second: WaitState = { ...USER_TASK, taskId: 't2' };
    const error = usage(() => chooseWait(view([USER_TASK, second, EXTERNAL])));
    expect(error.message).toBe(
      'Process instance p1 waits at 2 places; choose one with --activity-id',
    );
    // --activity-id approve would refuse to pick one of its two items
    expect(error.details.hint).toBe(
      'Choose one: operate task complete t1 --var ..., operate advance p1 --activity-id charge.',
    );
  });

  it('keeps the other options of the command line in the ready commands', () => {
    const odd: WaitState = { ...EXTERNAL, activityId: 'charge card' };
    const error = usage(() =>
      chooseWait(view([USER_TASK, odd]), undefined, ['--var', "'note=two words'", '--wait']),
    );
    expect(error.details.hint).toBe(
      "Choose one: operate advance p1 --activity-id approve --var 'note=two words' --wait, operate advance p1 --activity-id 'charge card' --var 'note=two words' --wait.",
    );
  });

  it('ignores suspended jobs while something else can move, like the next commands', () => {
    const suspended: WaitState = { ...ASYNC, suspended: true };
    expect(chooseWait(view([USER_TASK, suspended]))).toBe(USER_TASK);
    expect(chooseWait(view([suspended]))).toBe(suspended);
    expect(chooseWait(view([USER_TASK, suspended]), 'book')).toBe(suspended);
  });

  it('refuses to execute a suspended job and names how to activate it', () => {
    expect(() => {
      checkSuspended(ASYNC);
      checkSuspended(USER_TASK);
    }).not.toThrow();
    const error = usage(() => {
      checkSuspended({ ...ASYNC, suspended: true });
    });
    expect(error.message).toBe('Job j2 at book is suspended; the job executor does not run it');
    expect(error.details.hint).toContain('`operate job activate j2`');
    expect(() => {
      checkSuspended({ ...TIMER, suspended: true });
    }).toThrow(/is suspended/);
  });

  it('explains why nothing can be advanced', () => {
    expect(usage(() => chooseWait(view([USER_TASK]), 'nope')).details.hint).toBe(
      'It waits at: approve (userTask).',
    );
    expect(usage(() => chooseWait(view([CONDITIONAL]))).details.hint).toBe(
      'Conditional events react to variables: `operate process-instance set-variable p1 <name> --value <value>`.',
    );
    const truncated = view([], {
      truncated: true,
      children: [{ id: 'c9', parentId: 'p1', key: 'k', state: 'ACTIVE' }],
    });
    expect(usage(() => chooseWait(truncated)).details.hint).toBe(
      'The instance tree was cut; inspect the called instances, e.g. `operate inspect c9`.',
    );
    const nothing = usage(() =>
      chooseWait(view([{ activityId: 'x', kind: 'other', executionId: 'e' }])),
    );
    expect(nothing).toMatchObject({
      message: 'Process instance p1 waits at nothing operate can advance',
      details: { hint: '`operate inspect p1` shows where it waits.' },
    });
  });
});

describe('advance plan details', () => {
  it('accepts the valid option combinations and names the fix of the invalid ones', () => {
    for (const input of [
      {},
      { bpmnError: 'X' },
      { bpmnError: 'X', errorMessage: 'm' },
      { fail: 'x' },
      { fail: 'x', retries: 1 },
    ]) {
      expect(() => {
        checkAdvanceInput(input);
      }).not.toThrow();
    }
    expect(
      [
        { bpmnError: 'X', fail: 'y' },
        { errorMessage: 'x', fail: 'y' },
        { retries: 1, bpmnError: 'X' },
      ].map((input) => {
        const error = usage(() => {
          checkAdvanceInput(input);
        });
        return [error.code, error.details.hint];
      }),
    ).toEqual([
      ['USAGE', 'Throw a BPMN error or report a failure, not both.'],
      ['USAGE', '--fail <message> carries the message of a failure.'],
      ['USAGE', 'Example: --fail "Card declined" --retries 2'],
    ]);
  });

  it('points to the help for options of another kind and checks every option', () => {
    const error = usage(() => {
      checkOptions(USER_TASK, { errorMessage: 'x', retries: 1 });
    });
    expect(error.message).toBe('--retries applies to external tasks only; approve is a userTask');
    expect(error.details.hint).toBe('Run `operate advance --help` for the options per kind.');
    expect(
      usage(() => {
        checkOptions(MESSAGE, { errorMessage: 'x' });
      }).message,
    ).toBe('--error-message applies to user tasks and external tasks only; paid is a message');
    expect(() => {
      checkOptions(USER_TASK, { variables: {}, bpmnError: 'X', errorMessage: 'x' });
      checkOptions(SIGNAL, { variables: {} });
      checkOptions(TIMER, {});
    }).not.toThrow();
  });

  it('accepts a lock that expires right now', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(() => {
      checkLock(
        { ...EXTERNAL, workerId: 'other', lockExpirationTime: '2026-01-01T00:00:00.000+0000' },
        {},
        now,
      );
      checkLock({ ...EXTERNAL, workerId: 'other' }, {}, now);
      checkLock({ ...EXTERNAL, workerId: 'operate', lockExpirationTime: '2027' }, {}, now);
    }).not.toThrow();
  });

  it('plans exact writes, without body for jobs and with empty event names', () => {
    expect(advanceSteps(TIMER, VARS)).toEqual([
      {
        summary: 'execute job j1',
        operationId: 'executeJob',
        input: { pathArgs: ['j1'], query: {} },
      },
    ]);
    expect(advanceSteps(USER_TASK, { bpmnError: 'R', ...VARS })).toEqual([
      {
        summary: 'throw BPMN error R on user task t1',
        operationId: 'handleBpmnError',
        input: { pathArgs: ['t1'], query: {}, body: { errorCode: 'R', ...VARS } },
      },
    ]);
    expect(
      advanceSteps(EXTERNAL, { bpmnError: 'R', errorMessage: 'm', ...VARS })[1]?.input.body,
    ).toEqual({ workerId: 'operate', errorCode: 'R', errorMessage: 'm', ...VARS });
    expect(advanceSteps(EXTERNAL, { fail: 'f' })[1]?.input.body).toEqual({
      workerId: 'operate',
      errorMessage: 'f',
      retries: 0,
      retryTimeout: 0,
    });
    expect(advanceSteps(EXTERNAL, { fail: 'f' })[1]?.summary).toBe(
      'report a failure of external task e1',
    );
    const { eventName: _m, ...message } = MESSAGE as WaitState & { eventName: string };
    expect(advanceSteps(message, {})).toEqual([
      {
        summary: 'trigger message  of execution x1',
        operationId: 'triggerEvent',
        input: { pathArgs: ['x1', ''], query: {}, body: {} },
      },
    ]);
    const { eventName: _s, ...signal } = SIGNAL as WaitState & { eventName: string };
    expect(advanceSteps(signal, VARS)).toEqual([
      {
        summary: 'send signal  to execution x2',
        operationId: 'throwSignal',
        input: { pathArgs: [], query: {}, body: { name: '', executionId: 'x2', ...VARS } },
      },
    ]);
    expect(advanceSteps(RECEIVE, {})[0]?.summary).toBe('signal execution x3');
    expect(advanceSteps(USER_TASK, {})[0]?.summary).toBe('complete user task t1');
  });

  it('lists at most three item commands, also for timers', () => {
    const timers = [TIMER, 'j2', 'j3', 'j4'].map((entry) =>
      typeof entry === 'string' ? { ...TIMER, jobId: entry } : entry,
    );
    const error = usage(() => chooseWait(view(timers)));
    expect(error.code).toBe('USAGE');
    expect(error.details.hint).toBe(
      'Move one item with its generated command: operate job execute j1, operate job execute j2, operate job execute j3.',
    );
    expect((error.details.data as { candidates: unknown[] }).candidates).toHaveLength(4);
    expect(usage(() => chooseWait(view([USER_TASK, EXTERNAL]))).code).toBe('USAGE');
  });

  it('only names advanceable wait states and falls back to the general hint', () => {
    expect(usage(() => chooseWait(view([CONDITIONAL, USER_TASK]), 'nope')).details.hint).toBe(
      'It waits at: approve (userTask).',
    );
    expect(usage(() => chooseWait(view([]), 'nope')).details.hint).toBe(
      '`operate inspect p1` shows where it waits.',
    );
    expect(usage(() => chooseWait(view([], { truncated: true }))).details.hint).toBe(
      '`operate inspect p1` shows where it waits.',
    );
    const children = [{ id: 'c9', parentId: 'p1', key: 'k', state: 'ACTIVE' as const }];
    expect(usage(() => chooseWait(view([], { children }))).details.hint).toBe(
      '`operate inspect p1` shows where it waits.',
    );
    expect(usage(() => chooseWait(view([], { state: 'INTERNALLY_TERMINATED' }))).details.hint).toBe(
      '`operate inspect p1 --history` shows the path it took.',
    );
  });
});
