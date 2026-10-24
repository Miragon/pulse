import { STATUS_CODES } from 'node:http';
import { describe, expect, it } from 'vitest';
import { statusTextOf } from './status.js';

/** Every status of the reason phrase table. */
const KNOWN = [
  200, 201, 202, 204, 206, 301, 302, 303, 304, 307, 308, 400, 401, 403, 404, 405, 406, 408, 409,
  410, 413, 415, 422, 429, 500, 501, 502, 503, 504,
];

describe('statusTextOf', () => {
  it('keeps the status text the server sent', () => {
    expect(statusTextOf(404, 'Nicht gefunden')).toBe('Nicht gefunden');
    expect(statusTextOf(599, 'Custom')).toBe('Custom');
  });

  it.each(KNOWN)('fills in the reason phrase of %i when the server sent none', (status) => {
    expect(statusTextOf(status, '')).toBe(STATUS_CODES[status]);
  });

  it('stays empty for a status without a reason phrase in the table', () => {
    expect(statusTextOf(299, '')).toBe('');
    expect(statusTextOf(418, '')).toBe('');
    expect(statusTextOf(599, '')).toBe('');
  });
});
