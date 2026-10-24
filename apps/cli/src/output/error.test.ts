import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperateError, usageError } from '../errors.js';
import { renderError, toOperateError } from './error.js';

const INTERNAL_HINT =
  'This is likely a bug in operate. Re-run with --verbose for the stack trace and report it at https://github.com/Miragon/operate/issues.';

function withStack<T extends Error>(error: T, stack: string | undefined): T {
  Object.defineProperty(error, 'stack', { value: stack, configurable: true });
  return error;
}

function notFound(): OperateError {
  return new OperateError('NOT_FOUND', 'HTTP 404 Not Found: Process instance abc does not exist', {
    status: 404,
    engineType: 'InvalidRequestException',
    engineMessage: 'Process instance abc does not exist',
    engineCode: 0,
    hint: 'Check the id or key.',
    request: {
      method: 'GET',
      url: 'http://demo:secret@localhost:8080/engine-rest/process-instance/abc',
    },
    data: { details: { a: 1 } },
  });
}

/** A network error as built by the HTTP client for a URL with credentials. */
function credentialsError(): OperateError {
  const url = 'http://demo:s3cret@localhost:1/engine-rest/x';
  const cause = withStack(
    new TypeError(`Request cannot be constructed from a URL that includes credentials: ${url}`),
    `TypeError: Request cannot be constructed from a URL that includes credentials: ${url}\n    at fetch`,
  );
  return withStack(
    new OperateError(
      'NETWORK',
      `Cannot reach ${url} (${cause.message})`,
      {
        request: { method: 'GET', url },
        engineMessage: `Engine says ${url}`,
        hint: `Check ${url}`,
      },
      cause,
    ),
    `OperateError: Cannot reach ${url}\n    at send`,
  );
}

describe('toOperateError', () => {
  it('returns OperateErrors unchanged', () => {
    const error = usageError('bad');
    expect(toOperateError(error)).toBe(error);
  });

  it('wraps Errors as INTERNAL with the original as cause and a hint', () => {
    const cause = new Error('boom');
    const error = toOperateError(cause);
    expect(error).toBeInstanceOf(OperateError);
    expect(error.code).toBe('INTERNAL');
    expect(error.exitCode).toBe(1);
    expect(error.message).toBe('boom');
    expect(error.cause).toBe(cause);
    expect(error.details).toEqual({ hint: INTERNAL_HINT });
  });

  it('prefixes the class name of Error subclasses and falls back to it for empty messages', () => {
    expect(toOperateError(new TypeError('x is undefined')).message).toBe(
      'TypeError: x is undefined',
    );
    expect(toOperateError(new Error('')).message).toBe('Error');
    expect(toOperateError(new RangeError()).message).toBe('RangeError');
  });

  it('describes thrown strings and error-like objects', () => {
    expect(toOperateError('oops').message).toBe('oops');
    expect(toOperateError('oops').cause).toBe('oops');
    expect(toOperateError('').message).toBe('');
    expect(toOperateError({ message: 'from object' }).message).toBe('from object');
    expect(toOperateError({ message: '' }).message).toBe('{"message":""}');
    expect(toOperateError({ message: 5 }).message).toBe('{"message":5}');
    expect(toOperateError({ code: 1 }).message).toBe('{"code":1}');
  });

  it('describes other thrown values without crashing', () => {
    expect(toOperateError(42).message).toBe('42');
    expect(toOperateError(true).message).toBe('true');
    expect(toOperateError(null).message).toBe('null');
    expect(toOperateError(undefined).message).toBe('undefined');
    expect(toOperateError(undefined).cause).toBeUndefined();
    expect(toOperateError(Symbol('s')).message).toBe('Symbol(s)');
    expect(toOperateError(10n).message).toBe('10');
    expect(toOperateError(Object.create(null)).message).toBe('{}');
    expect(toOperateError([1, 'a']).message).toBe('[1,"a"]');
  });

  it('survives values that throw on every inspection', () => {
    const cyclic = Object.create(null) as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(toOperateError(cyclic).message).toBe('Unknown error (object)');
    const hostile = {
      get message(): string {
        throw new Error('no');
      },
    };
    expect(toOperateError(hostile).message).toBe('Unknown error (object)');
  });

  it('always returns an INTERNAL OperateError for arbitrary values (property)', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const error = toOperateError(value);
        expect(error).toBeInstanceOf(OperateError);
        expect(error.code).toBe('INTERNAL');
        expect(typeof error.message).toBe('string');
        expect(() => renderError(error, 'json', true)).not.toThrow();
        expect(() => renderError(error, 'table', true)).not.toThrow();
      }),
    );
  });
});

describe('renderError as JSON', () => {
  it('renders one line with all details in contract order and a masked request URL', () => {
    expect(renderError(notFound(), 'json')).toBe(
      `${JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          exitCode: 5,
          message: 'HTTP 404 Not Found: Process instance abc does not exist',
          status: 404,
          engineType: 'InvalidRequestException',
          engineMessage: 'Process instance abc does not exist',
          engineCode: 0,
          hint: 'Check the id or key.',
          request: {
            method: 'GET',
            url: 'http://demo:***@localhost:8080/engine-rest/process-instance/abc',
          },
          data: { details: { a: 1 } },
        },
      })}\n`,
    );
  });

  it('renders only code, exit code and message for plain errors', () => {
    expect(renderError(usageError('Missing argument <id>'), 'json')).toBe(
      '{"error":{"code":"USAGE","exitCode":2,"message":"Missing argument <id>"}}\n',
    );
  });

  it('keeps multi-line messages on one line', () => {
    const output = renderError(usageError('first\nsecond'), 'json');
    expect(output.indexOf('\n')).toBe(output.length - 1);
    expect(output).toContain('"message":"first\\nsecond"');
  });

  it('includes the stack with causes only when verbose', () => {
    const cause = withStack(new TypeError('fetch failed'), 'TypeError: fetch failed\n    at fetch');
    const error = withStack(
      new OperateError('NETWORK', 'Cannot reach host', {}, cause),
      'OperateError: Cannot reach host\n    at send',
    );
    expect(renderError(error, 'json')).not.toContain('stack');
    const parsed = JSON.parse(renderError(error, 'json', true)) as { error: { stack: string } };
    expect(parsed.error.stack).toBe(
      'OperateError: Cannot reach host\n    at send\nCaused by: TypeError: fetch failed\n    at fetch',
    );
  });

  it('drops data that cannot be serialized instead of crashing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const error = new OperateError('INTERNAL', 'x', { data: cyclic });
    expect(renderError(error, 'json')).toBe(
      '{"error":{"code":"INTERNAL","exitCode":1,"message":"x"}}\n',
    );
  });

  it('writes large integers of engine data exactly', () => {
    const error = new OperateError('HTTP_CLIENT_ERROR', 'x', {
      data: { id: 9223372036854775807n },
    });
    expect(renderError(error, 'json')).toContain('"data":{"id":9223372036854775807}');
  });

  it('masks URL passwords in message, engine message, hint, request and stack', () => {
    const output = renderError(credentialsError(), 'json', true);
    expect(output).not.toContain('s3cret');
    const masked = 'http://demo:***@localhost:1/engine-rest/x';
    expect(JSON.parse(output)).toEqual({
      error: {
        code: 'NETWORK',
        exitCode: 8,
        message: `Cannot reach ${masked} (Request cannot be constructed from a URL that includes credentials: ${masked})`,
        engineMessage: `Engine says ${masked}`,
        hint: `Check ${masked}`,
        request: { method: 'GET', url: masked },
        stack: `OperateError: Cannot reach ${masked}\n    at send\nCaused by: TypeError: Request cannot be constructed from a URL that includes credentials: ${masked}\n    at fetch`,
      },
    });
  });

  it('keeps control characters escaped on the single line', () => {
    const output = renderError(usageError('a\r\nb\u001b[31m'), 'json');
    expect(output).toBe(
      '{"error":{"code":"USAGE","exitCode":2,"message":"a\\r\\nb\\u001b[31m"}}\n',
    );
  });

  it('keeps falsy but defined details', () => {
    const error = new OperateError('HTTP_CLIENT_ERROR', 'x', { status: 0, hint: '', data: null });
    expect(renderError(error, 'json')).toBe(
      '{"error":{"code":"HTTP_CLIENT_ERROR","exitCode":6,"message":"x","status":0,"hint":"","data":null}}\n',
    );
  });
});

describe('renderError for humans', () => {
  it('renders the message with Engine, Request, Details and Hint lines', () => {
    expect(renderError(notFound(), 'table')).toBe(
      [
        'Error: HTTP 404 Not Found: Process instance abc does not exist',
        '  Engine: InvalidRequestException',
        '  Request: GET http://demo:***@localhost:8080/engine-rest/process-instance/abc',
        '  Details: {"details":{"a":1}}',
        '  Hint: Check the id or key.',
        '',
      ].join('\n'),
    );
  });

  it('renders only the message for plain errors', () => {
    expect(renderError(usageError('Missing argument <id>'), 'table')).toBe(
      'Error: Missing argument <id>\n',
    );
  });

  it('indents continuation lines of messages and hints', () => {
    const error = usageError('Invalid request body:\n- a\n- b', 'Run this\nor that');
    expect(renderError(error, 'table')).toBe(
      'Error: Invalid request body:\n  - a\n  - b\n  Hint: Run this\n    or that\n',
    );
  });

  it('appends the indented stack and its causes only when verbose', () => {
    const cause = withStack(new Error('inner'), 'Error: inner\n    at g');
    const error = withStack(
      new OperateError('NETWORK', 'outer', { hint: 'h' }, cause),
      'OperateError: outer\n    at f',
    );
    expect(renderError(error, 'table')).toBe('Error: outer\n  Hint: h\n');
    expect(renderError(error, 'table', false)).toBe('Error: outer\n  Hint: h\n');
    expect(renderError(error, 'table', true)).toBe(
      [
        'Error: outer',
        '  Hint: h',
        '  Stack:',
        '    OperateError: outer',
        '        at f',
        '    Caused by: Error: inner',
        '        at g',
        '',
      ].join('\n'),
    );
  });

  it('falls back to name and message when stacks are missing', () => {
    const cause = withStack(new TypeError('inner'), undefined);
    const error = withStack(new OperateError('INTERNAL', 'outer', {}, cause), undefined);
    expect(renderError(error, 'table', true)).toBe(
      'Error: outer\n  Stack:\n    OperateError: outer\n    Caused by: TypeError: inner\n',
    );
  });

  it('follows at most five causes and ignores non-Error causes', () => {
    const first = withStack(new Error('c'), 'c');
    let cause: Error = first;
    for (let index = 0; index < 7; index += 1) cause = withStack(new Error('c', { cause }), 'c');
    first.cause = cause;
    const error = withStack(new OperateError('INTERNAL', 'x', {}, cause), 's');
    const output = renderError(error, 'table', true);
    expect(output.match(/Caused by: c/g)).toHaveLength(5);
    const stringCause = withStack(new OperateError('INTERNAL', 'x', {}, 'text'), 's');
    expect(renderError(stringCause, 'table', true)).toBe('Error: x\n  Stack:\n    s\n');
  });

  it('masks URL passwords in message, request, hint and stack', () => {
    const masked = 'http://demo:***@localhost:1/engine-rest/x';
    const credentials = 'Request cannot be constructed from a URL that includes credentials';
    expect(renderError(credentialsError(), 'table', true)).toBe(
      [
        `Error: Cannot reach ${masked} (${credentials}: ${masked})`,
        `  Request: GET ${masked}`,
        `  Hint: Check ${masked}`,
        '  Stack:',
        `    OperateError: Cannot reach ${masked}`,
        '        at send',
        `    Caused by: TypeError: ${credentials}: ${masked}`,
        '        at fetch',
        '',
      ].join('\n'),
    );
  });

  it('ends lines at CR and CRLF and replaces other control characters', () => {
    const error = new OperateError(
      'HTTP_CLIENT_ERROR',
      'HTTP 400: line 1\r\nline 2\rline 3\u001b[31m\u009b\u0007\tend',
      { engineType: 'Parse\u001bException', hint: 'a\r\nb', data: { x: '\u009b' } },
    );
    expect(renderError(error, 'table')).toBe(
      [
        'Error: HTTP 400: line 1',
        '  line 2',
        '  line 3 [31m  \tend',
        '  Engine: Parse Exception',
        '  Details: {"x":" "}',
        '  Hint: a',
        '    b',
        '',
      ].join('\n'),
    );
  });

  it('indents continuation lines of every labeled line', () => {
    const error = new OperateError('INTERNAL', 'x', {
      engineType: 'A\nB',
      request: { method: 'GET', url: 'http://h/\nx' },
    });
    expect(renderError(error, 'table')).toBe(
      'Error: x\n  Engine: A\n    B\n  Request: GET http://h/\n    x\n',
    );
  });

  it('omits the Details line for data that cannot be serialized', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const error = new OperateError('INTERNAL', 'x', { data: cyclic });
    expect(renderError(error, 'table')).toBe('Error: x\n');
  });
});
