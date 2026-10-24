import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  InstanceId,
  type DefinitionRef,
  type ElementMapping,
  type InstanceSummary,
} from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { MigrateInstancesAction } from '../../src/core/panels/migrate-instances-action.js';
import type { MigrationState } from '../../src/core/panels/migration-reads.js';
import { MigrationElements } from '../../src/core/views/migration-elements.js';
import { MigrationRequests } from '../../src/core/views/migration-requests.js';
import { MigrationRows } from '../../src/core/views/migration-rows.js';
import { MigrationViewBuilder } from '../../src/core/views/migration-view-builder.js';

const SOURCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="shop" isExecutable="true">
    <bpmn:startEvent id="Start" />
    <bpmn:userTask id="Review" name="Review order" />
    <bpmn:boundaryEvent id="Overdue" name="3 days" attachedToRef="Review">
      <bpmn:timerEventDefinition id="Timer" />
    </bpmn:boundaryEvent>
    <bpmn:callActivity id="Ship" name="Ship" />
    <bpmn:intermediateCatchEvent id="Paid" name="Paid" />
    <bpmn:subProcess id="Pack" name="Pack"><bpmn:userTask id="Weigh" name="Weigh" /></bpmn:subProcess>
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`;
const TARGET_XML = SOURCE_XML.replace(
  'id="Review" name="Review order"',
  'id="Check" name="Check order"',
);

function ref(version: number): DefinitionRef {
  return {
    id: DefinitionId(`shop:${version}`),
    bpmnProcessId: BpmnProcessId('shop'),
    version,
    name: 'Shop',
  };
}

const IDS = ['a', 'b', 'c', 'd'].map((id) => InstanceId(id));
const SAME = ['Overdue', 'Ship', 'Paid', 'Pack', 'Weigh'].map((id): ElementMapping => ({
  sourceElementId: ElementId(id),
  targetElementId: ElementId(id),
}));

function state(change: Partial<MigrationState> = {}): MigrationState {
  return {
    asOf: new Date('2026-10-23T10:00:00Z'),
    versions: [3, 2, 1].map((version) => ({
      definition: ref(version),
      running: 0,
      withIncident: 0,
    })),
    source: ref(1),
    target: ref(2),
    sourceXml: SOURCE_XML,
    targetXml: TARGET_XML,
    statistics: [
      { elementId: ElementId('Review'), active: 2, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: ElementId('Pack'), active: 1, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: ElementId('Weigh'), active: 1, incidents: 0, incidentsInCalledInstances: 0 },
    ],
    instanceIds: IDS,
    leftOut: [],
    waiting: new Map([
      ['Review', [IDS[0]!, IDS[1]!]],
      ['Weigh', [IDS[2]!]],
    ]),
    mappings: SAME,
    problems: [],
    checking: false,
    checkFailure: undefined,
    focused: undefined,
    ...change,
  };
}

function viewOf(migration: MigrationState, run?: never) {
  return new MigrationViewBuilder(migration, {
    engine: { name: 'shop-dev', environment: 'local', host: 'localhost' },
    now: 0,
    canWrite: true,
    run,
  }).build();
}

describe('the elements of a migration', () => {
  test('offers only target elements of the same kind and leaves sub-process scopes out of the tokens', () => {
    const elements = new MigrationElements(SOURCE_XML, TARGET_XML);

    expect(elements.candidatesFor('Review')).toEqual([
      { elementId: 'Check', label: 'Check order' },
      { elementId: 'Weigh', label: 'Weigh' },
    ]);
    expect(elements.candidatesFor('Unknown')).toEqual([]);
    expect(new MigrationElements(SOURCE_XML, undefined).candidatesFor('Review')).toEqual([]);
    expect(elements.holdsTokens('Weigh')).toBe(true);
    expect(elements.holdsTokens('Pack')).toBe(false);
    expect(elements.holdsTokens('Nowhere')).toBe(false);
    expect(elements.restartingTimerOf('Overdue')).toBe('Review');
    expect(elements.restartingTimerOf('Paid')).toBeUndefined();
    expect(elements.hasCallActivity()).toBe(true);
    expect(elements.hasCatchingEvents()).toBe(true);
    expect(elements.targetLabel('Gone')).toBe('Gone');
  });
});

describe('the rows of a migration', () => {
  test('flag an element without a mapping where selected instances wait and the timer that starts again', () => {
    const rows = new MigrationRows(state({ mappings: SAME.slice(1) }));

    expect(rows.rows()[0]).toMatchObject({
      sourceElementId: 'Review',
      waiting: 2,
      unmappedTokens: true,
    });
    expect(rows.rows().find((row) => row.sourceElementId === 'Overdue')).toMatchObject({
      warning: 'The timer 3 days at Review order starts again.',
    });
    expect(rows.restartingTimers()).toEqual(['The timer 3 days at Review order starts again.']);
    expect(rows.blocked()).toEqual({ count: 2, labels: ['Review order'], countable: true });
    expect(rows.blockedIds()).toEqual([IDS[0], IDS[1]]);
    expect(rows.identical()).toBe(false);
  });

  test('do not flag an element where none of the selected instances waits', () => {
    const rows = new MigrationRows(state({ mappings: SAME.slice(1), leftOut: [IDS[0]!, IDS[1]!] }));

    expect(rows.rows().some((row) => row.unmappedTokens === true)).toBe(false);
    expect(rows.restartingTimers()).toEqual([]);
    expect(rows.count).toBe(2);
  });

  test('flag every element without a mapping where tokens wait when Pulse could not count', () => {
    const rows = new MigrationRows(state({ mappings: [], waiting: new Map() }));

    expect(rows.blocked()).toEqual({
      count: 0,
      labels: ['Review order', 'Weigh'],
      countable: false,
    });
    expect(rows.rows().find((row) => row.sourceElementId === 'Review')).not.toHaveProperty(
      'waiting',
    );
  });

  test('put rows with a problem first', () => {
    const problem = { mapping: SAME[1]!, message: 'Activities have incompatible types' };
    const rows = new MigrationRows(
      state({ mappings: [...SAME, problem.mapping], problems: [problem] }),
    );

    expect(rows.rows()[0]).toMatchObject({ sourceElementId: 'Ship', problem: problem.message });
  });
});

describe('the migrate offer', () => {
  test('asks to map first when it could not count, and offers no leave-out when every instance is blocked', () => {
    expect(viewOf(state({ mappings: [], waiting: new Map() })).offer).toEqual({
      status: 'refused',
      reason: 'Instances wait at Review order, Weigh, which have no mapping in v2. Map them first.',
    });
    expect(
      viewOf(state({ mappings: SAME.slice(1), instanceIds: [IDS[0]!, IDS[1]!] })).offer,
    ).toEqual({
      status: 'refused',
      reason: '2 of 2 wait at Review order, which has no mapping in v2.',
    });
  });

  test('says that no selected instance is left and names a target that is not the latest', () => {
    const view = viewOf(state({ instanceIds: [] }));

    expect(view.offer).toEqual({
      status: 'refused',
      reason: 'None of the selected instances runs on v1 any more.',
    });
    expect(view.notices).toEqual([
      { tone: 'info', title: 'v2 is not the latest version (v3).', actions: [] },
    ]);
    expect(view.summary).toBe('5 mapped · no problems · checked just now');
    expect(viewOf(state({ checking: true })).summary).toBe(
      '5 mapped · 1 without a mapping · checking…',
    );
  });

  test('shows the source alone until a target is picked', () => {
    const view = viewOf(state({ target: undefined, targetXml: undefined, mappings: [] }));

    expect(view).not.toHaveProperty('target');
    expect(view.summary).toBe('4 instances on v1');
    expect(view.targets.map((option) => option.version)).toEqual([3, 2]);
  });
});

describe('the migration dialog', () => {
  const summary = (id: string, hasIncident: boolean): InstanceSummary => ({
    id: InstanceId(id),
    definition: ref(1),
    state: 'running',
    hasIncident,
    businessKey: `ORD-${id}`,
  });

  function requestOf(migration: MigrationState, rows: readonly InstanceSummary[]) {
    const plan = {
      sourceDefinitionId: migration.source.id,
      targetDefinitionId: ref(2).id,
      mappings: migration.mappings,
    };
    const action = new MigrateInstancesAction(plan, { source: 1, target: 2 });
    return new MigrationRequests(migration, {
      plan: {
        action,
        definitionId: migration.source.id,
        version: 1,
        ids: rows.map((row) => row.id),
        skipped: 1,
        leftOut: migration.leftOut.length,
      },
      selected: rows.length + 1,
      firstRows: rows,
    }).request();
  }

  test('names the instances, what changes, what stays and what was left out', () => {
    const request = requestOf(state({ leftOut: [IDS[3]!] }), [
      summary('a', true),
      summary('b', true),
    ]);

    expect(request.facts).toEqual([
      'ORD-a, ORD-b',
      '1 ended or left v1, left alone',
      '1 left out, staying on v1',
      'Each migrates on its own; failed ones stay on v1.',
      'v2 is not the latest version (v3).',
      '2 have an incident and keep it; retry them on v2.',
      'Called instances stay on their version.',
      'New or unmapped timers and subscriptions start now.',
      "Migrating can't be undone.",
      'Checked just now',
    ]);
    expect(request.auditFields).toMatchObject({ leftOut: 1, incidents: 2, mappings: 5 });
  });

  test('says when the target is older than the source', () => {
    const request = requestOf(state({ source: ref(3), target: ref(2) }), [summary('a', false)]);

    expect(request.facts).toContain('v2 is older than v3.');
    expect(request.facts).toContain('If it fails, it stays on v3.');
    expect(request.title).toBe('Migrate 1 instance of Shop v3 to v2?');
  });
});

describe('the migrate action', () => {
  const action = new MigrateInstancesAction(
    { sourceDefinitionId: ref(1).id, targetDefinitionId: ref(2).id, mappings: [] },
    { source: 1, target: 2 },
  );

  test('finds the instances still on the source and those that arrived on the target', () => {
    expect(action.eligibleFilter({ instanceIds: IDS })).toEqual({
      instanceIds: IDS,
      definitionId: ref(1).id,
      lifecycle: 'running',
    });
    expect(action.arrivedFilter({ instanceIds: IDS })).toEqual({
      instanceIds: IDS,
      definitionId: ref(2).id,
    });
    expect(
      action.eligible({ id: IDS[0]!, definition: ref(2), state: 'running', hasIncident: false }),
    ).toBe(false);
    expect(
      action.eligible({ id: IDS[0]!, definition: ref(1), state: 'suspended', hasIncident: false }),
    ).toBe(true);
    expect(action.matching({}, { running: 4, withIncident: 1, ended: 2, all: 6 })).toBe(4);
  });
});
