/** The instance view of sparse or unusual engine data: fallbacks and defaults. */

import { describe, expect, it } from 'vitest';
import { instanceView } from './snapshot.js';
import type { InstanceData } from './types.js';

function data(overrides: Partial<InstanceData>): InstanceData {
  return {
    id: 'pi',
    tree: [{ id: 'pi', definitionId: 'd', suspended: false, depth: 0 }],
    truncated: false,
    activityTrees: [],
    incidents: [],
    subscriptions: [],
    tasks: [],
    externalTasks: [],
    jobs: [],
    timerJobIds: new Set(),
    definitions: [],
    jobDefinitions: [],
    causes: new Map(),
    historyRequested: false,
    ...overrides,
  };
}

describe('instanceView without history', () => {
  it('takes the definition from the definition list, else from its id', () => {
    const runtime = { id: 'pi', definitionId: 'order:3:x', businessKey: 'B', suspended: true };
    const listed = instanceView(
      data({
        runtime,
        parentId: 'up',
        definitions: [
          { id: 'other:1:x', key: 'other' },
          { id: 'order:3:x', key: 'order-key', version: 3, name: 'Order' },
        ],
      }),
    );
    expect(listed).toMatchObject({
      id: 'pi',
      businessKey: 'B',
      definition: { key: 'order-key', version: 3, name: 'Order', id: 'order:3:x' },
      state: 'SUSPENDED',
      parentId: 'up',
    });
    expect(Object.keys(listed)).toEqual([
      'id',
      'businessKey',
      'definition',
      'state',
      'parentId',
      'waitingAt',
      'incidents',
      'children',
      'next',
    ]);
    expect(instanceView(data({ runtime: { definitionId: 'order:3:x' } })).definition).toEqual({
      key: 'order',
      id: 'order:3:x',
    });
    expect(instanceView(data({ runtime: {} }))).toMatchObject({
      definition: { key: '', id: '' },
      state: 'ACTIVE',
    });
  });
});

describe('instanceView with history', () => {
  it('reads the definition and the times of the history record', () => {
    const view = instanceView(
      data({
        parentId: 'ignored',
        history: {
          processDefinitionId: 'order:2:x',
          businessKey: 'H',
          startTime: 's',
          endTime: 'e',
          durationInMillis: 5,
          deleteReason: 'gone',
          superProcessInstanceId: 'parent',
          rootProcessInstanceId: 'root',
          state: 'EXTERNALLY_TERMINATED',
        },
      }),
    );
    expect(view).toEqual({
      id: 'pi',
      businessKey: 'H',
      definition: { key: 'order', id: 'order:2:x' },
      state: 'EXTERNALLY_TERMINATED',
      startTime: 's',
      endTime: 'e',
      durationMs: 5,
      deleteReason: 'gone',
      parentId: 'parent',
      rootId: 'root',
      waitingAt: [],
      incidents: [],
      children: [],
      next: ['operate inspect pi --history'],
    });
    expect(
      instanceView(
        data({
          history: {
            processDefinitionId: 'order:2:x',
            processDefinitionKey: 'k',
            processDefinitionVersion: 2,
            processDefinitionName: 'N',
            rootProcessInstanceId: 'pi',
          },
        }),
      ),
    ).toMatchObject({ definition: { key: 'k', version: 2, name: 'N', id: 'order:2:x' } });
    const ended = instanceView(data({ history: {} }));
    expect(ended.state).toBe('COMPLETED');
    expect(ended.definition).toEqual({ key: '', id: '' });
  });
});

describe('instanceView incidents and children', () => {
  it('fills missing incident fields and counts propagated incidents', () => {
    const view = instanceView(
      data({
        runtime: {},
        incidents: [
          {},
          {
            id: 'b',
            rootCauseIncidentId: 'b',
            incidentType: 'failedExternalTask',
            configuration: 'et-1',
            processInstanceId: 'pi',
            incidentTimestamp: '2026-01-01T00:00:00.000+0000',
            annotation: 'note',
          },
          {
            id: 'a',
            rootCauseIncidentId: 'a',
            incidentType: 'failedJob',
            configuration: 'job-1',
            processInstanceId: 'child',
            incidentTimestamp: '2026-01-01T00:00:00.000+0000',
          },
          { id: 'c', rootCauseIncidentId: 'a' },
          { id: 'd', rootCauseIncidentId: 'b' },
        ],
      }),
    );
    expect(view.incidents).toEqual([
      {
        id: 'a',
        type: 'failedJob',
        activityId: '',
        processInstanceId: 'child',
        jobId: 'job-1',
        since: '2026-01-01T00:00:00.000+0000',
      },
      {
        id: 'b',
        type: 'failedExternalTask',
        activityId: '',
        externalTaskId: 'et-1',
        since: '2026-01-01T00:00:00.000+0000',
        annotation: 'note',
      },
      { id: '', type: '', activityId: '', since: '' },
    ]);
    expect(view.propagatedIncidents).toBe(2);
  });

  it('sorts children by depth, key and id with key and version from the definitions', () => {
    const view = instanceView(
      data({
        runtime: {},
        definitions: [{ id: 'c:7:x', key: 'listed', version: 7 }],
        tree: [
          { id: 'pi', definitionId: 'd', suspended: false, depth: 0 },
          {
            id: 'deep',
            parentId: 'mid',
            definitionId: 'x',
            definitionKey: 'a',
            suspended: false,
            depth: 2,
          },
          { id: 'z', definitionId: 'c:7:x', suspended: true, depth: 1 },
          {
            id: 'y',
            definitionId: 'c:7:x',
            definitionKey: 'b',
            businessKey: 'BK',
            suspended: false,
            depth: 1,
          },
          { id: 'x', definitionId: 'none', definitionKey: 'b', suspended: false, depth: 1 },
          { id: 'w', definitionId: 'none', suspended: false, depth: 1 },
        ],
      }),
    );
    expect(view.children).toEqual([
      { id: 'w', parentId: 'pi', key: '', state: 'ACTIVE' },
      { id: 'z', parentId: 'pi', key: 'listed', version: 7, state: 'SUSPENDED' },
      { id: 'x', parentId: 'pi', key: 'b', state: 'ACTIVE' },
      { id: 'y', parentId: 'pi', key: 'b', version: 7, businessKey: 'BK', state: 'ACTIVE' },
      { id: 'deep', parentId: 'mid', key: 'a', state: 'ACTIVE' },
    ]);
  });

  it('builds the timeline without historic incidents', () => {
    const view = instanceView(
      data({
        runtime: {},
        timeline: [{ id: 'h1', activityId: 'start', activityType: 'startEvent' }],
        truncated: true,
      }),
    );
    expect(view.timeline).toEqual([expect.objectContaining({ activityId: 'start' })]);
    expect(view.truncated).toBe(true);
  });
});

describe('instanceView ties', () => {
  it('orders equal incidents and children by id in any input order', () => {
    const incident = (id: string) => ({
      id,
      rootCauseIncidentId: id,
      incidentTimestamp: '2026-01-01T00:00:00.000+0000',
    });
    const child = (id: string) => ({
      id,
      parentId: 'pi',
      definitionId: 'c:1:x',
      definitionKey: 'k',
      suspended: false,
      depth: 1,
    });
    for (const ids of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      const view = instanceView(
        data({
          runtime: {},
          incidents: ids.map(incident),
          tree: [{ id: 'pi', definitionId: 'd', suspended: false, depth: 0 }, ...ids.map(child)],
        }),
      );
      expect(view.incidents.map((entry) => entry.id)).toEqual(['a', 'b']);
      expect(view.children.map((entry) => entry.id)).toEqual(['a', 'b']);
    }
  });
});
