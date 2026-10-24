import { describe, expect, it } from 'vitest';
import { fakeRuntime, type FakeRuntimeOptions } from '../../test/support/fake-runtime.js';
import { authDeps } from '../../test/support/oauth.js';
import type { CommandBearerConfig } from '../config/types.js';
import { OperateError } from '../errors.js';
import type { TraceEvent } from '../http/types.js';
import { runTokenCommand } from './token-command.js';

const CONFIG: CommandBearerConfig = {
  type: 'bearer',
  source: 'env',
  origin: 'OPERATE_TOKEN_COMMAND',
  command: './token.sh dev',
};

const PREFIX = 'The bearer token command (OPERATE_TOKEN_COMMAND)';

async function runWith(options: FakeRuntimeOptions) {
  const runtime = fakeRuntime(options);
  const events: TraceEvent[] = [];
  const deps = authDeps(runtime, { events });
  try {
    return { token: await runTokenCommand(CONFIG, deps), runtime, events };
  } catch (error) {
    if (!(error instanceof OperateError)) throw error;
    return { error, runtime, events };
  }
}

describe('runTokenCommand', () => {
  it('runs the command line with the shell, bounded by the timeout', async () => {
    const result = await runWith({ commands: { stdout: 'abc.def\nignored\n' } });
    expect(result.token).toBe('abc.def');
    expect(result.runtime.commandRuns).toStrictEqual([
      { command: './token.sh dev', options: { timeoutMs: 30_000 } },
    ]);
    // without a line break the whole output is the line
    expect((await runWith({ commands: { stdout: 'abc.def' } })).token).toBe('abc.def');
  });

  it('takes the first line: CRLF, blanks and a "Bearer " prefix go', async () => {
    expect((await runWith({ commands: { stdout: '  Bearer abc.def== \r\n' } })).token).toBe(
      'abc.def==',
    );
  });

  it('traces the run with --verbose, never the token', async () => {
    const result = await runWith({ commands: { stdout: 'tok-123' } });
    expect(result.events).toEqual([
      { type: 'note', message: 'Running the bearer token command of OPERATE_TOKEN_COMMAND.' },
    ]);
  });

  it('is LOGIN_FAILED quoting the end of stderr when the command fails', async () => {
    const stderr = 'line 1\n\nline 2\r\nline \u001b[31m3\u0007\nline 4\n';
    const result = await runWith({ commands: { exitCode: 7, stderr } });
    expect(result.error?.code).toBe('LOGIN_FAILED');
    expect(result.error?.exitCode).toBe(4);
    expect(result.error?.message).toBe(
      `${PREFIX} failed with exit code 7: line 2 / line  [31m3 / line 4`,
    );
    expect(result.error?.details.hint).toBe(
      'operate runs the command with the shell in the working directory, stdin closed and bounded by the request timeout (--timeout), and takes the first line of its stdout as the token (not a JSON answer: use e.g. jq -r .access_token). Run it in a shell to see what goes wrong (`operate config show` prints it).',
    );
    const silent = await runWith({ commands: { exitCode: 1 } });
    expect(silent.error?.message).toBe(`${PREFIX} failed with exit code 1`);
    const killed = await runWith({ commands: { exitCode: null } });
    expect(killed.error?.message).toBe(`${PREFIX} ended by a signal`);
  });

  it('keeps the end of a long stderr', async () => {
    const result = await runWith({ commands: { exitCode: 2, stderr: `${'x'.repeat(400)}END` } });
    expect(result.error?.message.endsWith(`: …${'x'.repeat(296)}END`)).toBe(true);
    const exact = await runWith({ commands: { exitCode: 2, stderr: 'y'.repeat(300) } });
    expect(exact.error?.message.endsWith(`: ${'y'.repeat(300)}`)).toBe(true);
  });

  it('is LOGIN_FAILED for a timeout, a start failure or no token', async () => {
    const timeout = await runWith({ commands: { timedOut: true, exitCode: null } });
    expect(timeout.error?.message).toBe(`${PREFIX} did not finish within 30000 ms and was stopped`);
    const missing = await runWith({
      commands: () => Promise.reject(Object.assign(new Error('spawn'), { code: 'ENOENT' })),
    });
    expect(missing.error?.message).toBe(`${PREFIX} could not be started (ENOENT)`);
    expect(missing.error?.code).toBe('LOGIN_FAILED');
    const odd = await runWith({ commands: () => Promise.reject(new Error('boom')) });
    expect(odd.error?.message).toBe(`${PREFIX} could not be started (boom)`);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection
    const thrown = await runWith({ commands: () => Promise.reject('text') });
    expect(thrown.error?.message).toBe(`${PREFIX} could not be started (text)`);
    for (const stdout of ['', '\nabc', '   \n']) {
      const empty = await runWith({ commands: { stdout } });
      expect(empty.error?.message, JSON.stringify(stdout)).toBe(
        `${PREFIX} printed no token on the first line of stdout`,
      );
    }
  });

  it('is LOGIN_FAILED for something that is not a token, never quoting it', async () => {
    const result = await runWith({ commands: { stdout: '{"access_token":"s3cr3t-value"}' } });
    expect(result.error?.code).toBe('LOGIN_FAILED');
    expect(result.error?.message).toBe(
      'The bearer token from the command of OPERATE_TOKEN_COMMAND has characters a bearer token cannot have (RFC 6750)',
    );
    expect(result.error?.details.hint).toContain('not a whole header line, a JSON answer');
    expect(JSON.stringify(result.error)).not.toContain('s3cr3t-value');
    const binary = await runWith({ commands: { stdout: new Uint8Array([0xff, 0xfe, 0x0a]) } });
    expect(binary.error?.code).toBe('LOGIN_FAILED');
  });
});
