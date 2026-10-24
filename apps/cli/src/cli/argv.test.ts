import { describe, expect, it } from 'vitest';
import {
  addressedCommand,
  globalFromArgv,
  globalOptionLength,
  normalizeArgv,
  outputFromArgv,
  verboseRequested,
} from './argv.js';

const NESTED = new Set(['task', 'config']);
const normalize = (argv: readonly string[]) => normalizeArgv(argv, (name) => NESTED.has(name));

describe('globalOptionLength', () => {
  it('counts long options with and without values', () => {
    expect(globalOptionLength(['--url', 'x'], 0)).toBe(2);
    expect(globalOptionLength(['--url'], 0)).toBe(0);
    expect(globalOptionLength(['--url=x'], 0)).toBe(1);
    expect(globalOptionLength(['--url='], 0)).toBe(1);
    expect(globalOptionLength(['--pretty', 'x'], 0)).toBe(1);
    expect(globalOptionLength(['--pretty=x'], 0)).toBe(0);
    expect(globalOptionLength(['--nope', 'x'], 0)).toBe(0);
    expect(globalOptionLength(['--nope=x'], 0)).toBe(0);
  });

  it('counts short options and attached values', () => {
    expect(globalOptionLength(['-o', 'json'], 0)).toBe(2);
    expect(globalOptionLength(['-o'], 0)).toBe(0);
    expect(globalOptionLength(['-ojson'], 0)).toBe(1);
    expect(globalOptionLength(['-y', 'task'], 0)).toBe(1);
    expect(globalOptionLength(['-yo'], 0)).toBe(0);
    expect(globalOptionLength(['-xjson'], 0)).toBe(0);
    expect(globalOptionLength(['-x'], 0)).toBe(0);
    expect(globalOptionLength(['-1'], 0)).toBe(0);
    expect(globalOptionLength(['task'], 0)).toBe(0);
    expect(globalOptionLength(['-'], 0)).toBe(0);
  });

  it('looks at the token at the index', () => {
    expect(globalOptionLength(['task', '-H', 'A: 1'], 1)).toBe(2);
    expect(globalOptionLength(['task'], 1)).toBe(0);
  });
});

describe('normalizeArgv', () => {
  it('moves leading global options behind group and command', () => {
    expect(normalize(['-o', 'json', '--pretty', 'task', 'list', '--assignee', 'x'])).toEqual([
      'task',
      'list',
      '-o',
      'json',
      '--pretty',
      '--assignee',
      'x',
    ]);
    expect(normalize(['--url=u', 'config', 'set', 'p'])).toEqual(['config', 'set', '--url=u', 'p']);
  });

  it('moves them behind a command without subcommands', () => {
    expect(normalize(['-ojson', 'api', 'GET', '/x'])).toEqual(['api', '-ojson', 'GET', '/x']);
  });

  it('moves them behind a group that is followed by an option', () => {
    expect(normalize(['-y', 'task', '--help'])).toEqual(['task', '-y', '--help']);
    expect(normalize(['-y', 'task'])).toEqual(['task', '-y']);
  });

  it('leaves the list unchanged without leading globals or without a command', () => {
    expect(normalize(['task', 'list', '-o', 'json'])).toEqual(['task', 'list', '-o', 'json']);
    expect(normalize(['-o', 'json'])).toEqual(['-o', 'json']);
    expect(normalize(['-o', 'json', '--nope', 'task'])).toEqual(['-o', 'json', '--nope', 'task']);
    expect(normalize(['--url'])).toEqual(['--url']);
    expect(normalize([])).toEqual([]);
  });
});

describe('addressedCommand', () => {
  it('returns the first word, or the word after help', () => {
    expect(addressedCommand(['task', 'list'])).toBe('task');
    expect(addressedCommand(['help', 'job'])).toBe('job');
    expect(addressedCommand(['help'])).toBeUndefined();
    expect(addressedCommand([])).toBeUndefined();
  });
});

describe('outputFromArgv', () => {
  it('finds -o and --output in every spelling, the last one wins', () => {
    expect(outputFromArgv(['task', '-o', 'table'])).toBe('table');
    expect(outputFromArgv(['--output', 'json'])).toBe('json');
    expect(outputFromArgv(['--output=table'])).toBe('table');
    expect(outputFromArgv(['-otable'])).toBe('table');
    expect(outputFromArgv(['-o', 'table', '--output', 'json'])).toBe('json');
  });

  it('ignores invalid formats, missing values and everything after --', () => {
    expect(outputFromArgv(['-o', 'yaml'])).toBeUndefined();
    expect(outputFromArgv(['-o', 'json', '-o', 'yaml'])).toBeUndefined();
    expect(outputFromArgv(['-o'])).toBeUndefined();
    expect(outputFromArgv(['--', '-o', 'json'])).toBeUndefined();
    expect(outputFromArgv(['task', 'list'])).toBeUndefined();
    expect(outputFromArgv(['--other', 'json'])).toBeUndefined();
  });

  it('reads only -o on config set, whose --output is a profile value', () => {
    expect(outputFromArgv(['config', 'set', 'p', '--output', 'table'])).toBeUndefined();
    expect(outputFromArgv(['config', 'set', 'p', '--output=table'])).toBeUndefined();
    expect(outputFromArgv(['--output', 'table', 'config', 'set', 'p'])).toBeUndefined();
    expect(outputFromArgv(['config', 'set', 'p', '--output', 'table', '-o', 'json'])).toBe('json');
    expect(outputFromArgv(['-ojson', 'config', 'set', 'p', '--output', 'table'])).toBe('json');
    expect(outputFromArgv(['config', 'unset', 'p', 'url', '--output', 'table'])).toBe('table');
    expect(outputFromArgv(['config', '--output', 'table'])).toBe('table');
    expect(outputFromArgv(['set', '--output', 'table'])).toBe('table');
    expect(outputFromArgv(['task-variable', 'set', 't', 'v', '--output', 'table'])).toBe('table');
  });
});

describe('globalFromArgv', () => {
  it('reads options with a value only', () => {
    expect(globalFromArgv(['--config', '/c.json', '--profile=p'], 'config')).toBe('/c.json');
    expect(globalFromArgv(['--config', '/c.json', '--profile=p'], 'profile')).toBe('p');
    expect(globalFromArgv(['--pretty', 'x'], 'pretty')).toBeUndefined();
    expect(globalFromArgv(['--nope', 'x'], 'nope')).toBeUndefined();
  });

  it('ignores the long form when asked to', () => {
    expect(globalFromArgv(['--output', 'json'], 'output', true)).toBeUndefined();
    expect(globalFromArgv(['--output=json'], 'output', true)).toBeUndefined();
    expect(globalFromArgv(['-o', 'json', '--output', 'table'], 'output', true)).toBe('json');
    expect(globalFromArgv(['--url', 'u'], 'url', true)).toBeUndefined();
  });
});

describe('verboseRequested', () => {
  it('finds --verbose before --', () => {
    expect(verboseRequested(['task', '--verbose'])).toBe(true);
    expect(verboseRequested(['task', '--', '--verbose'])).toBe(false);
    expect(verboseRequested(['task'])).toBe(false);
  });
});
