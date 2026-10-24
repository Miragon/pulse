import { describe, expect, test } from 'vitest';
import { MessageGuards } from '../../src/core/protocol/index.js';
import type { IncidentRow, InstanceView, MoveOption, WaitRow } from '../../src/core/protocol/index.js';
import { MoveOutcomes } from '../../src/core/views/move-outcomes.js';

const OPTION: MoveOption = {
  fromElementId: 'Charge',
  fromLabel: 'Charge payment',
  targets: [{ elementId: 'Pack', label: 'Pack', effects: [], warnings: [] }],
  refused: [],
};
const PACK = OPTION.targets[0]!;

function wait(elementId: string, elementName?: string): WaitRow {
  return {
    elementId,
    kindLabel: 'User task',
    ...(elementName === undefined ? {} : { elementName }),
  };
}

function viewWith(overrides: Partial<InstanceView>): InstanceView {
  return {
    kind: 'instance',
    engine: { name: 'shop-dev', environment: 'local', host: 'localhost:18090' },
    asOf: '2026-10-21T08:00:00Z',
    instance: {
      id: 'instance-1',
      shortId: 'instance-1',
      state: 'Running',
      processName: 'Order fulfillment',
      bpmnProcessId: 'order-fulfillment',
      version: 3,
      definitionId: 'order-fulfillment:3',
    },
    diagramXml: '',
    markers: [],
    calls: [],
    incidents: [],
    waitStates: [],
    path: [],
    variables: [],
    truncated: false,
    ...overrides,
  };
}

const BEFORE = viewWith({ waitStates: [wait('Charge'), wait('Packed', 'Parcel packed')] });

const FAILED_AT_PACK: IncidentRow = {
  id: 'incident-2',
  shortId: 'incident-2',
  elementId: 'Pack',
  typeLabel: 'Failed job',
  engineType: 'failedJob',
  message: 'Scale offline',
  rootCause: 'ScaleOffline: no answer',
  createdAt: '2026-10-21T08:00:00Z',
};

describe('the outcome of a move', () => {
  test.each([
    [{ incidents: [FAILED_AT_PACK] }, 'danger', 'Moved to Pack; it failed there.'],
    [
      { incidents: [{ ...FAILED_AT_PACK, rootCause: undefined }] as unknown as IncidentRow[] },
      'danger',
      'Moved to Pack; it failed there.',
    ],
    [
      { instance: { ...viewWith({}).instance, state: 'Completed' } },
      'info',
      'Moved to Pack. The instance then ran to its end.',
    ],
    [
      { waitStates: [wait('Charge')] },
      'warning',
      'The engine accepted the move, but a token still waits at Charge payment.',
    ],
    [{ waitStates: [wait('Pack')] }, 'info', 'Moved. Now waiting at Pack.'],
    [
      { waitStates: [wait('Ship', 'Ship parcel')] },
      'info',
      'Moved to Pack; now waiting at Ship parcel.',
    ],
    [{ waitStates: [wait('Ship')] }, 'info', 'Moved to Pack; now waiting at Ship.'],
    [{}, 'info', 'Moved to Pack.'],
  ] as const)('after %o is %s: %s', (overrides, tone, title) => {
    expect(
      MoveOutcomes.after(OPTION, PACK, BEFORE, viewWith(overrides as Partial<InstanceView>)),
    ).toMatchObject({ tone, title });
  });

  test('names only a wait the move created, not a token that waited before', () => {
    const after = viewWith({ waitStates: [wait('Packed', 'Parcel packed')] });
    expect(MoveOutcomes.after(OPTION, PACK, BEFORE, after).title).toBe('Moved to Pack.');
  });

  test('carries the root cause of a failure at the target', () => {
    expect(
      MoveOutcomes.after(OPTION, PACK, BEFORE, viewWith({ incidents: [FAILED_AT_PACK] })).detail,
    ).toBe('ScaleOffline: no answer');
  });

  test('takes a token that came back to the source for a new one', () => {
    const earlier = { ...wait('Charge', 'Charge payment'), since: '2026-10-21T08:00:00Z' };
    const later = { ...earlier, since: '2026-10-21T08:05:00Z' };
    const after = viewWith({ waitStates: [later] });
    expect(
      MoveOutcomes.after(OPTION, PACK, viewWith({ waitStates: [earlier] }), after),
    ).toMatchObject({
      tone: 'info',
      title: 'Moved to Pack; now waiting at Charge payment.',
    });
  });

  test('claims nothing about the token when the instance could not be read again', () => {
    expect(MoveOutcomes.after(OPTION, PACK, BEFORE, BEFORE)).toMatchObject({
      tone: 'info',
      title:
        'Moved. Pulse could not read the instance again; refresh to see where the token waits.',
    });
  });

  test('does not warn about the source after a re-run', () => {
    const rerun = { ...OPTION, fromElementId: 'Pack' };
    expect(
      MoveOutcomes.after(rerun, PACK, BEFORE, viewWith({ waitStates: [wait('Pack')] })).title,
    ).toBe('Moved. Now waiting at Pack.');
  });
});

describe('the move intent', () => {
  const move = { type: 'moveToken', fromElementId: 'A', toElementId: 'B', reason: 'Fixed by hand' };

  test.each([
    [move, true],
    [{ ...move, reason: '' }, true],
    [{ ...move, reason: 'r'.repeat(500) }, true],
    [{ ...move, reason: 'r'.repeat(501) }, false],
    [{ ...move, reason: 7 }, false],
    [{ ...move, fromElementId: '' }, false],
    [{ ...move, toElementId: 'b'.repeat(256) }, false],
    [{ type: 'moveToken', fromElementId: 'A', reason: 'x' }, false],
  ])('%o is %s', (intent, valid) => {
    expect(MessageGuards.isWebviewIntent(intent)).toBe(valid);
  });
});
