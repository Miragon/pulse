import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
  type InstanceDetail,
  type WaitState,
} from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import type { IncidentRow } from '../../src/core/protocol/index.js';
import { InstanceHeadline } from '../../src/core/views/instance-headline.js';
import { InstanceViewBuilder } from '../../src/core/views/instance-view-builder.js';

const ROOT = InstanceId('8f3c2a1e-0000-4000-8000-000000000001');
const CHILD = InstanceId('8f3c2a1e-0000-4000-8000-000000000002');
const GRANDCHILD = InstanceId('8f3c2a1e-0000-4000-8000-000000000003');
const ELEMENT = ElementId('Activity_Wait');
const SINCE = IsoTimestamp('2026-10-21T08:00:00Z');

function detailWith(changes: Partial<InstanceDetail>): InstanceDetail {
  return {
    instance: {
      id: ROOT,
      definition: {
        id: DefinitionId('order:1'),
        bpmnProcessId: BpmnProcessId('order'),
        version: 1,
      },
      state: 'running',
      hasIncident: false,
    },
    path: [],
    waitStates: [],
    incidents: [],
    calledInstances: [],
    variables: [],
    truncated: false,
    ...changes,
  };
}

function viewOf(detail: InstanceDetail) {
  return new InstanceViewBuilder({
    writable: false,
    engine: { name: 'local', environment: 'local', host: 'localhost' },
    asOf: new Date(SINCE),
    detail,
    diagramXml: '<definitions/>',
    calledProcesses: [],
    fullDetails: new Map(),
  }).build();
}

function wait(kind: WaitState): WaitState {
  return kind;
}

describe('the instance view', () => {
  test('describes every kind of wait state', () => {
    const base = { instanceId: ROOT, elementId: ELEMENT };
    const view = viewOf(
      detailWith({
        waitStates: [
          wait({ ...base, kind: 'userTask' }),
          wait({ ...base, kind: 'workerTask', taskType: 'send-mail' }),
          wait({ ...base, kind: 'asyncContinuation', retriesLeft: 2 }),
          wait({ ...base, kind: 'asyncContinuation' }),
          wait({ ...base, kind: 'timer', dueAt: SINCE }),
          wait({ ...base, kind: 'message', messageName: 'PaymentReceived' }),
          wait({ ...base, kind: 'signal', signalName: 'Stop' }),
          wait({ ...base, kind: 'other', description: 'Conditional event' }),
        ],
      }),
    );
    expect(view.waitStates.map((row) => [row.kindLabel, row.detail, row.dueAt])).toEqual([
      ['User task', 'Unassigned', undefined],
      ['Worker task', 'Task type send-mail', undefined],
      ['Async continuation', '2 retries left', undefined],
      ['Async continuation', undefined, undefined],
      ['Timer', undefined, '2026-10-21T08:00:00.000Z'],
      ['Message', 'PaymentReceived', undefined],
      ['Signal', 'Stop', undefined],
      ['Waiting', 'Conditional event', undefined],
    ]);
  });

  test('marks the call activity that leads to a wait two levels down', () => {
    const view = viewOf(
      detailWith({
        calledInstances: [
          {
            id: CHILD,
            parentInstanceId: ROOT,
            bpmnProcessId: BpmnProcessId('child'),
            state: 'running',
            calledFromElementId: ElementId('Activity_CallChild'),
          },
          {
            id: GRANDCHILD,
            parentInstanceId: CHILD,
            bpmnProcessId: BpmnProcessId('grandchild'),
            state: 'running',
          },
        ],
        waitStates: [{ kind: 'userTask', instanceId: GRANDCHILD, elementId: ELEMENT }],
      }),
    );
    expect(view.markers).toEqual([{ elementId: 'Activity_CallChild', kind: 'waiting' }]);
    expect(view.waitStates[0]?.calledInstance).toEqual({
      instanceId: GRANDCHILD,
      shortId: '8f3c2a1e…',
      bpmnProcessId: 'grandchild',
    });
  });

  test('lets an incident outrank a wait at the same element', () => {
    const incidentId = IncidentId('i-1');
    const view = viewOf(
      detailWith({
        waitStates: [
          { kind: 'asyncContinuation', instanceId: ROOT, elementId: ELEMENT, since: SINCE },
        ],
        incidents: [
          {
            id: incidentId,
            instanceId: ROOT,
            definition: {
              id: DefinitionId('order:1'),
              bpmnProcessId: BpmnProcessId('order'),
              version: 1,
            },
            elementId: ELEMENT,
            type: 'failedJob',
            message: 'boom',
            createdAt: SINCE,
          },
          {
            id: IncidentId('i-2'),
            instanceId: ROOT,
            definition: {
              id: DefinitionId('order:1'),
              bpmnProcessId: BpmnProcessId('order'),
              version: 1,
            },
            elementId: ELEMENT,
            type: 'failedJob',
            message: 'boom again',
            createdAt: SINCE,
            details: { kind: 'errorMessage', text: 'worker said no', truncated: false },
          },
        ],
      }),
    );
    expect(view.markers).toEqual([{ elementId: 'Activity_Wait', kind: 'incident' }]);
    expect(view.headline).toMatchObject({ title: '2 incidents', detail: 'boom', actions: [] });
    expect(view.incidents[1]).toMatchObject({
      detailsLabel: 'Error message',
      rootCause: 'worker said no',
    });
  });

  test('names the scope of element variables', () => {
    const view = viewOf(
      detailWith({
        variables: [
          {
            name: 'reviewer',
            scope: { kind: 'element', elementId: ELEMENT },
            valueJson: '"mia"',
            truncated: true,
          },
        ],
      }),
    );
    expect(view.variables).toEqual([
      { name: 'reviewer', valueJson: '"mia"', truncated: true, scopeElementId: 'Activity_Wait' },
    ]);
  });
});

describe('the strip under the instance header', () => {
  const row = { rootCause: 'CardExpired', message: 'boom' } as IncidentRow;

  test('stays away for one incident and a running instance', () => {
    expect(InstanceHeadline.of([row], 'running')).toBeUndefined();
    expect(InstanceHeadline.of([], 'running')).toBeUndefined();
  });

  test('says when the instance is suspended or has ended', () => {
    expect(InstanceHeadline.of([row], 'suspended')?.title).toBe('This instance is suspended.');
    expect(InstanceHeadline.of([], 'terminated')?.title).toBe('This instance is terminated.');
  });

  test('sums up several incidents without actions, which sit on each card', () => {
    expect(InstanceHeadline.of([row, { message: 'other' } as IncidentRow], 'suspended')).toEqual({
      tone: 'danger',
      title: '2 incidents · suspended',
      detail: 'CardExpired',
      actions: [],
    });
    expect(InstanceHeadline.of([{ message: 'boom' } as IncidentRow, row], 'running')).toEqual({
      tone: 'danger',
      title: '2 incidents',
      detail: 'boom',
      actions: [],
    });
  });
});
