import { describe, expect, it } from 'vitest';
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from '../../../test/support/fake-runtime.js';
import { findOperation, loadCatalog } from '../../catalog/catalog.js';
import type { OperationSpec } from '../../catalog/types.js';
import { describeOperation, renderDescribeText } from '../../docs/describe.js';
import type { Display } from '../display.js';
import { run } from '../run.js';
import { describeTarget, describeText } from './describe.js';

const catalog = loadCatalog();

function operation(group: string, name: string): OperationSpec {
  const found = findOperation(catalog, group, name);
  if (found === undefined) throw new Error(`no operation ${group} ${name}`);
  return found;
}

const START = operation('process-definition', 'start');
const START_VIEW = describeOperation(START, catalog);

function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime(options));
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error;
}

describe('operate describe <group> <command>', () => {
  it('prints the describe view as JSON when piped', async () => {
    const result = await cli(['describe', 'process-definition', 'start']);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toBe(`${JSON.stringify(START_VIEW)}\n`);
    expect(START_VIEW.command).toBe('operate process-definition start <key>');
  });

  it('finds the command by an alias', async () => {
    const result = await cli(['describe', 'process-definition', 'start-process-instance-by-key']);
    expect(result.stdout).toBe(`${JSON.stringify(START_VIEW)}\n`);
  });

  it('prints readable text with -o table and on a terminal', async () => {
    const table = await cli(['describe', 'process-definition', 'start', '-o', 'table']);
    expect(table.stdout).toBe(renderDescribeText(START_VIEW));
    expect(table.stdout).toMatch(
      /^USAGE\n {2}operate process-definition start <key> \[options\]\n/,
    );
    const terminal = await cli(['describe', 'process-definition', 'start'], { stdoutTTY: true });
    expect(terminal.stdout).toBe(table.stdout);
  });

  it('indents JSON with --pretty and projects it with --fields', async () => {
    const pretty = await cli(['describe', 'task', 'claim', '--pretty']);
    const claim = describeOperation(operation('task', 'claim'), catalog);
    expect(pretty.stdout).toBe(`${JSON.stringify(claim, null, 2)}\n`);
    const fields = await cli(['describe', 'task', 'claim', '--fields', 'operationId,effect']);
    expect(fields.stdout).toBe('{"operationId":"claim","effect":"write"}\n');
  });

  it('prints the --fields as a table with -o table', async () => {
    const result = await cli([
      'describe',
      'task',
      'claim',
      '-o',
      'table',
      '--fields',
      'method,path',
    ]);
    expect(result.stdout).toBe('FIELD   VALUE\nmethod  POST\npath    /task/{id}/claim\n');
  });
});

describe('operate describe <operationId>', () => {
  it('describes the operation of an operationId, in any case', async () => {
    const result = await cli(['describe', 'startProcessInstanceByKey']);
    expect(result.stdout).toBe(`${JSON.stringify(START_VIEW)}\n`);
    const lower = await cli(['describe', 'STARTPROCESSINSTANCEBYKEY', '-o', 'table']);
    expect(lower.stdout).toBe(renderDescribeText(START_VIEW));
  });

  it('accepts the global options before the command', async () => {
    const result = await cli(['-o', 'table', 'describe', 'startProcessInstanceByKey']);
    expect(result.stdout).toBe(renderDescribeText(START_VIEW));
  });
});

describe('operate describe <group>', () => {
  it('prints the same as operate commands <group>', async () => {
    for (const options of [{}, { stdoutTTY: true }]) {
      const described = await cli(['describe', 'task'], options);
      const listed = await cli(['commands', 'task'], options);
      expect(described).toMatchObject({ code: 0, stderr: '', stdout: listed.stdout });
    }
  });
});

describe('operate describe: errors', () => {
  it('suggests the command for a misspelled command of a group', async () => {
    const result = await cli(['describe', 'task', 'lsit']);
    expect(result).toMatchObject({ code: 2, stdout: '' });
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'Unknown command "task lsit"',
      hint: 'Did you mean task list? Run "operate commands task" for the commands of the group, or search all commands with "operate commands --search lsit".',
    });
  });

  it('suggests the command for a misspelled group', async () => {
    const result = await cli(['describe', 'tsk', 'list']);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'Unknown command "tsk list"',
      hint: 'Did you mean task list? Run "operate commands" for the groups, or search all commands with "operate commands --search list".',
    });
  });

  it('suggests operationIds and groups for an unknown single word', async () => {
    const result = await cli(['describe', 'startProcessInstanceByKy']);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'Unknown group or operationId "startProcessInstanceByKy"',
      hint: 'Did you mean startProcessInstanceByKey? Run "operate commands" for the groups, or search all commands with "operate commands --search startProcessInstanceByKy".',
    });
  });

  it('suggests search matches within the group when nothing is close', async () => {
    const result = await cli(['describe', 'external-task', 'retries', '-o', 'table']);
    expect(result.stderr).toBe(
      [
        'Error: Unknown command "external-task retries"',
        '  Hint: Did you mean one of external-task set-retries, external-task set-retries-async, external-task set-retries-bulk? Run "operate commands external-task" for the commands of the group, or search all commands with "operate commands --search retries".',
        '',
      ].join('\n'),
    );
  });

  it('gives only the hints when nothing matches', async () => {
    const result = await cli(['describe', 'zzzz']);
    expect(errorOf(result.stderr)).toMatchObject({
      hint: 'Run "operate commands" for the groups, or search all commands with "operate commands --search zzzz".',
    });
  });

  it('requires a group or operationId and takes at most two words', async () => {
    const missing = await cli(['describe']);
    expect(errorOf(missing.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: "Missing required argument 'group'",
      hint: 'Run "operate describe --help" for the usage.',
    });
    const excess = await cli(['describe', 'task', 'claim', 'extra']);
    expect(errorOf(excess.stderr)).toMatchObject({
      message:
        "Too many arguments for 'describe'. Expected 2 arguments but got 3: task, claim, extra.",
    });
  });
});

describe('describeTarget', () => {
  it('prefers a group over an operationId for a single word', () => {
    expect(describeTarget(catalog, 'task', undefined)).toEqual({ kind: 'group', group: 'task' });
    expect(describeTarget(catalog, 'claim', undefined)).toEqual({
      kind: 'operation',
      operation: operation('task', 'claim'),
    });
  });

  it('takes the base operation for the operationId of a preset', () => {
    expect(describeTarget(catalog, 'updateSuspensionStateById', undefined)).toEqual({
      kind: 'operation',
      operation: operation('process-instance', 'update-suspension-state-by-id'),
    });
  });

  it('does not take an operationId as group', () => {
    expect(() => describeTarget(catalog, 'claim', 'claim')).toThrow(
      'Unknown command "claim claim"',
    );
  });
});

describe('describeText', () => {
  const display: Display = { format: 'table', pretty: false, maxWidth: 120, fields: undefined };

  it('renders text for tables, JSON otherwise', () => {
    expect(describeText(START_VIEW, display)).toBe(renderDescribeText(START_VIEW));
    expect(describeText(START_VIEW, { ...display, format: 'json' })).toBe(
      `${JSON.stringify(START_VIEW)}\n`,
    );
    expect(describeText(START_VIEW, { ...display, fields: ['effect'] })).toBe(
      'FIELD   VALUE\neffect  write\n',
    );
  });
});
