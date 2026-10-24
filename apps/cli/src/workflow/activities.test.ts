import { describe, expect, it } from 'vitest';
import { indexActivities } from './activities.js';

const TREE = {
  id: 'root-ai',
  processInstanceId: 'pi',
  activityId: 'process',
  activityType: 'processDefinition',
  executionIds: ['pi', 7, null],
  childActivityInstances: [
    {
      id: 'sub-ai',
      activityId: 'sub',
      name: 'Sub process',
      executionIds: ['ex-sub'],
      childActivityInstances: [
        { id: 'deep-ai', activityId: 'task', activityType: 'userTask', executionIds: ['ex-sub'] },
      ],
    },
    { id: 'b-ai', activityId: 'task', activityName: 'Task', executionIds: ['ex-sub', 'ex-b'] },
    { id: 'a-ai', activityId: 'other', executionIds: 'ex-a' },
    {
      id: 'waiting-ai',
      activityId: 'waiting',
      executionIds: [],
      childTransitionInstances: [{ id: 'only-ti', activityId: 'next', executionId: 'ex-t' }],
    },
  ],
  childTransitionInstances: [
    { id: 'ti', activityId: 'async', executionId: 'ex-sub' },
    { id: 'ti-none', activityId: 'async' },
  ],
};

describe('indexActivities', () => {
  const index = indexActivities([TREE, { id: 'other-pi', childActivityInstances: [] }, {}]);

  it('flattens the trees depth first with flags, names, types and execution ids', () => {
    expect(index.nodes).toEqual([
      {
        id: 'root-ai',
        activityId: 'process',
        activityType: 'processDefinition',
        processInstanceId: 'pi',
        depth: 0,
        root: true,
        leaf: false,
        transition: false,
        executionIds: ['pi'],
      },
      {
        id: 'sub-ai',
        activityId: 'sub',
        activityName: 'Sub process',
        processInstanceId: 'pi',
        depth: 1,
        root: false,
        leaf: false,
        transition: false,
        executionIds: ['ex-sub'],
      },
      {
        id: 'deep-ai',
        activityId: 'task',
        activityType: 'userTask',
        processInstanceId: 'pi',
        depth: 2,
        root: false,
        leaf: true,
        transition: false,
        executionIds: ['ex-sub'],
      },
      {
        id: 'b-ai',
        activityId: 'task',
        activityName: 'Task',
        processInstanceId: 'pi',
        depth: 1,
        root: false,
        leaf: true,
        transition: false,
        executionIds: ['ex-sub', 'ex-b'],
      },
      {
        id: 'a-ai',
        activityId: 'other',
        processInstanceId: 'pi',
        depth: 1,
        root: false,
        leaf: true,
        transition: false,
        executionIds: [],
      },
      {
        id: 'waiting-ai',
        activityId: 'waiting',
        processInstanceId: 'pi',
        depth: 1,
        root: false,
        leaf: false,
        transition: false,
        executionIds: [],
      },
      {
        id: 'only-ti',
        activityId: 'next',
        processInstanceId: 'pi',
        depth: 2,
        root: false,
        leaf: false,
        transition: true,
        executionIds: ['ex-t'],
      },
      {
        id: 'ti',
        activityId: 'async',
        processInstanceId: 'pi',
        depth: 1,
        root: false,
        leaf: false,
        transition: true,
        executionIds: ['ex-sub'],
      },
      {
        id: 'ti-none',
        activityId: 'async',
        processInstanceId: 'pi',
        depth: 1,
        root: false,
        leaf: false,
        transition: true,
        executionIds: [],
      },
      {
        id: 'other-pi',
        activityId: '',
        processInstanceId: 'other-pi',
        depth: 0,
        root: true,
        leaf: true,
        transition: false,
        executionIds: [],
      },
      {
        id: '',
        activityId: '',
        processInstanceId: '',
        depth: 0,
        root: true,
        leaf: true,
        transition: false,
        executionIds: [],
      },
    ]);
  });

  it('finds nodes by id', () => {
    expect(index.byId('b-ai')?.activityName).toBe('Task');
    expect(index.byId('nope')).toBeUndefined();
    expect(index.byId(undefined)).toBeUndefined();
  });

  it('finds the activity instance of an execution: the activity if given, else the deepest, then by id', () => {
    expect(index.forExecution('ex-sub', 'sub')?.id).toBe('sub-ai');
    expect(index.forExecution('ex-sub', 'task')?.id).toBe('deep-ai');
    expect(index.forExecution('ex-sub')?.id).toBe('deep-ai');
    expect(index.forExecution('ex-sub', 'unknown')?.id).toBe('deep-ai');
    expect(index.forExecution('ex-b', 'sub')?.id).toBe('b-ai');
    expect(index.forExecution('ex-t')).toBeUndefined();
    expect(index.forExecution(undefined, 'task')).toBeUndefined();
    const flat = indexActivities([
      {
        id: 'r',
        childActivityInstances: [
          { id: 'y', activityId: 'a', executionIds: ['e'] },
          { id: 'x', activityId: 'a', executionIds: ['e'] },
        ],
      },
    ]);
    expect(flat.forExecution('e', 'a')?.id).toBe('x');
  });

  it('finds the transition instance of an execution', () => {
    expect(index.transition('ex-sub', 'async')?.id).toBe('ti');
    expect(index.transition('ex-t')?.id).toBe('only-ti');
    expect(index.transition('ex-b')).toBeUndefined();
    expect(index.transition(undefined)).toBeUndefined();
  });
});

describe('indexActivities ties', () => {
  it('picks the smaller id among equally deep candidates in any order', () => {
    for (const ids of [
      ['x', 'y'],
      ['y', 'x'],
    ]) {
      const index = indexActivities([
        {
          id: 'r',
          childActivityInstances: ids.map((id) => ({ id, activityId: 'a', executionIds: ['e'] })),
        },
      ]);
      expect(index.forExecution('e', 'a')?.id).toBe('x');
    }
  });
});
