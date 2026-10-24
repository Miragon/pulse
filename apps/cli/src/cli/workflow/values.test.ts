/** The option readers of the workflow commands on plain flag maps. */

import { describe, expect, it } from 'vitest';
import { OperateError } from '../../errors.js';
import { integer, otherWords, selectionOf, waitSettings } from './values.js';

function usage(fn: () => unknown): OperateError {
  try {
    fn();
  } catch (error) {
    if (error instanceof OperateError) return error;
  }
  throw new Error('expected a usage error');
}

describe('integer', () => {
  it('accepts both ends of the range and refuses values beyond them', () => {
    const range = { min: 1, max: 100 };
    expect(integer({ n: '1' }, 'n', range)).toBe(1);
    expect(integer({ n: '100' }, 'n', range)).toBe(100);
    expect(integer({}, 'n', range)).toBeUndefined();
    expect(usage(() => integer({ n: '101' }, 'n', range)).message).toBe(
      '--n expects an integer between 1 and 100, got "101"',
    );
    expect(usage(() => integer({ n: '0' }, 'n', range)).message).toBe(
      '--n expects an integer between 1 and 100, got "0"',
    );
    expect(usage(() => integer({ n: '1.5' }, 'n', range)).message).toBe(
      '--n expects an integer, got "1.5"',
    );
    expect(usage(() => integer({ n: '3000000000' }, 'n', { min: 0, max: 4e9 })).message).toMatch(
      /^--n /,
    );
  });
});

describe('otherWords', () => {
  it('keeps every word but the command and the selection options, shell quoted', () => {
    expect(
      otherWords([
        '--profile',
        'dev',
        'advance',
        '--business-key',
        'DUP',
        '--var',
        'note=two words',
        '--latest',
        '--process-definition-key=order',
        '--wait',
      ]),
    ).toEqual(['--profile', 'dev', '--var', "'note=two words'", '--wait']);
    expect(otherWords(['wait', '--business-key=B', '--until', 'ended'])).toEqual([
      '--until',
      'ended',
    ]);
    expect(otherWords([])).toEqual([]);
  });

  it('leaves out the process instance id, but not an option value that only looks like it', () => {
    expect(otherWords(['advance', 'p1', '--var', 'a=1'], 'p1')).toEqual(['--var', 'a=1']);
    expect(otherWords(['--profile', 'p1', 'advance', '--wait', 'p1'], 'p1')).toEqual([
      '--profile',
      'p1',
      '--wait',
    ]);
  });

  it('puts them into the selection only when there are any', () => {
    expect(selectionOf({ flags: {}, args: [] }, ['inspect', '--business-key', 'B'])).toEqual({
      latest: false,
    });
    expect(
      selectionOf({ flags: { 'business-key': 'B' }, args: [] }, ['inspect', '--history']),
    ).toEqual({ businessKey: 'B', latest: false, options: ['--history'] });
  });
});

describe('selectionOf and waitSettings', () => {
  it('reads --latest only when given', () => {
    expect(selectionOf({ flags: { latest: true }, args: [] })).toEqual({ latest: true });
    expect(selectionOf({ flags: {}, args: ['p1'] })).toEqual({ id: 'p1', latest: false });
  });

  it('fails fast on incidents unless --no-fail-on-incident, executes jobs only with the flag', () => {
    expect(waitSettings({})).toEqual({
      conditions: [{ kind: 'idle' }],
      timeoutMs: 60_000,
      failOnIncident: true,
      executeJobs: false,
    });
    expect(waitSettings({ 'fail-on-incident': false, 'execute-jobs': true })).toMatchObject({
      failOnIncident: false,
      executeJobs: true,
    });
  });
});
