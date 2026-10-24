import { BulkOperationId, InstanceId, RuntimeError } from '../../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { fakeCommands, fakeRuntime, type FakeRoute } from './support/fake-engine-cli.js';

const BATCH = BulkOperationId('c7736a0b-cf02-11f1-b08e-3a9a38134a51');
const IDS = [InstanceId('c227efee-1'), InstanceId('c227efee-2'), InstanceId('c227efee-3')];
const STATISTICS = ['batch', 'get-statistics', '--batch-id', BATCH];
const HISTORIC = ['historic-batch', 'get', BATCH];
const SUSPEND = ['batch', 'suspend', BATCH];
const DELETE = ['batch', 'delete', BATCH, '--yes', '--no-cascade'];

const BATCH_FIELDS = {
  id: BATCH,
  type: 'instance-deletion',
  totalJobs: 3,
  invocationsPerBatchJob: 1,
  startTime: '2026-10-23T16:57:06.830+0000',
};

function statistics(fields: Record<string, unknown>): string {
  return JSON.stringify([
    { ...BATCH_FIELDS, suspended: false, completedJobs: 0, failedJobs: 0, ...fields },
  ]);
}

function failure(exitCode: number, code: string, message: string): Partial<FakeRoute> {
  return { exitCode, stderr: JSON.stringify({ error: { code, exitCode, message } }) };
}

const NOT_FOUND = failure(5, 'NOT_FOUND', 'Historic batch does not exist');
const REFUSED = failure(6, 'HTTP_CLIENT_ERROR', 'Unable to suspend batch');

async function failureOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => 'succeeded',
    (error: unknown) => (error instanceof RuntimeError ? error.failure : 'raw error'),
  );
}

describe('cancelling instances', () => {
  const accepting: FakeRoute = {
    command: ['process-instance', 'delete-async'],
    stdout: JSON.stringify(BATCH_FIELDS),
  };

  test('sends the ids and the reason on stdin, confirmed for exactly this command', async () => {
    const { commands, cli } = fakeCommands([accepting]);

    const id = await commands.cancelInstances(IDS, { reason: 'test data' });

    expect(id).toBe(BATCH);
    expect(cli.commands()).toEqual([['process-instance', 'delete-async', '--yes', '--body', '-']]);
    expect(JSON.parse(cli.invocations[0]?.input ?? '{}')).toEqual({
      processInstanceIds: IDS,
      deleteReason: 'test data',
      skipCustomListeners: false,
      skipSubprocesses: false,
      skipIoMappings: false,
    });
    expect(cli.invocations[0]?.environment).not.toHaveProperty('OPERATE_READ_ONLY');
  });

  test('sends no delete reason when there is none', async () => {
    const { commands, cli } = fakeCommands([accepting]);

    await commands.cancelInstances(IDS);

    expect(JSON.parse(cli.invocations[0]?.input ?? '{}')).not.toHaveProperty('deleteReason');
  });

  test('keeps the reason out of an engine error, which leaves the outcome open', async () => {
    const { commands } = fakeCommands([
      {
        command: ['process-instance', 'delete-async'],
        ...failure(7, 'HTTP_SERVER_ERROR', 'Cannot delete: reason "cleanup \\"ticket\\" 42"'),
      },
    ]);

    const error = await commands.cancelInstances(IDS, { reason: 'cleanup "ticket" 42' }).then(
      () => undefined,
      (caught: unknown) => caught as RuntimeError,
    );

    expect(error).toMatchObject({ failure: 'engineFailure' });
    expect(error?.message).not.toContain('ticket');
  });
});

describe('reading a bulk operation', () => {
  test('reads a running batch from its statistics, counting items, not jobs', async () => {
    const { runtime, cli } = fakeRuntime([
      {
        command: STATISTICS,
        stdout: statistics({
          invocationsPerBatchJob: 2,
          totalJobs: 2,
          completedJobs: 1,
          failedJobs: 1,
        }),
      },
    ]);

    expect(await runtime.getBulkOperation(BATCH)).toEqual({
      id: BATCH,
      kind: 'cancelInstances',
      state: 'running',
      total: 4,
      completed: 2,
      failed: 2,
      startedAt: '2026-10-23T16:57:06.830Z',
    });
    expect(cli.invocations[0]?.environment).toHaveProperty('OPERATE_READ_ONLY', '1');
  });

  test('reads a suspended batch as suspended', async () => {
    const { runtime } = fakeRuntime([
      { command: STATISTICS, stdout: statistics({ suspended: true }) },
    ]);

    expect(await runtime.getBulkOperation(BATCH)).toMatchObject({ state: 'suspended' });
  });

  test('reads a batch that left the runtime from its history, without counts', async () => {
    const { runtime } = fakeRuntime([
      { command: STATISTICS, stdout: '[]' },
      {
        command: HISTORIC,
        stdout: JSON.stringify({ ...BATCH_FIELDS, endTime: '2026-10-23T16:57:06.894+0000' }),
      },
    ]);

    expect(await runtime.getBulkOperation(BATCH)).toEqual({
      id: BATCH,
      kind: 'cancelInstances',
      state: 'ended',
      total: 3,
      startedAt: '2026-10-23T16:57:06.830Z',
      endedAt: '2026-10-23T16:57:06.894Z',
    });
  });

  test('knows no batch that is neither running nor in the history', async () => {
    const { runtime } = fakeRuntime([
      { command: STATISTICS, stdout: '[]' },
      { command: HISTORIC, ...NOT_FOUND },
    ]);

    expect(await runtime.getBulkOperation(BATCH)).toBeUndefined();
  });

  test('knows no batch of another type', async () => {
    const { runtime } = fakeRuntime([
      { command: STATISTICS, stdout: statistics({ type: 'set-job-retries' }) },
    ]);

    expect(await runtime.getBulkOperation(BATCH)).toBeUndefined();
  });
});

describe('stopping a bulk operation', () => {
  test('suspends the batch, then deletes it without its history', async () => {
    const { commands, cli } = fakeCommands([
      { command: SUSPEND, stdout: '' },
      { command: DELETE, stdout: '' },
    ]);

    await commands.stopBulkOperation(BATCH);

    expect(cli.commands()).toEqual([SUSPEND, DELETE]);
  });

  test('counts a batch that stays suspended because a running job blocks the delete as stopped', async () => {
    const { commands } = fakeCommands([
      { command: SUSPEND, stdout: '' },
      { command: DELETE, ...failure(7, 'HTTP_SERVER_ERROR', 'updated concurrently') },
      { command: STATISTICS, stdout: statistics({ suspended: true }) },
    ]);

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe('succeeded');
  });

  test('resolves for a batch that already ended', async () => {
    const { commands } = fakeCommands([
      { command: SUSPEND, ...REFUSED },
      { command: DELETE, ...REFUSED },
      { command: STATISTICS, stdout: '[]' },
      { command: HISTORIC, stdout: JSON.stringify(BATCH_FIELDS) },
    ]);

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe('succeeded');
  });

  test('is rejected for a batch the engine does not know', async () => {
    const { commands } = fakeCommands([
      { command: SUSPEND, ...REFUSED },
      { command: STATISTICS, stdout: '[]' },
      { command: HISTORIC, ...NOT_FOUND },
    ]);

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe('rejected');
  });

  test('fails when the batch still runs after a refused suspend', async () => {
    const { commands } = fakeCommands([
      { command: SUSPEND, ...REFUSED },
      { command: STATISTICS, stdout: statistics({}) },
    ]);

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe('rejected');
  });

  test.each([
    [4, 'UNAUTHORIZED', 'unauthorized'],
    [8, 'NETWORK', 'unreachable'],
  ])('asks nothing more after a suspend that failed with exit %i', async (exitCode, code, kind) => {
    const { commands, cli } = fakeCommands([
      { command: SUSPEND, ...failure(exitCode, code, 'no') },
    ]);

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe(kind);
    expect(cli.commands()).toEqual([SUSPEND]);
  });

  test('does not call a batch stopped when its delete was forbidden', async () => {
    const { commands } = fakeCommands([
      { command: SUSPEND, stdout: '' },
      {
        command: DELETE,
        exitCode: 4,
        stderr: JSON.stringify({
          error: { code: 'FORBIDDEN', exitCode: 4, status: 403, message: 'no' },
        }),
      },
    ]);

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe('forbidden');
  });
});

describe('instances by id', () => {
  test('asks for no more rows than there are ids', async () => {
    const { runtime, cli } = fakeRuntime([
      { command: ['historic-process-instance', 'query'], stdout: '[]' },
    ]);

    await runtime.searchInstances({ instanceIds: IDS }, { limit: 1000 });

    expect(cli.commands()[0]!.slice(-2)).toEqual(['--max-results', '3']);
  });

  test('sends the ids in the query body on stdin', async () => {
    const { runtime, cli } = fakeRuntime([
      { command: ['historic-process-instance', 'query-count'], stdout: '{"count":3}' },
    ]);

    expect(await runtime.countInstances({ instanceIds: IDS })).toBe(3);
    expect(cli.commands()).toEqual([['historic-process-instance', 'query-count', '--body', '-']]);
    expect(JSON.parse(cli.invocations[0]?.input ?? '{}')).toEqual({ processInstanceIds: IDS });
  });

  test('finds nothing for an empty list without asking the engine', async () => {
    const { runtime, cli } = fakeRuntime([]);

    expect(await runtime.countInstances({ instanceIds: [] })).toBe(0);
    expect(await runtime.searchInstances({ instanceIds: [] }, { limit: 5 })).toEqual({ items: [] });
    expect(cli.invocations).toEqual([]);
  });
});
