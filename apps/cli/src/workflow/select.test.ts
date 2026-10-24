import { describe, expect, it } from 'vitest';
import { portOf } from '../../test/support/engine-port.js';
import { fakeServer, json } from '../../test/support/fake-fetch.js';
import { OperateError } from '../errors.js';
import { checkSelection, mergeCandidates, selectInstance, selectionRequests } from './select.js';

function history(id: string, startTime: string, state = 'ACTIVE') {
  return {
    id,
    processDefinitionKey: 'order',
    processDefinitionVersion: 2,
    businessKey: 'B-1',
    state,
    startTime,
  };
}

function engine(historyRows: unknown[], runtimeRows: unknown[]) {
  return fakeServer()
    .on('GET', '/history/process-instance', json(historyRows))
    .on('GET', '/process-instance', json(runtimeRows));
}

async function failure(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OperateError) return error;
  }
  throw new Error('expected an OperateError');
}

describe('checkSelection', () => {
  it.each([
    [
      { id: 'p', businessKey: 'B', latest: false },
      'The process instance id excludes --business-key, --process-definition-key and --latest',
    ],
    [
      { id: 'p', latest: true },
      'The process instance id excludes --business-key, --process-definition-key and --latest',
    ],
    [{ latest: false }, 'Select a process instance'],
    [{ latest: true }, '--latest needs --business-key or --process-definition-key'],
  ])('refuses %j', (selection, message) => {
    expect(() => {
      checkSelection(selection);
    }).toThrow(message);
  });

  it('accepts an id, a business key, or a process definition key with or without --latest', () => {
    for (const selection of [
      { id: 'p', latest: false },
      { businessKey: 'B', latest: true },
      { processDefinitionKey: 'k', latest: false },
    ]) {
      expect(() => {
        checkSelection(selection);
      }).not.toThrow();
    }
  });
});

describe('selectInstance', () => {
  it('returns an id without requests', async () => {
    const server = engine([], []);
    expect(await selectInstance(portOf(server.fetch), { id: 'p1', latest: false }, 'inspect')).toBe(
      'p1',
    );
    expect(server.requests).toEqual([]);
    expect(selectionRequests({ id: 'p1', latest: false })).toEqual([]);
  });

  it('resolves a unique business key against history and runtime with only the given filters', async () => {
    const server = engine(
      [history('p1', '2024-05-01T10:00:00.000+0000')],
      [{ id: 'p1', definitionKey: 'order' }],
    );
    expect(
      await selectInstance(portOf(server.fetch), { businessKey: 'B-1', latest: false }, 'inspect'),
    ).toBe('p1');
    expect(server.requests.map((request) => `${request.path}?${request.query.toString()}`)).toEqual(
      [
        '/history/process-instance?sortBy=startTime&sortOrder=desc&maxResults=11&processInstanceBusinessKey=B-1',
        '/process-instance?maxResults=11&businessKey=B-1',
      ],
    );
  });

  it('reports no match as NOT_FOUND naming the filters', async () => {
    const error = await failure(
      selectInstance(
        portOf(engine([], []).fetch),
        { businessKey: 'B-1', processDefinitionKey: 'order', latest: false },
        'inspect',
      ),
    );
    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'No process instance with business key "B-1" and process definition key "order"',
    });
    expect(error.details.hint).toContain('`operate historic-process-instance list`');
  });

  it('lists the candidates of an ambiguous filter with ready commands', async () => {
    const rows = [
      history('p1', '2024-05-01T10:00:00.000+0000', 'COMPLETED'),
      history('p2', '2024-05-02T10:00:00.000+0000'),
      history('p3', '2024-05-03T10:00:00.000+0000'),
    ];
    const error = await failure(
      selectInstance(portOf(engine(rows, []).fetch), { businessKey: 'B-1', latest: false }, 'wait'),
    );
    expect(error).toMatchObject({
      code: 'USAGE',
      message: 'Business key "B-1" matches 3 process instances',
    });
    expect(error.details.hint).toBe(
      'Choose one: operate wait p3, operate wait p2, operate wait p1; or narrow the selection with --process-definition-key <key>, or take the most recently started one with --latest.',
    );
    expect(error.details.data).toEqual({
      candidates: [
        {
          id: 'p3',
          key: 'order',
          version: 2,
          businessKey: 'B-1',
          state: 'ACTIVE',
          startTime: '2024-05-03T10:00:00.000+0000',
        },
        {
          id: 'p2',
          key: 'order',
          version: 2,
          businessKey: 'B-1',
          state: 'ACTIVE',
          startTime: '2024-05-02T10:00:00.000+0000',
        },
        {
          id: 'p1',
          key: 'order',
          version: 2,
          businessKey: 'B-1',
          state: 'COMPLETED',
          startTime: '2024-05-01T10:00:00.000+0000',
        },
      ],
    });
  });

  it('says "more than 10" beyond the listed candidates', async () => {
    const rows = Array.from({ length: 11 }, (_, index) =>
      history(`p${index}`, `2024-05-${String(index + 10)}T10:00:00.000+0000`),
    );
    const error = await failure(
      selectInstance(
        portOf(engine(rows, []).fetch),
        { processDefinitionKey: 'order', latest: false },
        'inspect',
      ),
    );
    expect(error.message).toBe(
      'Process definition key "order" matches more than 10 process instances',
    );
    expect((error.details.data as { candidates: unknown[] }).candidates).toHaveLength(10);
  });

  it('takes the most recently started history match with --latest', async () => {
    const rows = [
      history('p9', '2024-05-09T10:00:00.000+0000', 'COMPLETED'),
      history('p1', '2024-05-01T10:00:00.000+0000'),
    ];
    expect(
      await selectInstance(
        portOf(engine(rows, []).fetch),
        { processDefinitionKey: 'order', latest: true },
        'inspect',
      ),
    ).toBe('p9');
  });

  it('decides --latest by the runtime without history, and needs history for several', async () => {
    const one = engine([], [{ id: 'r1', definitionId: 'order:1:x' }]);
    expect(
      await selectInstance(portOf(one.fetch), { businessKey: 'B', latest: true }, 'inspect'),
    ).toBe('r1');
    const several = engine([], [{ id: 'r1' }, { id: 'r2' }]);
    const error = await failure(
      selectInstance(portOf(several.fetch), { businessKey: 'B', latest: true }, 'inspect'),
    );
    expect(error.message).toBe(
      '--latest needs the history (level activity or higher) to order instances',
    );
    const none = await failure(
      selectInstance(portOf(engine([], []).fetch), { businessKey: 'B', latest: true }, 'inspect'),
    );
    expect(none.code).toBe('NOT_FOUND');
  });
});

describe('mergeCandidates', () => {
  it('merges by id (history first), active before ended, then the newest first', () => {
    const merged = mergeCandidates(
      [
        history('h-old', '2024-01-01T00:00:00.000+0000'),
        history('h-ended', '2024-06-01T00:00:00.000+0000', 'COMPLETED'),
        history('h-new', '2024-05-01T00:00:00.000+0000'),
        { state: 'ACTIVE' },
      ],
      [
        { id: 'h-new', suspended: true },
        { id: 'r-only', suspended: true, definitionId: 'order:3:x', businessKey: 'B-1' },
        {},
      ],
    );
    expect(merged.map((candidate) => candidate.id)).toEqual([
      'h-new',
      'h-old',
      'r-only',
      'h-ended',
    ]);
    expect(merged[2]).toEqual({
      id: 'r-only',
      key: 'order',
      businessKey: 'B-1',
      state: 'SUSPENDED',
    });
  });
});

describe('selection details', () => {
  it('names the selection forms in the usage error', () => {
    try {
      checkSelection({ latest: false });
      expect.unreachable();
    } catch (error) {
      expect((error as OperateError).details.hint).toBe(
        'Pass a process instance id, --business-key <key> (optionally with --process-definition-key <key>), or --process-definition-key <key> --latest.',
      );
    }
  });

  it('reads candidates with defaults: active history rows, runtime keys and suspension', () => {
    expect(
      mergeCandidates(
        [{ id: 'h1' }],
        [
          { id: 'r1', definitionId: 'order:1:x', suspended: true },
          { id: 'r2', definitionKey: 'pay', suspended: false },
        ],
      ),
    ).toEqual([
      { id: 'h1', state: 'ACTIVE' },
      { id: 'r1', key: 'order', state: 'SUSPENDED' },
      { id: 'r2', key: 'pay', state: 'ACTIVE' },
    ]);
  });

  it('says match for both filters, counts exactly 10 and lists 3 commands', async () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      history(`p${index}`, `2024-05-${String(index + 10)}T10:00:00.000+0000`),
    );
    const error = await failure(
      selectInstance(
        portOf(engine(rows, []).fetch),
        { businessKey: 'B-1', processDefinitionKey: 'order', latest: false },
        'advance',
      ),
    );
    expect(error.message).toBe(
      'Business key "B-1" and process definition key "order" match 10 process instances',
    );
    expect(error.details.hint).toBe(
      'Choose one: operate advance p9, operate advance p8, operate advance p7; or narrow the selection with --process-definition-key <key>, or take the most recently started one with --latest.',
    );
  });

  it('skips history rows without id for --latest and names the fix without history', async () => {
    const rows = [{ businessKey: 'B' }, history('h2', '2024-05-01T10:00:00.000+0000')];
    expect(
      await selectInstance(
        portOf(engine(rows, [{ id: 'r1' }]).fetch),
        { businessKey: 'B', latest: true },
        'inspect',
      ),
    ).toBe('h2');
    const several = engine([], [{ id: 'r1' }, { id: 'r2' }]);
    const error = await failure(
      selectInstance(portOf(several.fetch), { businessKey: 'B', latest: true }, 'inspect'),
    );
    expect(error.details.hint).toBe(
      'Pass the process instance id instead; `operate process-instance list` lists the running ones.',
    );
  });
});
