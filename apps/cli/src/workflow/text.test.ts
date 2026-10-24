import { describe, expect, it } from 'vitest';
import {
  formatElapsed,
  headerBlock,
  instanceText,
  nextBlock,
  section,
  waitedText,
} from './text.js';
import { advanceText, batchText, deployText, retryText, statusText } from './text-views.js';
import type { InstanceView } from './types.js';

const VIEW: InstanceView = {
  id: 'p1',
  businessKey: 'B-1',
  definition: { key: 'order', version: 3, name: 'Order', id: 'order:3:x' },
  state: 'ACTIVE',
  startTime: 's',
  parentId: 'parent',
  rootId: 'root',
  waitingAt: [
    { activityId: 'approve', kind: 'userTask', taskId: 't1', name: 'Approve' },
    {
      activityId: 'review',
      kind: 'userTask',
      taskId: 't2',
      assignee: 'demo',
      processInstanceId: 'c1',
    },
    {
      activityId: 'charge',
      kind: 'externalTask',
      externalTaskId: 'e1',
      topic: 'pay',
      workerId: 'w',
      retries: 0,
      errorMessage: 'declined',
    },
    { activityId: 'mail', kind: 'externalTask', externalTaskId: 'e2', topic: 'mail' },
    {
      activityId: 'remind',
      attachedTo: 'review',
      kind: 'timer',
      jobId: 'j1',
      dueDate: 'tomorrow',
      retries: 3,
    },
    {
      activityId: 'book',
      kind: 'asyncContinuation',
      jobId: 'j2',
      retries: 0,
      exceptionMessage: 'boom',
    },
    { activityId: 'ship', kind: 'asyncContinuation', jobId: 'j3', retries: 3 },
    {
      activityId: 'paid',
      kind: 'message',
      eventSubscriptionId: 's1',
      eventName: 'Paid',
      executionId: 'x1',
    },
    { activityId: 'cond', kind: 'conditional', eventSubscriptionId: 's2', executionId: 'x2' },
    { activityId: 'wait', activityType: 'receiveTask', kind: 'other', executionId: 'x3' },
    { activityId: 'odd', kind: 'other', executionId: 'x4' },
  ],
  incidents: [
    { id: 'i1', type: 'failedJob', activityId: 'book', rootCause: 'cause', since: 's' },
    {
      id: 'i2',
      type: 'custom',
      activityId: 'x',
      message: 'msg',
      processInstanceId: 'c1',
      since: 's',
    },
    { id: 'i3', type: 'custom', activityId: 'y', since: 's' },
  ],
  propagatedIncidents: 2,
  children: [
    { id: 'c1', parentId: 'p1', key: 'child', state: 'ACTIVE' },
    { id: 'c2', parentId: 'p1', key: 'child', version: 2, state: 'SUSPENDED' },
  ],
  variables: { amount: 250, order: { type: 'Json', value: '{}' } },
  timeline: [
    { activityId: 'start', activityType: 'startEvent', startTime: 's', durationMs: 5 },
    {
      activityId: 'book',
      activityType: 'serviceTask',
      startTime: 's',
      canceled: true,
      incidents: [
        { type: 'failedJob', state: 'resolved', message: 'boom' },
        { type: 'x', state: 'open' },
      ],
    },
  ],
  truncated: true,
  next: ['operate retry p1'],
  waited: { until: 'idle', elapsedMs: 1200, polls: 5 },
};

describe('text helpers', () => {
  it('aligns header values and leaves out rows without a value', () => {
    expect(
      headerBlock([
        ['Process instance', 'p1'],
        ['State', 'ACTIVE'],
        ['Ended', undefined],
        ['Root', ''],
        ['Count', 0],
      ]),
    ).toEqual(['Process instance  p1', 'State             ACTIVE', 'Count             0']);
    expect(section({ title: 'X:', columns: ['A'], rows: [] }, 80)).toEqual([]);
    expect(nextBlock([])).toEqual([]);
  });

  it('formats elapsed times and waits', () => {
    expect([350, 1200, 59_999, 125_000].map(formatElapsed)).toEqual([
      '350ms',
      '1.2s',
      '60.0s',
      '2m 5s',
    ]);
    expect(waitedText({ until: 'idle', elapsedMs: 0, polls: 1 })).toBe('idle after 0ms (1 poll)');
    expect(waitedText(undefined)).toBeUndefined();
  });
});

describe('instanceText', () => {
  it('renders the header, every section and the next commands', () => {
    expect(instanceText(VIEW, 200)).toBe(
      [
        'Process instance      p1',
        'State                 ACTIVE',
        'Definition            order v3 (Order)',
        'Business key          B-1',
        'Started               s',
        'Parent                parent',
        'Root                  root',
        'Propagated incidents  2',
        'Truncated             the instance tree was cut at depth 10 or 100 instances',
        'Waited                idle after 1.2s (5 polls)',
        '',
        'Waiting at:',
        'ACTIVITY            KIND               ID  DETAIL                                    INSTANCE',
        'approve             userTask           t1  Approve',
        'review              userTask           t2  assignee demo                             c1',
        'charge              externalTask       e1  topic pay, worker w, retries 0: declined',
        'mail                externalTask       e2  topic mail',
        'remind (on review)  timer              j1  due tomorrow',
        'book                asyncContinuation  j2  retries 0: boom',
        'ship                asyncContinuation  j3  retries 3',
        'paid                message            s1  Paid',
        'cond                conditional        s2',
        'wait                other              x3  receiveTask',
        'odd                 other              x4',
        '',
        'Incidents:',
        'TYPE       ACTIVITY  ROOT CAUSE  INSTANCE',
        'failedJob  book      cause',
        'custom     x         msg         c1',
        'custom     y',
        '',
        'Called instances:',
        'ID  KEY    VERSION  STATE      PARENT',
        'c1  child           ACTIVE     p1',
        'c2  child  2        SUSPENDED  p1',
        '',
        'Variables:',
        'NAME    VALUE  TYPE',
        'amount  250',
        'order   {}     Json',
        '',
        'Timeline:',
        '#  ACTIVITY  TYPE         START  DURATION  NOTE',
        '1  start     startEvent   s      5ms',
        '2  book      serviceTask  s                canceled; failedJob (resolved): boom; x (open)',
        '',
        'Next:',
        '  operate retry p1',
        '',
      ].join('\n'),
    );
  });

  it('renders an instance that ended without history', () => {
    expect(
      instanceText(
        { id: 'p1', state: 'ENDED', waited: { until: 'idle', elapsedMs: 0, polls: 1 } },
        80,
      ),
    ).toBe(
      'Process instance  p1\nState             ENDED (no history)\nWaited            idle after 0ms (1 poll)\n',
    );
  });
});

describe('view texts', () => {
  const instance: InstanceView = {
    id: 'p1',
    definition: { key: 'k', id: 'k:1:x' },
    state: 'COMPLETED',
    waitingAt: [],
    incidents: [],
    children: [],
    next: [],
  };

  it('renders advance, with the job executor and without via', () => {
    expect(
      advanceText(
        {
          advanced: {
            processInstanceId: 'p1',
            activityId: 'book',
            kind: 'asyncContinuation',
            id: 'j1',
            via: ['POST /job/j1/execute'],
            executedBy: 'jobExecutor',
          },
          instance,
        },
        80,
      ),
    ).toMatch(
      /^Advanced {2}book \(asyncContinuation\) via POST \/job\/j1\/execute \(executed by the job executor\)\n\nProcess instance {2}p1\n/,
    );
    expect(
      advanceText(
        {
          advanced: { processInstanceId: 'p1', activityId: 'a', kind: 'userTask', id: 't' },
          instance,
        },
        80,
      ),
    ).toMatch(/^Advanced {2}a \(userTask\)\n/);
  });

  it('renders retry with a failed entry and the instance', () => {
    const text = retryText(
      {
        retried: 1,
        succeeded: 0,
        failed: 1,
        skipped: 0,
        gone: 0,
        incidents: [
          {
            incidentId: 'i1',
            type: 'failedJob',
            activityId: 'book',
            processInstanceId: 'p1',
            action: 'retries=1, execute',
            result: 'failed',
            rootCause: 'boom',
          },
        ],
        instance,
      },
      80,
    );
    expect(text).toMatch(
      /^INCIDENT {2}TYPE {7}ACTIVITY {2}RESULT {2}ROOT CAUSE\ni1 {8}failedJob {2}book {6}failed {2}boom\n\nRetried 1, succeeded 0, failed 1, skipped 0, gone 0\n\nProcess instance {2}p1\n/,
    );
  });

  it('renders deploy with resources without definitions', () => {
    const text = deployText(
      {
        deploymentId: 'd1',
        name: 'operate',
        changed: true,
        deploymentTime: 't',
        resources: [
          { resource: 'a.form', status: 'deployed', definitions: [] },
          {
            resource: 'b.dmn',
            status: 'unchanged',
            definitions: [
              { type: 'decision', key: 'b', version: 2, id: 'b:2' },
              { type: 'drd', key: 'bd', version: 1, id: 'bd:1' },
            ],
          },
        ],
        instance,
      },
      80,
    );
    expect(text).toBe(
      [
        'Deployment  d1 (operate, changed)',
        'Time        t',
        '',
        'Resources:',
        'RESOURCE  STATUS     TYPE      KEY  VERSION',
        'a.form    deployed',
        'b.dmn     unchanged  decision  b    2',
        'b.dmn     unchanged  drd       bd   1',
        '',
        'Process instance  p1',
        'State             COMPLETED',
        'Definition        k',
        '',
      ].join('\n'),
    );
  });

  it('renders status with every section', () => {
    const text = statusText(
      {
        engine: { url: 'http://h/engine-rest', engine: 'second', version: null, latencyMs: 1500 },
        status: 'critical',
        findings: [
          { severity: 'critical', code: 'JOBS_OVERDUE', message: 'm', next: 'operate job list' },
          { severity: 'warning', code: 'X', message: 'w' },
        ],
        definitions: [
          { key: 'k', latestVersion: 1, versions: 1, instances: 2, failedJobs: 1, incidents: 1 },
        ],
        incidents: [
          {
            processDefinitionKey: 'k',
            activityId: 'a',
            type: 'failedJob',
            message: 'msg',
            count: 1,
            firstAt: 'f',
            lastAt: 'l',
            processInstanceIds: [],
            next: 'n',
          },
        ],
        incidentsTotal: 2,
        propagated: 1,
        externalTasks: [
          { topic: 't', waiting: 1, locked: 2, lockExpired: 0, failed: 0, workers: ['w1', 'w2'] },
        ],
        jobs: { executable: 3, overdue: 1, oldestReadySince: 'o' },
        tasks: { open: 4 },
        truncated: ['incidents: 2000 of 2001 loaded'],
      },
      120,
    );
    expect(text).toContain(
      'Engine  http://h/engine-rest (engine second, version unknown, 1.5s)\nStatus  critical\n',
    );
    expect(text).toContain(
      '\nFindings:\n  critical  m\n            next: operate job list\n  warning   w\n',
    );
    expect(text).toContain(
      '\nDefinitions:\nKEY  VERSIONS  INSTANCES  INCIDENTS  FAILED JOBS\nk    1         2          1          1\n',
    );
    expect(text).toContain(
      '\nIncidents:\nCOUNT  KEY  ACTIVITY  TYPE       LAST  ROOT CAUSE\n1      k    a         failedJob  l     msg\n',
    );
    expect(text).toContain(
      '\nExternal tasks:\nTOPIC  WAITING  LOCKED  EXPIRED  FAILED  OLDEST  WORKERS\nt      1        2       0        0               w1, w2\n',
    );
    expect(text).toMatch(
      /\nJobs {7}3 executable, 1 overdue \(oldest since o\)\nTasks {6}4 open\nIncidents {2}2 open, 1 propagated\nTruncated {2}incidents: 2000 of 2001 loaded\n$/,
    );
  });

  it('renders a batch', () => {
    expect(batchText({ batch: { id: 'b1', type: 'deletion', totalJobs: 3, failedJobs: 1 } })).toBe(
      'Batch        b1 (deletion)\nTotal jobs   3\nFailed jobs  1\n',
    );
  });
});

describe('view texts, other shapes', () => {
  it('renders a quiet status exactly', () => {
    const text = statusText(
      {
        engine: { url: 'http://h', version: '7.24.0', latencyMs: 12 },
        status: 'ok',
        findings: [],
        definitions: [],
        incidents: [
          {
            processDefinitionKey: 'k',
            activityId: 'a',
            type: 'failedJob',
            message: 'msg',
            rootCause: 'IOException: x',
            count: 2,
            firstAt: 'f',
            lastAt: 'l',
            processInstanceIds: [],
            next: 'n',
          },
        ],
        incidentsTotal: 0,
        propagated: 0,
        externalTasks: [
          {
            topic: 't',
            waiting: 1,
            locked: 0,
            lockExpired: 0,
            failed: 0,
            workers: [],
            oldestWaitingSince: 'o',
          },
        ],
        jobs: { executable: 3, overdue: 0 },
        tasks: { open: 0 },
        batches: { running: 1, withFailures: 0 },
      },
      120,
    );
    expect(text).toBe(
      [
        'Engine  http://h (version 7.24.0, 12ms)',
        'Status  ok',
        '',
        'Incidents:',
        'COUNT  KEY  ACTIVITY  TYPE       LAST  ROOT CAUSE',
        '2      k    a         failedJob  l     IOException: x',
        '',
        'External tasks:',
        'TOPIC  WAITING  LOCKED  EXPIRED  FAILED  OLDEST  WORKERS',
        't      1        0       0        0       o',
        '',
        'Jobs       3 executable',
        'Tasks      0 open',
        'Batches    1 running, 0 with failures',
        'Incidents  0 open, 0 propagated',
        '',
      ].join('\n'),
    );
    const overdue = statusText(
      {
        engine: { url: 'http://h', version: '1', latencyMs: 1 },
        status: 'warning',
        findings: [{ severity: 'warning', code: 'X', message: 'w', next: 'operate x' }],
        definitions: [],
        incidents: [],
        incidentsTotal: 0,
        propagated: 0,
        externalTasks: [],
        jobs: { executable: 3, overdue: 2 },
        tasks: { open: 0 },
      },
      120,
    );
    expect(overdue).toContain('\nFindings:\n  warning  w\n           next: operate x\n');
    expect(overdue).toContain('\nJobs       3 executable, 2 overdue\n');
  });

  it('renders retry without incidents and advance with an empty via', () => {
    expect(
      retryText({ retried: 0, succeeded: 0, failed: 0, skipped: 0, gone: 0, incidents: [] }, 80),
    ).toBe('No open incidents to retry.\nRetried 0, succeeded 0, failed 0, skipped 0, gone 0\n');
    const instance: InstanceView = {
      id: 'p1',
      definition: { key: 'k', id: 'k:1:x' },
      state: 'ACTIVE',
      waitingAt: [],
      incidents: [],
      children: [],
      next: [],
    };
    expect(
      advanceText(
        {
          advanced: {
            processInstanceId: 'p1',
            activityId: 'a',
            kind: 'userTask',
            id: 't',
            via: [],
          },
          instance,
        },
        80,
      ),
    ).toMatch(/^Advanced {2}a \(userTask\)\n\nProcess instance/);
    expect(
      deployText(
        { deploymentId: 'd', name: 'n', changed: false, deploymentTime: 't', resources: [] },
        80,
      ),
    ).toBe('Deployment  d (n, unchanged)\nTime        t\n');
  });

  it('renders a finished batch with times and the wait', () => {
    expect(
      batchText({
        batch: { id: 'b1', type: 'deletion', totalJobs: 3, startTime: 's', endTime: 'e' },
        waited: { until: 'finished', elapsedMs: 1500, polls: 3 },
      }),
    ).toBe(
      'Batch       b1 (deletion)\nTotal jobs  3\nStarted     s\nEnded       e\nWaited      finished after 1.5s (3 polls)\n',
    );
  });
});

describe('instance text of the comfort details', () => {
  const base: InstanceView = {
    id: 'p1',
    definition: { key: 'k', id: 'k:1:x' },
    state: 'ACTIVE',
    waitingAt: [],
    incidents: [],
    children: [],
    next: [],
  };

  it('prints the stacktrace of each incident below the incidents with --stacktrace', () => {
    const text = instanceText(
      {
        ...base,
        incidents: [
          {
            id: 'i1',
            type: 'failedJob',
            activityId: 'book',
            rootCause: 'PropertyNotFoundException: x',
            since: 's',
            stacktrace: ['org.x.ProcessEngineException: outer', '\tat org.x.Y.run(Y.java:1)'],
          },
          { id: 'i2', type: 'custom', activityId: 'other', since: 's', stacktrace: [] },
        ],
        variables: { a: 1 },
      },
      80,
    );
    expect(text).toContain(
      '\nStacktrace (failedJob at book, incident i1):\n  org.x.ProcessEngineException: outer\n   at org.x.Y.run(Y.java:1)\n\nVariables:',
    );
    expect(text).not.toContain('incident i2');
  });

  it('names the activity of a user task without its own name and marks suspended jobs', () => {
    const text = instanceText(
      {
        ...base,
        waitingAt: [
          { activityId: 'approve', activityName: 'Approve', kind: 'userTask', taskId: 't1' },
          {
            activityId: 'book',
            kind: 'asyncContinuation',
            jobId: 'j1',
            retries: 3,
            suspended: true,
          },
          {
            activityId: 'remind',
            kind: 'timer',
            jobId: 'j2',
            dueDate: 'd',
            retries: 3,
            suspended: true,
          },
        ],
      },
      120,
    );
    expect(text).toMatch(/approve +userTask +t1 +Approve/);
    expect(text).toMatch(/book +asyncContinuation +j1 +retries 3, suspended/);
    expect(text).toMatch(/remind +timer +j2 +due d, suspended/);
  });

  it('lists the follow-ups of the retry report and its request errors', () => {
    const text = retryText(
      {
        retried: 0,
        succeeded: 0,
        failed: 0,
        skipped: 1,
        gone: 0,
        errors: 1,
        incidents: [
          {
            incidentId: 'i1',
            type: 'customIncident',
            activityId: 'a',
            processInstanceId: 'p1',
            action: 'none',
            result: 'skipped',
            next: 'operate incident resolve i1 --yes',
          },
          {
            incidentId: 'i2',
            type: 'failedJob',
            activityId: 'b',
            processInstanceId: 'p1',
            action: 'retries=1',
            result: 'error',
            error: 'HTTP 500: boom',
          },
        ],
      },
      100,
    );
    expect(text).toContain('Retried 0, succeeded 0, failed 0, skipped 1, gone 0, errors 1');
    expect(text).toMatch(/i2 +failedJob +b +error +HTTP 500: boom/);
    expect(text.endsWith('\nNext:\n  operate incident resolve i1 --yes\n')).toBe(true);
  });

  it('renders an advance whose instance could not be read', () => {
    expect(
      advanceText(
        { advanced: { processInstanceId: 'p1', activityId: 'a', kind: 'userTask', id: 't' } },
        80,
      ),
    ).toBe('Advanced  a (userTask)\n');
  });
});

describe('instance text details', () => {
  const ID = 'a-very-long-task-id-0123456789abcdef';
  const view: InstanceView = {
    id: 'p1',
    definition: { key: 'k', id: 'k:1:x' },
    state: 'COMPLETED',
    endTime: 'e',
    waitingAt: [
      { activityId: 'approve-the-invoice-now', kind: 'userTask', taskId: ID },
      { activityId: 'x', kind: 'userTask', taskId: 't2', name: 'Named' },
    ],
    incidents: [],
    children: [{ id: ID, parentId: 'p1', key: 'child-process-key', state: 'ACTIVE' }],
    variables: {
      plain: 1,
      typed: { type: 'Json', value: '{}' },
      untyped: { value: 2 },
    },
    next: [],
  };

  it('never truncates ids, shows the end time and the variable types', () => {
    const lines = instanceText(view, 60).split('\n');
    expect(lines).toContain('Ended             e');
    expect(lines.filter((line) => line.includes(ID))).toHaveLength(2);
    const text = instanceText(view, 40);
    expect(text).toContain(
      '\nVariables:\nNAME     VALUE        TYPE\nplain    1\ntyped    {}           Json\nuntyped  {"value":2}\n',
    );
  });

  it('formats elapsed times at the unit boundaries', () => {
    expect([999, 1000, 59_999, 60_000, 61_500].map(formatElapsed)).toEqual([
      '999ms',
      '1.0s',
      '60.0s',
      '1m 0s',
      '1m 2s',
    ]);
  });
});
