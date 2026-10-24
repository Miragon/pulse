import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  activeData,
  activity,
  activityTree,
  approveStage,
  BOOK_ERROR,
  bookFailedStage,
  C,
  CHILD_DEF,
  CHILD_NODE,
  chargeStage,
  coolDownStage,
  endedStage,
  P,
  PARENT_DEF,
  paidStage,
  ROOT_NODE,
  waitSignalStage,
} from '../../test/support/workflow-fixture.js';
import type { Rec } from './records.js';
import { instanceView } from './snapshot.js';
import type { InstanceData, WaitState } from './types.js';
import { waitId } from './waits.js';

describe('instanceView of the verified fixture', () => {
  it('waits at the user task of the called instance (call activity not listed)', () => {
    expect(instanceView(approveStage())).toEqual({
      id: P,
      businessKey: 'WF-1',
      definition: { key: 'workflow-parent', version: 1, id: PARENT_DEF },
      state: 'ACTIVE',
      startTime: '2026-10-09T13:38:15.430+0000',
      waitingAt: [
        {
          processInstanceId: C,
          activityId: 'approve',
          activityName: 'Approve',
          activityType: 'userTask',
          since: '2026-10-09T13:38:15.431+0000',
          kind: 'userTask',
          // the task name equals the activity name: left out
          taskId: 'task-1',
        },
      ],
      incidents: [],
      children: [{ id: C, parentId: P, key: 'workflow-child', version: 1, state: 'ACTIVE' }],
      variables: { failBooking: true },
      next: [`operate advance ${P}`],
    });
  });

  it('waits at the external task, matched by its activity instance', () => {
    expect(instanceView(chargeStage()).waitingAt).toEqual([
      {
        activityId: 'charge',
        activityType: 'serviceTask',
        since: '2026-10-09T13:38:31.059+0000',
        kind: 'externalTask',
        externalTaskId: 'et-1',
        topic: 'workflow-charge',
      },
    ]);
  });

  it('waits at the message subscription', () => {
    expect(instanceView(paidStage()).waitingAt).toEqual([
      {
        activityId: 'paid',
        activityType: 'intermediateMessageCatch',
        since: '2026-10-09T13:38:31.270+0000',
        kind: 'message',
        eventSubscriptionId: 'sub-1',
        eventName: 'WorkflowPaid',
        executionId: 'ex-paid',
      },
    ]);
  });

  it('waits at the timer, its activity from the job definition', () => {
    expect(instanceView(coolDownStage()).waitingAt).toEqual([
      {
        activityId: 'cool-down',
        activityType: 'intermediateTimer',
        since: '2026-10-09T13:38:39.693+0000',
        kind: 'timer',
        jobId: 'job-timer',
        dueDate: '2026-10-09T14:38:39.693+0000',
        retries: 3,
      },
    ]);
  });

  it('shows the failed async job with its incident and root cause', () => {
    const view = instanceView(bookFailedStage());
    expect(view.waitingAt).toEqual([
      {
        activityId: 'book',
        activityType: 'serviceTask',
        since: '2026-10-09T13:38:39.700+0000',
        incidentId: 'inc-1',
        kind: 'asyncContinuation',
        jobId: 'job-book',
        retries: 0,
        // the incident carries the message
      },
    ]);
    expect(view.incidents).toEqual([
      {
        id: 'inc-1',
        type: 'failedJob',
        activityId: 'book',
        message: BOOK_ERROR,
        rootCause: "PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
        jobId: 'job-book',
        since: '2026-10-09T13:38:39.877+0000',
      },
    ]);
    expect(view.next).toEqual([`operate retry ${P}`, `operate advance ${P}`]);
  });

  it('lists a receive task without message as "other"', () => {
    expect(instanceView(waitSignalStage()).waitingAt).toEqual([
      { activityId: 'wait-signal', activityType: 'receiveTask', kind: 'other', executionId: P },
    ]);
    expect(instanceView(waitSignalStage()).next).toEqual([`operate advance ${P}`]);
  });

  it('shows an ended instance from the history with no wait states and a --history hint', () => {
    const view = instanceView(endedStage());
    expect(view).toMatchObject({
      state: 'COMPLETED',
      endTime: '2026-10-09T13:38:58.766+0000',
      durationMs: 43336,
      waitingAt: [],
      incidents: [],
      children: [],
    });
    expect(view.next).toEqual([`operate inspect ${P} --history`]);
    expect(instanceView({ ...endedStage(), historyRequested: true }).next).toEqual([]);
  });
});

describe('instanceView details', () => {
  it('sorts incidents by time and id, children by depth, key and id', () => {
    const incident = (id: string, since: string) => ({
      id,
      rootCauseIncidentId: id,
      incidentType: 'x',
      activityId: 'a',
      processInstanceId: P,
      incidentTimestamp: since,
    });
    const node = (id: string, key: string, depth: number) => ({
      id,
      parentId: P,
      definitionId: `${key}:1:x`,
      definitionKey: key,
      suspended: false,
      depth,
    });
    const view = instanceView(
      activeData({
        incidents: [
          incident('b', '2026-01-01T00:00:01.000+0000'),
          incident('c', '2026-01-01T00:00:00.000+0000'),
          incident('a', '2026-01-01T00:00:01.000+0000'),
        ],
        tree: [
          ROOT_NODE,
          node('z', 'beta', 2),
          node('y', 'beta', 1),
          node('x', 'alpha', 1),
          node('w', 'beta', 1),
        ],
      }),
    );
    expect(view.incidents.map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    expect(view.children.map((child) => child.id)).toEqual(['x', 'w', 'y', 'z']);
  });

  it('marks boundary events with attachedTo, ignores compensation, keeps conditional events', () => {
    const data = activeData({
      activityTrees: [
        activityTree(P, PARENT_DEF, [
          activity('review:ai', 'review', 'userTask', ['ex-review', 'name=Review']),
          activity('cond:ai', 'cond', 'intermediateConditional', ['ex-cond']),
        ]),
      ],
      tasks: [
        {
          id: 't1',
          taskDefinitionKey: 'review',
          executionId: 'ex-review',
          processInstanceId: P,
          assignee: 'demo',
          due: '2026-10-10T00:00:00.000+0000',
        },
      ],
      jobs: [
        {
          id: 'j-boundary',
          jobDefinitionId: 'jd-boundary',
          processInstanceId: P,
          executionId: 'ex-review',
          retries: 3,
          dueDate: '2026-10-10T00:00:00.000+0000',
        },
      ],
      timerJobIds: new Set(['j-boundary']),
      jobDefinitions: [{ id: 'jd-boundary', activityId: 'reminder' }],
      subscriptions: [
        {
          id: 's-comp',
          eventType: 'compensate',
          executionId: 'ex-review',
          processInstanceId: P,
          activityId: 'undo',
        },
        {
          id: 's-cond',
          eventType: 'conditional',
          executionId: 'ex-cond',
          processInstanceId: P,
          activityId: 'cond',
        },
        {
          id: 's-start',
          eventType: 'message',
          eventName: 'Cancel',
          executionId: P,
          processInstanceId: P,
          activityId: 'cancel-start',
        },
      ],
    });
    const waits = instanceView(data).waitingAt;
    expect(waits.map((wait) => [wait.activityId, wait.kind, wait.attachedTo])).toEqual([
      ['cancel-start', 'message', undefined],
      ['cond', 'conditional', undefined],
      ['reminder', 'timer', 'review'],
      ['review', 'userTask', undefined],
    ]);
    expect(waits.find((wait) => wait.kind === 'userTask')).toMatchObject({
      assignee: 'demo',
      due: '2026-10-10T00:00:00.000+0000',
      activityName: 'Review',
    });
    expect(instanceView(data).next).toEqual([
      `operate advance ${P} --activity-id cancel-start`,
      `operate advance ${P} --activity-id reminder`,
    ]);
  });

  it('counts propagated incidents and names the instance of a root cause in a called instance', () => {
    const data = activeData({
      tree: [ROOT_NODE, CHILD_NODE],
      activityTrees: [
        activityTree(P, PARENT_DEF, [
          activity('call:ai', 'call-approval', 'callActivity', ['ex-call']),
        ]),
        activityTree(C, CHILD_DEF, []),
      ],
      incidents: [
        {
          id: 'inc-p',
          rootCauseIncidentId: 'inc-c',
          incidentType: 'failedExternalTask',
          activityId: 'call-approval',
          processInstanceId: P,
          incidentTimestamp: '2026-01-01T00:00:01.000+0000',
        },
        {
          id: 'inc-c',
          rootCauseIncidentId: 'inc-c',
          incidentType: 'failedExternalTask',
          activityId: 'charge',
          processInstanceId: C,
          configuration: 'et-9',
          incidentMessage: 'Card declined',
          incidentTimestamp: '2026-01-01T00:00:00.000+0000',
          annotation: 'Mail sent',
        },
      ],
      causes: new Map([['inc-c', { rootCause: 'Card declined', stacktrace: ['a', 'b'] }]]),
      parentId: 'grand',
      history: {
        ...activeData().history,
        superProcessInstanceId: null,
        rootProcessInstanceId: 'grand-root',
      },
      truncated: true,
    });
    const view = instanceView(data);
    expect(view.incidents).toEqual([
      {
        id: 'inc-c',
        type: 'failedExternalTask',
        activityId: 'charge',
        processInstanceId: C,
        message: 'Card declined',
        // a root cause equal to the message is left out
        externalTaskId: 'et-9',
        since: '2026-01-01T00:00:00.000+0000',
        annotation: 'Mail sent',
        stacktrace: ['a', 'b'],
      },
    ]);
    expect(view).toMatchObject({
      propagatedIncidents: 1,
      truncated: true,
      parentId: 'grand',
      rootId: 'grand-root',
    });
    expect(view.waitingAt).toEqual([]);
  });

  it('takes the definition from the definition list without a history record', () => {
    const { history: _, ...data } = activeData({
      runtime: { id: P, definitionId: CHILD_DEF, businessKey: 'B', suspended: true },
    });
    const view = instanceView(data);
    expect(view).toMatchObject({
      businessKey: 'B',
      state: 'SUSPENDED',
      definition: { key: 'workflow-child', version: 1, name: 'Child', id: CHILD_DEF },
    });
    const unknown = instanceView({
      ...data,
      runtime: { id: P, definitionId: 'other:3:x' },
      definitions: [],
    });
    expect(unknown.definition).toEqual({ key: 'other', id: 'other:3:x' });
  });

  it('adds the timeline with the historic incidents of its activities', () => {
    const view = instanceView({
      ...endedStage(),
      timeline: [
        {
          activityId: 'start',
          activityType: 'startEvent',
          startTime: '2026-10-09T13:38:15.430+0000',
          endTime: '2026-10-09T13:38:15.430+0000',
          durationInMillis: 0,
        },
        {
          activityId: 'book',
          activityType: 'serviceTask',
          startTime: '2026-10-09T13:38:48.325+0000',
          durationInMillis: 1,
          canceled: true,
          assignee: 'x',
          calledProcessInstanceId: 'c',
        },
      ],
      historicIncidents: [
        {
          id: 'h1',
          incidentType: 'failedJob',
          activityId: 'book',
          incidentMessage: 'boom',
          createTime: '2026-10-09T13:38:39.877+0000',
          open: false,
          resolved: true,
          deleted: false,
        },
      ],
      historyRequested: true,
    });
    expect(view.timeline).toEqual([
      {
        activityId: 'start',
        activityType: 'startEvent',
        startTime: '2026-10-09T13:38:15.430+0000',
        endTime: '2026-10-09T13:38:15.430+0000',
        durationMs: 0,
      },
      {
        activityId: 'book',
        activityType: 'serviceTask',
        startTime: '2026-10-09T13:38:48.325+0000',
        durationMs: 1,
        canceled: true,
        assignee: 'x',
        calledProcessInstanceId: 'c',
        incidents: [{ type: 'failedJob', message: 'boom', state: 'resolved' }],
      },
    ]);
  });
});

/** Random wait items of a single instance, each on its own execution. */
const items = fc
  .record({
    tasks: fc.uniqueArray(fc.integer({ min: 0, max: 50 }), { maxLength: 5 }),
    externalTasks: fc.uniqueArray(fc.integer({ min: 0, max: 50 }), { maxLength: 5 }),
    jobs: fc.uniqueArray(
      fc.record({
        n: fc.integer({ min: 0, max: 50 }),
        timer: fc.boolean(),
        retries: fc.integer({ min: 0, max: 3 }),
      }),
      { maxLength: 5, selector: (job) => job.n },
    ),
    subscriptions: fc.uniqueArray(
      fc.record({
        n: fc.integer({ min: 0, max: 50 }),
        type: fc.constantFrom('message', 'signal', 'conditional', 'compensate'),
      }),
      { maxLength: 5, selector: (sub) => sub.n },
    ),
    incident: fc.boolean(),
  })
  .map(({ tasks, externalTasks, jobs, subscriptions, incident }): InstanceData => {
    const leaf = (kind: string, n: number) =>
      activity(`${kind}:${n}`, `${kind}-${n}`, kind, [`ex-${kind}-${n}`]);
    const children = [
      ...tasks.map((n) => leaf('userTask', n)),
      ...externalTasks.map((n) => leaf('serviceTask', n)),
      ...subscriptions.map((sub) => leaf('event', sub.n)),
    ];
    const transitions = jobs.map((job) => ({
      id: `t:${job.n}`,
      activityId: `job-${job.n}`,
      executionId: `ex-job-${job.n}`,
    }));
    return activeData({
      activityTrees: [activityTree(P, PARENT_DEF, children, transitions)],
      tasks: tasks.map((n) => ({
        id: `task-${n}`,
        taskDefinitionKey: `userTask-${n}`,
        executionId: `ex-userTask-${n}`,
        processInstanceId: P,
      })),
      externalTasks: externalTasks.map((n) => ({
        id: `et-${n}`,
        activityId: `serviceTask-${n}`,
        activityInstanceId: `serviceTask:${n}`,
        processInstanceId: P,
        topicName: 't',
      })),
      jobs: jobs.map((job) => ({
        id: `job-${job.n}`,
        executionId: `ex-job-${job.n}`,
        processInstanceId: P,
        retries: job.retries,
      })),
      timerJobIds: new Set(jobs.filter((job) => job.timer).map((job) => `job-${job.n}`)),
      jobDefinitions: [],
      subscriptions: subscriptions.map((sub) => ({
        id: `sub-${sub.n}`,
        eventType: sub.type,
        executionId: `ex-event-${sub.n}`,
        processInstanceId: P,
        activityId: `event-${sub.n}`,
      })),
      incidents:
        incident && jobs[0] !== undefined
          ? [
              {
                id: 'inc',
                rootCauseIncidentId: 'inc',
                incidentType: 'failedJob',
                configuration: `job-${jobs[0].n}`,
                processInstanceId: P,
                activityId: 'a',
              },
            ]
          : [],
    });
  });

function shuffled<T>(list: readonly T[], keys: readonly number[]): T[] {
  return list
    .map((item, index) => ({ item, key: keys[index % Math.max(1, keys.length)] ?? 0, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.item);
}

describe('instanceView properties', () => {
  it('lists every task, external task, job and non-compensation subscription exactly once', () => {
    fc.assert(
      fc.property(items, (data) => {
        const ids = instanceView(data).waitingAt.map(waitId);
        const expected = [
          ...data.tasks,
          ...data.externalTasks,
          ...data.jobs,
          ...data.subscriptions.filter((sub) => sub.eventType !== 'compensate'),
        ].map((item) => String(item.id));
        for (const id of expected)
          expect(ids.filter((candidate) => candidate === id)).toHaveLength(1);
        expect(
          ids.filter((id) => !expected.includes(id)).every((id) => id.startsWith('ex-event-')),
        ).toBe(true);
      }),
    );
  });

  it('does not depend on the order of the response lists', () => {
    fc.assert(
      fc.property(items, fc.array(fc.integer(), { minLength: 1, maxLength: 10 }), (data, keys) => {
        const permuted: InstanceData = {
          ...data,
          tasks: shuffled(data.tasks, keys),
          externalTasks: shuffled(data.externalTasks, keys),
          jobs: shuffled(data.jobs, keys),
          subscriptions: shuffled(data.subscriptions, keys),
          incidents: shuffled(data.incidents, keys),
          definitions: shuffled(data.definitions, keys),
          activityTrees: data.activityTrees.map((tree): Rec => ({
            ...tree,
            childActivityInstances: shuffled(tree.childActivityInstances as Rec[], keys),
          })),
        };
        expect(instanceView(permuted)).toEqual(instanceView(data));
      }),
    );
  });

  it('suggests at most 3 next commands, all with ids only', () => {
    fc.assert(
      fc.property(items, (data) => {
        const { next } = instanceView(data);
        expect(next.length).toBeLessThanOrEqual(3);
        for (const command of next)
          expect(command).toMatch(
            /^operate (retry|advance|inspect) [\w-]+( --activity-id [\w-]+| --history)?$/,
          );
      }),
    );
  });

  it('keeps wait states of called instances after those of the instance itself', () => {
    const data = approveStage();
    const extra: readonly WaitState[] = instanceView({
      ...data,
      tasks: [
        ...data.tasks,
        { id: 'task-0', taskDefinitionKey: 'zzz', executionId: P, processInstanceId: P },
      ],
    }).waitingAt;
    expect(extra.map((wait) => wait.processInstanceId)).toEqual([undefined, C]);
  });
});
