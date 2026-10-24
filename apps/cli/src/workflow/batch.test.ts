import { describe, expect, it } from 'vitest';
import { depsOf } from '../../test/support/engine-port.js';
import { engineError, fakeServer, json } from '../../test/support/fake-fetch.js';
import { waitForBatch } from './batch.js';

const RUNNING = {
  id: 'b1',
  type: 'instance-deletion',
  totalJobs: 4,
  jobsCreated: 4,
  remainingJobs: 2,
  failedJobs: 0,
  completedJobs: 2,
  startTime: 's',
  batchJobDefinitionId: 'jd-b',
};

describe('waitForBatch', () => {
  it('waits while the statistics have a row and finishes with the history record', async () => {
    let polls = 0;
    const server = fakeServer()
      .on('GET', '/batch/statistics', () => {
        polls += 1;
        return json(polls < 3 ? [RUNNING] : []);
      })
      .on(
        'GET',
        '/history/batch/b1',
        json({ id: 'b1', type: 'instance-deletion', totalJobs: 4, startTime: 's', endTime: 'e' }),
      );
    const result = await waitForBatch(depsOf(server.fetch), 'b1', 60_000);
    expect(result).toEqual({
      kind: 'view',
      view: {
        batch: { id: 'b1', type: 'instance-deletion', totalJobs: 4, startTime: 's', endTime: 'e' },
        waited: { until: 'finished', elapsedMs: 750, polls: 3 },
      },
    });
  });

  it('finishes with the last statistics when the batch has no history', async () => {
    let seen = false;
    const server = fakeServer()
      .on('GET', '/batch/statistics', () => {
        const rows = seen ? [] : [RUNNING];
        seen = true;
        return json(rows);
      })
      .on('GET', '/history/batch/b1', engineError(404, 'InvalidRequestException', 'no history'));
    const result = await waitForBatch(depsOf(server.fetch), 'b1', 60_000);
    expect(result).toMatchObject({
      kind: 'view',
      view: { batch: { id: 'b1', totalJobs: 4, startTime: 's' }, waited: { polls: 2 } },
    });
  });

  it('is NOT_FOUND for a batch it never saw', async () => {
    const server = fakeServer()
      .on('GET', '/batch/statistics', json([]))
      .on('GET', '/history/batch/b1', engineError(404, 'InvalidRequestException', 'no history'));
    await expect(waitForBatch(depsOf(server.fetch), 'b1', 1000)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Batch b1 does not exist',
    });
  });

  it('fails with JOB_FAILED when only failed jobs remain', async () => {
    const stuck = { ...RUNNING, remainingJobs: 1, failedJobs: 1 };
    const server = fakeServer()
      .on('GET', '/batch/statistics', json([stuck]))
      .on('GET', '/job', json([{ id: 'j9', exceptionMessage: 'cannot delete' }]));
    const result = await waitForBatch(depsOf(server.fetch), 'b1', 60_000);
    expect(result).toMatchObject({
      kind: 'view',
      view: { batch: { id: 'b1', failedJobs: 1 } },
      failure: {
        code: 'JOB_FAILED',
        message: 'Batch b1 cannot finish: 1 jobs failed, the first: cannot delete',
        details: {
          data: {
            batchId: 'b1',
            failedJobs: 1,
            failures: [{ jobId: 'j9', exceptionMessage: 'cannot delete' }],
          },
        },
      },
    });
    expect(server.requests.find((request) => request.path === '/job')?.query.toString()).toBe(
      'jobDefinitionId=jd-b&withException=true&maxResults=5',
    );
    const noDefinition = fakeServer().on(
      'GET',
      '/batch/statistics',
      json([{ ...stuck, batchJobDefinitionId: null }]),
    );
    const bare = await waitForBatch(depsOf(noDefinition.fetch), 'b1', 60_000);
    expect(bare).toMatchObject({ failure: { message: 'Batch b1 cannot finish: 1 jobs failed' } });
  });

  it('times out with the last statistics in the error data', async () => {
    const server = fakeServer().on('GET', '/batch/statistics', json([RUNNING]));
    const result = await waitForBatch(depsOf(server.fetch), 'b1', 1000);
    expect(result).toMatchObject({
      view: { batch: { id: 'b1', type: 'instance-deletion', totalJobs: 4, startTime: 's' } },
      failure: {
        code: 'WAIT_TIMEOUT',
        message: 'Timed out after 1s waiting until batch b1 finished',
        details: { data: { until: ['finished'], polls: 4 } },
      },
    });
  });
});

describe('waitForBatch details', () => {
  const timeoutOf = async (row: Record<string, unknown>) => {
    const server = fakeServer()
      .on('GET', '/batch/statistics', json([row]))
      .on('GET', '/job', json([]));
    const result = await waitForBatch(depsOf(server.fetch), 'b1', 1000);
    return result.kind === 'view' ? result.failure?.code : undefined;
  };

  it('is stuck only when every job was created and only failed jobs remain', async () => {
    expect(await timeoutOf({ ...RUNNING, remainingJobs: 1, failedJobs: 1 })).toBe('JOB_FAILED');
    expect(await timeoutOf({ ...RUNNING, jobsCreated: 3, remainingJobs: 1, failedJobs: 1 })).toBe(
      'WAIT_TIMEOUT',
    );
    expect(await timeoutOf({ ...RUNNING, remainingJobs: 2, failedJobs: 1 })).toBe('WAIT_TIMEOUT');
    expect(await timeoutOf({ ...RUNNING, remainingJobs: 0, failedJobs: 0 })).toBe('WAIT_TIMEOUT');
  });

  it('asks for the batch by id and names the fixes in the hints', async () => {
    const stuck = { ...RUNNING, remainingJobs: 1, failedJobs: 1 };
    const server = fakeServer()
      .on('GET', '/batch/statistics', json([stuck]))
      .on('GET', '/job', json([]));
    const result = await waitForBatch(depsOf(server.fetch), 'b1', 60_000);
    expect(server.requests[0]?.query.toString()).toBe('batchId=b1');
    expect(result.kind === 'view' ? result.failure?.details.hint : undefined).toBe(
      '`operate job list --job-definition-id jd-b --with-exception` lists the failed jobs; fix the cause, then set their retries (`operate job set-retries <id> --retries 1`).',
    );
    const bare = fakeServer().on(
      'GET',
      '/batch/statistics',
      json([{ ...stuck, batchJobDefinitionId: null }]),
    );
    const result2 = await waitForBatch(depsOf(bare.fetch), 'b1', 60_000);
    expect(result2.kind === 'view' ? result2.failure?.details.hint : undefined).toContain(
      '--job-definition-id <id> --with-exception',
    );
    const missing = fakeServer()
      .on('GET', '/batch/statistics', json([]))
      .on('GET', '/history/batch/b1', engineError(404, 'InvalidRequestException', 'no history'));
    await expect(waitForBatch(depsOf(missing.fetch), 'b1', 1000)).rejects.toMatchObject({
      details: {
        hint: 'List batches with `operate batch list` (running) or `operate historic-batch list` (also finished).',
      },
    });
  });

  it('times out with the hint about the job executor and the batch in the data', async () => {
    const server = fakeServer().on('GET', '/batch/statistics', json([{ totalJobs: 2 }]));
    const result = await waitForBatch(depsOf(server.fetch), 'b7', 1000);
    expect(result).toMatchObject({
      kind: 'view',
      view: { batch: { id: 'b7', type: '', totalJobs: 2 } },
      failure: {
        details: {
          hint: 'The batch jobs and its monitor job run on the job executor (the monitor checks every 30 s by default); raise --wait-timeout, or run `operate status` to see overdue jobs.',
          data: { batch: { id: 'b7', type: '', totalJobs: 2 } },
        },
      },
    });
  });

  it('prefers the history record and falls back to the statistics per field', async () => {
    let first = true;
    const server = fakeServer()
      .on('GET', '/batch/statistics', () => {
        const rows = first ? [{ ...RUNNING, id: 'stat-id', failedJobs: 0 }] : [];
        first = false;
        return json(rows);
      })
      .on('GET', '/history/batch/b1', json({ endTime: 'e' }));
    const result = await waitForBatch(depsOf(server.fetch), 'b1', 60_000);
    expect(result.kind === 'view' ? result.view.batch : undefined).toEqual({
      id: 'stat-id',
      type: 'instance-deletion',
      totalJobs: 4,
      startTime: 's',
      endTime: 'e',
    });
  });
});
