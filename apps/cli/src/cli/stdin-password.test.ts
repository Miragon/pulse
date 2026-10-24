import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fakeRuntime } from '../../test/support/fake-runtime.js';
import { OperateError } from '../errors.js';
import { checkStdinUse, firstLine, readStdinPassword } from './stdin-password.js';

const encode = (text: string) => new TextEncoder().encode(text);

async function usage(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    expect((error as OperateError).code).toBe('USAGE');
    expect((error as OperateError).exitCode).toBe(2);
    return error as OperateError;
  }
  throw new Error('expected a usage error');
}

describe('firstLine', () => {
  it.each([
    ['pw', 'pw'],
    ['pw\n', 'pw'],
    ['pw\r\n', 'pw'],
    ['pw\r', 'pw'],
    ['pw\r\r\n', 'pw'],
    ['p\rw\n', 'p\rw'],
    ['pw\nsecond line\n', 'pw'],
    [' p:w \n', ' p:w '],
    ['\npw', ''],
    ['', ''],
    ['päß\u{1f511}\n', 'päß\u{1f511}'],
    ['﻿pw\n', 'pw'],
  ])('reads %j as %j', (input, expected) => {
    expect(firstLine(encode(input))).toBe(expected);
  });

  it.each([
    ['a Latin-1 byte', Uint8Array.of(0x70, 0xe4, 0x73, 0x73, 0x0a)],
    ['a truncated sequence', Uint8Array.of(0x70, 0xc3)],
    ['a lone continuation byte', Uint8Array.of(0x80, 0x0a, 0x70)],
  ])('refuses %s instead of replacing it, without quoting the bytes', async (_, data) => {
    const error = await usage(Promise.resolve().then(() => firstLine(data)));
    expect(error.message).toBe('--auth-password-stdin read bytes that are not valid UTF-8');
    expect(error.details.hint).toBe(
      'Re-encode the password as UTF-8, e.g. with iconv -f latin1 -t utf-8; operate sends it UTF-8 encoded.',
    );
  });

  it('decodes only the first line: bytes after it do not matter', () => {
    expect(firstLine(Uint8Array.of(0x70, 0x77, 0x0d, 0x0a, 0xe4, 0xff))).toBe('pw');
    expect(firstLine(Uint8Array.of(0x70, 0xc3, 0xa4, 0x0a, 0xe4))).toBe('pä');
  });

  it('returns any line without line breaks unchanged', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }).map((text) => text.replace(/[\r\n\ufeff]/g, '')),
        fc.constantFrom('', '\n', '\r\n', '\nmore\n'),
        (line, rest) => {
          expect(firstLine(encode(`${line}${rest}`))).toBe(line);
        },
      ),
    );
  });
});

describe('checkStdinUse', () => {
  const use = (password: boolean, token: boolean, body: boolean) => ({ password, token, body });

  it('allows one reader of stdin', () => {
    expect(() => {
      checkStdinUse(use(true, false, false));
      checkStdinUse(use(false, true, false));
      checkStdinUse(use(false, false, true));
      checkStdinUse(use(false, false, false));
    }).not.toThrow();
  });

  it('refuses the password and the body from stdin together', async () => {
    const error = await usage(
      Promise.resolve().then(() => {
        checkStdinUse(use(true, false, true));
      }),
    );
    expect(error.message).toBe('--auth-password-stdin and --body - both read stdin');
    expect(error.details.hint).toBe(
      'Pass the body as a file (--body @file.json), or the password with OPERATE_PASSWORD or a profile (--auth-password-env).',
    );
  });

  it('refuses the token and the body from stdin together', async () => {
    const error = await usage(
      Promise.resolve().then(() => {
        checkStdinUse(use(false, true, true));
      }),
    );
    expect(error.message).toBe('--auth-token-stdin and --body - both read stdin');
    expect(error.details.hint).toBe(
      'Pass the body as a file (--body @file.json), or the token with OPERATE_TOKEN or a profile (--auth-token-env).',
    );
  });

  it('refuses the password and the token from stdin together, also with a body', async () => {
    for (const body of [false, true]) {
      const error = await usage(
        Promise.resolve().then(() => {
          checkStdinUse(use(true, true, body));
        }),
      );
      expect(error.message).toBe('--auth-password-stdin and --auth-token-stdin both read stdin');
      expect(error.details.hint).toContain('OPERATE_PASSWORD or OPERATE_TOKEN');
    }
  });
});

describe('readStdinPassword', () => {
  it('reads the first line', async () => {
    await expect(readStdinPassword(fakeRuntime({ stdin: 's3:cr3t\n' }))).resolves.toBe('s3:cr3t');
  });

  it.each(['', '\n', '\r\n', '   \n', '\nsecond'])(
    'refuses the empty password %j',
    async (stdin) => {
      const error = await usage(readStdinPassword(fakeRuntime({ stdin })));
      expect(error.message).toBe('--auth-password-stdin read an empty password');
      expect(error.details.hint).toBe(
        `Pipe the password into the command, e.g. printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin.`,
      );
    },
  );

  it('refuses a password that is not UTF-8', async () => {
    const error = await usage(readStdinPassword(fakeRuntime({ stdin: Uint8Array.of(0xe4) })));
    expect(error.message).toBe('--auth-password-stdin read bytes that are not valid UTF-8');
  });

  it('passes errors of stdin on', async () => {
    await expect(readStdinPassword(fakeRuntime())).rejects.toThrow(
      'stdin is a terminal in this test',
    );
  });
});

describe('another secret from stdin', () => {
  const secret = {
    flag: '--oauth-client-secret-stdin',
    noun: 'client secret',
    example: 'printf x | operate',
  };

  it('names the flag and the secret in its errors', async () => {
    const empty = await usage(readStdinPassword(fakeRuntime({ stdin: ' \n' }), secret));
    expect(empty.message).toBe('--oauth-client-secret-stdin read an empty client secret');
    expect(empty.details.hint).toBe(
      'Pipe the client secret into the command, e.g. printf x | operate.',
    );
    const latin1 = await usage(
      Promise.resolve().then(() => firstLine(Uint8Array.of(0xe4), secret)),
    );
    expect(latin1.message).toBe('--oauth-client-secret-stdin read bytes that are not valid UTF-8');
    expect(latin1.details.hint).toBe(
      'Re-encode the client secret as UTF-8, e.g. with iconv -f latin1 -t utf-8; operate sends it UTF-8 encoded.',
    );
    await expect(readStdinPassword(fakeRuntime({ stdin: 's3cret\n' }), secret)).resolves.toBe(
      's3cret',
    );
  });
});
