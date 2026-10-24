/** Wait states of hand-made instance data: each kind of record, edge cases and the order. */

import { describe, expect, it } from 'vitest';
import { activeData, activity, activityTree } from '../../test/support/workflow-fixture.js';
import type { Rec } from './records.js';
import type { InstanceData } from './types.js';
import { waitStates } from './waits.js';

const ROOT = 'z-root';
const CHILD = 'a-child';

function data(overrides: Partial<InstanceData>): InstanceData {
  return activeData({
    id: ROOT,
    tree: [
      { id: ROOT, definitionId: 'p:1:x', suspended: false, depth: 0 },
      { id: CHILD, parentId: ROOT, definitionId: 'c:1:x', suspended: false, depth: 1 },
    ],
    activityTrees: [],
    jobDefinitions: [],
    ...overrides,
  });
}

function tree(pid: string, children: readonly Rec[], transitions: readonly Rec[] = []): Rec {
  return activityTree(pid, `${pid}:def`, children, transitions);
}

describe('waitStates', () => {
  it('skips records without id, compensation and unknown event types', () => {
    expect(
      waitStates(
        data({
          tasks: [{ taskDefinitionKey: 'x' }],
          externalTasks: [{ activityId: 'y' }],
          jobs: [{ executionId: 'e' }],
          subscriptions: [
            { eventType: 'message' },
            { id: 's1', eventType: 'compensate' },
            { id: 's2' },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('fills missing strings with empty strings and takes the instance from the activity instance', () => {
    const waits = waitStates(
      data({
        activityTrees: [tree(CHILD, [activity('ai-1', 'task', 'userTask', ['ex-1'])])],
        tasks: [{ id: 't1', executionId: 'ex-1' }],
        externalTasks: [{ id: 'et1' }],
        jobs: [{ id: 'j1' }, { id: 'j2' }],
        subscriptions: [{ id: 's1', eventType: 'signal' }],
        timerJobIds: new Set(['j2']),
      }),
    );
    expect(waits).toEqual([
      { activityId: '', kind: 'externalTask', externalTaskId: 'et1', topic: '' },
      { activityId: '', kind: 'signal', eventSubscriptionId: 's1', executionId: '' },
      { activityId: '', kind: 'timer', jobId: 'j2', dueDate: '', retries: 0 },
      { activityId: '', kind: 'asyncContinuation', jobId: 'j1', retries: 0 },
      {
        activityId: '',
        kind: 'userTask',
        taskId: 't1',
        attachedTo: 'task',
        processInstanceId: CHILD,
      },
    ]);
  });

  it('copies the details of external tasks and picks their root cause incident first', () => {
    const [wait] = waitStates(
      data({
        externalTasks: [
          {
            id: 'et1',
            activityId: 'charge',
            processInstanceId: CHILD,
            topicName: 'pay',
            workerId: 'w1',
            lockExpirationTime: 'soon',
            retries: 0,
            errorMessage: 'down',
            createTime: 'then',
          },
        ],
        incidents: [
          { id: 'inc-a', rootCauseIncidentId: 'other', configuration: 'et1' },
          { id: 'inc-d', rootCauseIncidentId: 'inc-d', configuration: 'et1' },
          { id: 'inc-c', rootCauseIncidentId: 'inc-c', configuration: 'et1' },
          { id: 'inc-0', rootCauseIncidentId: 'inc-0', configuration: 'et2' },
        ],
      }),
    );
    expect(wait).toEqual({
      processInstanceId: CHILD,
      activityId: 'charge',
      since: 'then',
      incidentId: 'inc-c',
      kind: 'externalTask',
      externalTaskId: 'et1',
      topic: 'pay',
      workerId: 'w1',
      lockExpirationTime: 'soon',
      retries: 0,
      errorMessage: 'down',
    });
    const propagated = waitStates(
      data({
        externalTasks: [{ id: 'et1', activityId: 'charge' }],
        incidents: [
          { id: 'inc-b', rootCauseIncidentId: 'x', configuration: 'et1' },
          { id: 'inc-z', rootCauseIncidentId: 'inc-z', configuration: 'et1' },
        ],
      }),
    );
    expect(propagated[0]).toMatchObject({ incidentId: 'inc-z' });
  });

  it('finds the activity of a job from its definition, its failed activity or its activity instance', () => {
    const waits = waitStates(
      data({
        activityTrees: [
          tree(
            ROOT,
            [activity('ai-t', 'timer-act', 'intermediateTimer', ['ex-t'])],
            [{ id: 'ti-1', activityId: 'async-act', executionId: 'ex-a' }],
          ),
        ],
        jobDefinitions: [{ id: 'jd', activityId: 'defined' }],
        jobs: [
          { id: 'j1', jobDefinitionId: 'jd', processInstanceId: ROOT },
          { id: 'j2', failedActivityId: 'failed-act', exceptionMessage: 'boom', retries: 0 },
          { id: 'j3', executionId: 'ex-a', dueDate: 'due', retries: 3 },
          { id: 'j4', executionId: 'ex-t', dueDate: 'due' },
        ],
        timerJobIds: new Set(['j4']),
      }),
    );
    expect(waits).toEqual([
      {
        activityId: 'async-act',
        kind: 'asyncContinuation',
        jobId: 'j3',
        retries: 3,
        dueDate: 'due',
      },
      { activityId: 'defined', kind: 'asyncContinuation', jobId: 'j1', retries: 0 },
      {
        activityId: 'failed-act',
        kind: 'asyncContinuation',
        jobId: 'j2',
        retries: 0,
        exceptionMessage: 'boom',
      },
      {
        activityId: 'timer-act',
        activityType: 'intermediateTimer',
        kind: 'timer',
        jobId: 'j4',
        dueDate: 'due',
        retries: 0,
      },
    ]);
  });

  it('lists uncovered leaves as other, except call activities with called instances', () => {
    const waits = waitStates(
      data({
        tree: [
          { id: ROOT, definitionId: 'p:1:x', suspended: false, depth: 0 },
          { id: CHILD, parentId: ROOT, definitionId: 'c:1:x', suspended: false, depth: 1 },
        ],
        activityTrees: [
          tree(ROOT, [
            activity('ai-call', 'call', 'callActivity', ['ex-call']),
            activity('ai-recv', 'receive', 'receiveTask', []),
          ]),
          tree(CHILD, [activity('ai-call2', 'call2', 'callActivity', ['ex-c2'])]),
        ],
      }),
    );
    expect(waits).toEqual([
      { activityId: 'receive', activityType: 'receiveTask', kind: 'other', executionId: '' },
      {
        processInstanceId: CHILD,
        activityId: 'call2',
        activityType: 'callActivity',
        kind: 'other',
        executionId: 'ex-c2',
      },
    ]);
  });

  it('orders by tree depth, instance, activity, kind and id', () => {
    const waits = waitStates(
      data({
        tree: [
          { id: ROOT, definitionId: 'p:1:x', suspended: false, depth: 0 },
          { id: CHILD, parentId: ROOT, definitionId: 'c:1:x', suspended: false, depth: 1 },
          { id: 'b-child', parentId: ROOT, definitionId: 'c:1:x', suspended: false, depth: 1 },
        ],
        tasks: [
          { id: 't2', taskDefinitionKey: 'b', processInstanceId: ROOT },
          { id: 't1', taskDefinitionKey: 'b', processInstanceId: ROOT },
          { id: 't0', taskDefinitionKey: 'a', processInstanceId: 'b-child' },
          { id: 't9', taskDefinitionKey: 'a', processInstanceId: CHILD },
        ],
        jobs: [{ id: 'j0', failedActivityId: 'b' }],
        subscriptions: [{ id: 's0', eventType: 'message', activityId: 'b' }],
        timerJobIds: new Set(['j0']),
      }),
    );
    expect(
      waits.map((wait) => [wait.processInstanceId ?? ROOT, wait.activityId, wait.kind]),
    ).toEqual([
      [ROOT, 'b', 'userTask'],
      [ROOT, 'b', 'userTask'],
      [ROOT, 'b', 'message'],
      [ROOT, 'b', 'timer'],
      [CHILD, 'a', 'userTask'],
      ['b-child', 'a', 'userTask'],
    ]);
    expect(waits.slice(0, 2).map((wait) => (wait.kind === 'userTask' ? wait.taskId : ''))).toEqual([
      't1',
      't2',
    ]);
  });
});
