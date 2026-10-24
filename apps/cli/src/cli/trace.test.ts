import { describe, expect, it } from 'vitest';
import { fakeStream } from '../../test/support/fake-runtime.js';
import { formatTrace, traceWriter } from './trace.js';

const request = {
  type: 'request',
  method: 'POST',
  url: 'http://user:pw@h/engine-rest/task',
  headers: { Accept: 'application/json', Authorization: 'Basic abc', 'X-Api-Key': 'k' },
} as const;

describe('formatTrace', () => {
  it('prints the request line and headers, masked', () => {
    expect(formatTrace(request, false)).toBe(
      [
        '> POST http://user:***@h/engine-rest/task',
        '> Accept: application/json',
        '> Authorization: Basic ***',
        '> X-Api-Key: ***',
        '',
      ].join('\n'),
    );
  });

  it('prints secrets with show', () => {
    expect(formatTrace(request, true)).toBe(
      [
        '> POST http://user:pw@h/engine-rest/task',
        '> Accept: application/json',
        '> Authorization: Basic abc',
        '> X-Api-Key: k',
        '',
      ].join('\n'),
    );
  });

  it('prints the response line with and without status text', () => {
    const response = {
      type: 'response',
      status: 404,
      statusText: 'Not Found',
      durationMs: 12,
      bytes: 99,
    } as const;
    expect(formatTrace(response, false)).toBe('< 404 Not Found (12 ms, 99 bytes)\n');
    expect(formatTrace({ ...response, statusText: '' }, false)).toBe('< 404 (12 ms, 99 bytes)\n');
  });

  it('prints a note like curl -v', () => {
    expect(formatTrace({ type: 'note', message: 'Using the cached token.' }, false)).toBe(
      '* Using the cached token.\n',
    );
  });
});

describe('traceWriter', () => {
  it('writes every event to the stream', () => {
    const stream = fakeStream();
    const trace = traceWriter(stream, false);
    trace({ type: 'request', method: 'GET', url: 'http://h/x', headers: {} });
    trace({ type: 'response', status: 200, statusText: 'OK', durationMs: 1, bytes: 2 });
    expect(stream.text()).toBe('> GET http://h/x\n< 200 OK (1 ms, 2 bytes)\n');
  });
});
