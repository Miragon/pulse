import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
  type ElementStatistics,
  type InstanceDetail,
} from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import parcelReturnXml from '../../dev/webview/fixtures/parcel-return.bpmn';
import { BpmnStructure } from '../../src/core/bpmn/bpmn-structure.js';
import { DefinitionViewBuilder } from '../../src/core/views/definition-view-builder.js';
import { InstanceViewBuilder } from '../../src/core/views/instance-view-builder.js';

const ENGINE = { name: 'local', environment: 'local', host: 'localhost' } as const;
const AT = new Date('2026-10-21T09:00:00Z');
const DEFINITION = {
  id: DefinitionId('parcel-return:1'),
  bpmnProcessId: BpmnProcessId('parcel-return'),
  version: 1,
};

function statistic(elementId: string, counts: Partial<ElementStatistics>): ElementStatistics {
  return {
    elementId: ElementId(elementId),
    active: 0,
    incidents: 0,
    incidentsInCalledInstances: 0,
    ...counts,
  };
}

function badgesOf(statistics: readonly ElementStatistics[]) {
  return new DefinitionViewBuilder({
    engine: ENGINE,
    asOf: AT,
    versions: [{ definition: DEFINITION, running: 3, withIncident: 1 }],
    selectedDefinitionId: DEFINITION.id,
    diagramXml: parcelReturnXml,
    statistics,
    calledProcesses: [],
    instances: [],
    hasMoreInstances: false,
    filter: { scope: 'running' },
    scopeCounts: { running: 3, withIncident: 1, ended: 0, all: 3 },
  }).build().badges;
}

function instanceWaitingAt(elementId: string, withIncident: boolean): InstanceDetail {
  const instanceId = InstanceId('return-1');
  return {
    instance: { id: instanceId, definition: DEFINITION, state: 'running', hasIncident: false },
    path: [],
    waitStates: [{ kind: 'userTask', instanceId, elementId: ElementId(elementId) }],
    incidents: withIncident
      ? [
          {
            id: IncidentId('incident-1'),
            instanceId,
            definition: DEFINITION,
            elementId: ElementId('Activity_ReadScale'),
            type: 'failedExternalTask',
            message: 'Scale offline',
            createdAt: IsoTimestamp('2026-10-21T08:00:00Z'),
          },
        ]
      : [],
    calledInstances: [],
    variables: [],
    truncated: false,
  };
}

function markersOf(detail: InstanceDetail) {
  return new InstanceViewBuilder({
    engine: ENGINE,
    asOf: AT,
    detail,
    diagramXml: parcelReturnXml,
    calledProcesses: [],
    fullDetails: new Map(),
    writable: false,
  }).build().markers;
}

describe('the structure of a diagram', () => {
  test('names the collapsed sub-processes around an element, innermost first', () => {
    const structure = BpmnStructure.of(parcelReturnXml);

    expect(structure.collapsedAround('Activity_ReadScale')).toEqual([
      'Activity_WeighParcel',
      'Activity_InspectParcel',
    ]);
    expect(structure.collapsedAround('Activity_CheckParcel')).toEqual(['Activity_InspectParcel']);
    expect(structure.collapsedAround('Activity_PayRefund')).toEqual([]);
    expect(structure.collapsedAround('Activity_NotifyCustomer')).toEqual([]);
  });

  test('tells whether a diagram has call activities', () => {
    expect(BpmnStructure.hasCallActivities(parcelReturnXml)).toBe(true);
    expect(BpmnStructure.hasCallActivities('<bpmn:process id="p"><bpmn:task id="t"/>')).toBe(false);
  });
});

describe('badges of a collapsed sub-process', () => {
  test('roll the incidents inside up, keeping the running count of the engine', () => {
    const badges = badgesOf([
      statistic('Activity_InspectParcel', { active: 3 }),
      statistic('Activity_WeighParcel', { active: 1 }),
      statistic('Activity_CheckParcel', { active: 2 }),
      statistic('Activity_ReadScale', { incidents: 1, incidentsInCalledInstances: 2 }),
      statistic('Activity_PayRefund', { incidents: 4 }),
    ]);

    expect(badges).toEqual(
      expect.arrayContaining([
        {
          elementId: 'Activity_InspectParcel',
          running: 3,
          incidents: 1,
          incidentsInCalledInstances: 2,
        },
        {
          elementId: 'Activity_WeighParcel',
          running: 1,
          incidents: 1,
          incidentsInCalledInstances: 2,
        },
        {
          elementId: 'Activity_ReadScale',
          running: 0,
          incidents: 1,
          incidentsInCalledInstances: 2,
        },
        {
          elementId: 'Activity_PayRefund',
          running: 0,
          incidents: 4,
          incidentsInCalledInstances: 0,
        },
      ]),
    );
    expect(badges.find((badge) => badge.elementId === 'Activity_Refund')).toBeUndefined();
  });

  test('appear for an incident inside even when the engine counts nothing at the shape', () => {
    const badges = badgesOf([statistic('Activity_CheckParcel', { incidents: 1 })]);

    expect(badges.map((badge) => badge.elementId).sort()).toEqual([
      'Activity_CheckParcel',
      'Activity_InspectParcel',
    ]);
  });
});

describe('markers of a collapsed sub-process', () => {
  test('mark the shape when something inside waits', () => {
    expect(markersOf(instanceWaitingAt('Activity_CheckParcel', false))).toEqual([
      { elementId: 'Activity_CheckParcel', kind: 'waiting' },
      { elementId: 'Activity_InspectParcel', kind: 'waiting' },
    ]);
  });

  test('let an incident inside win over a wait inside', () => {
    expect(markersOf(instanceWaitingAt('Activity_CheckParcel', true))).toEqual(
      expect.arrayContaining([
        { elementId: 'Activity_ReadScale', kind: 'incident' },
        { elementId: 'Activity_WeighParcel', kind: 'incident' },
        { elementId: 'Activity_InspectParcel', kind: 'incident' },
        { elementId: 'Activity_CheckParcel', kind: 'waiting' },
      ]),
    );
  });
});
