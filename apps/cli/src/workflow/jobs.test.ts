import { describe, expect, it } from 'vitest';
import { fakeClock, portOf } from '../../test/support/engine-port.js';
import {
  connectionRefused,
  engineError,
  fakeServer,
  json,
  noContent,
  text,
} from '../../test/support/fake-fetch.js';
import { executeJob } from './jobs.js';

const STACKTRACE =
  'org.x.ProcessEngineException: outer\nCaused by: org.x.PropertyNotFoundException: missingBean\n';
const JOB = { id: 'j1', processInstanceId: 'p1', failedActivityId: 'book', retries: 2 };

function run(server: ReturnType<typeof fakeServer>) {
  const clock = fakeClock();
  return { result: executeJob(portOf(server.fetch), 'j1', clock.sleep), clock };
}

describe('executeJob', () => {
  it('is executed for 204', async () => {
    const server = fakeServer().on('POST', '/job/j1/execute', noContent());
    expect(await run(server).result).toEqual({ result: 'executed' });
  });

  it('is failed with the root cause when a 404 leaves the job in place', async () => {
    const server = fakeServer()
      .on(
        'POST',
        '/job/j1/execute',
        engineError(404, 'InvalidRequestException', 'Unknown property used in expression'),
      )
      .on('GET', '/job/j1', json(JOB))
      .on('GET', '/job/j1/stacktrace', text(STACKTRACE, 'text/plain'));
    expect(await run(server).result).toEqual({
      result: 'failed',
      jobId: 'j1',
      message: 'Unknown property used in expression',
      rootCause: 'PropertyNotFoundException: missingBean',
      activityId: 'book',
      processInstanceId: 'p1',
    });
  });

  it('is executed by the job executor when the job is gone after the error', async () => {
    const server = fakeServer()
      .on(
        'POST',
        '/job/j1/execute',
        engineError(404, 'InvalidRequestException', "ENGINE-14026 No job found with id 'j1'"),
      )
      .on('GET', '/job/j1', engineError(404, 'InvalidRequestException', 'gone'));
    expect(await run(server).result).toEqual({ result: 'executed', executedBy: 'jobExecutor' });
  });

  it('is failed for a 500 with the job still there; the message without stacktrace', async () => {
    const server = fakeServer()
      .on('POST', '/job/j1/execute', engineError(500, 'ProcessEngineException', 'boom'))
      .on('GET', '/job/j1', json({ id: 'j1' }))
      .on('GET', '/job/j1/stacktrace', engineError(404, 'InvalidRequestException', 'no trace'));
    expect(await run(server).result).toEqual({
      result: 'failed',
      jobId: 'j1',
      message: 'boom',
      rootCause: 'boom',
    });
  });

  it('reads the job again after an optimistic locking conflict: gone means executed', async () => {
    const server = fakeServer()
      .on('POST', '/job/j1/execute', engineError(500, 'OptimisticLockingException', 'conflict'))
      .on('GET', '/job/j1', engineError(404, 'InvalidRequestException', 'gone'));
    const { result, clock } = run(server);
    expect(await result).toEqual({ result: 'executed', executedBy: 'jobExecutor' });
    expect(clock.sleeps).toEqual([250]);
  });

  it('tries once more after a conflict when the job is still there', async () => {
    let attempts = 0;
    const server = fakeServer()
      .on('POST', '/job/j1/execute', () => {
        attempts += 1;
        return attempts === 1
          ? engineError(500, 'ProcessEngineException', 'OptimisticLockingException: x')
          : noContent();
      })
      .on('GET', '/job/j1', json(JOB));
    expect(await run(server).result).toEqual({ result: 'executed' });
    let second = 0;
    const failing = fakeServer()
      .on('POST', '/job/j1/execute', () => {
        second += 1;
        return engineError(
          second === 1 ? 500 : 404,
          second === 1 ? 'OptimisticLockingException' : 'InvalidRequestException',
          'failed again',
        );
      })
      .on('GET', '/job/j1', json(JOB))
      .on('GET', '/job/j1/stacktrace', text(STACKTRACE, 'text/plain'));
    expect(await run(failing).result).toMatchObject({ result: 'failed', message: 'failed again' });
  });

  it('rethrows 401, 403 and network errors', async () => {
    for (const status of [401, 403]) {
      const server = fakeServer().on(
        'POST',
        '/job/j1/execute',
        engineError(status, 'AuthenticationException', 'no'),
      );
      await expect(run(server).result).rejects.toMatchObject({ details: { status } });
    }
    const offline: typeof globalThis.fetch = () => Promise.reject(connectionRefused());
    await expect(executeJob(portOf(offline), 'j1', fakeClock().sleep)).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });
});

describe('executeJob details', () => {
  it('checks a 400 against the job like other engine errors', async () => {
    const server = fakeServer()
      .on('POST', '/job/j1/execute', engineError(400, 'InvalidRequestException', 'bad'))
      .on('GET', '/job/j1', json({ id: 'j1' }))
      .on('GET', '/job/j1/stacktrace', engineError(404, 'InvalidRequestException', 'no trace'));
    expect(await run(server).result).toMatchObject({ result: 'failed', message: 'bad' });
  });

  it('does not execute again when the job is gone after a conflict', async () => {
    const server = fakeServer()
      .on('POST', '/job/j1/execute', engineError(500, 'OptimisticLockingException', 'conflict'))
      .on('GET', '/job/j1', engineError(404, 'InvalidRequestException', 'gone'));
    await run(server).result;
    expect(server.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /job/j1/execute',
      'GET /job/j1',
    ]);
  });

  it('finds the conflict in the message when the engine type is missing', async () => {
    const server = fakeServer()
      .on('POST', '/job/j1/execute', engineError(500, '', 'OptimisticLockingException: x'))
      .on('GET', '/job/j1', engineError(404, 'InvalidRequestException', 'gone'));
    const { result, clock } = run(server);
    expect(await result).toEqual({ result: 'executed', executedBy: 'jobExecutor' });
    expect(clock.sleeps).toEqual([250]);
  });
});
