import { describe, expect, it } from 'vitest';
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from '../../../test/support/fake-runtime.js';
import { loadCatalog } from '../../catalog/catalog.js';
import {
  type CommandSummary,
  discoveryGroups,
  findCommands,
  listCommands,
} from '../../docs/commands.js';
import { OperateError } from '../../errors.js';
import type { Display } from '../display.js';
import { run } from '../run.js';
import { EFFECTS } from '../../catalog/types.js';
import { commandsText, groupsText, requireGroup } from './commands.js';

const catalog = loadCatalog();

function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime(options));
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error;
}

const TABLE: Display = { format: 'table', pretty: false, maxWidth: 120, fields: undefined };

function summary(overrides: Partial<CommandSummary>): CommandSummary {
  return {
    command: 'thing get',
    aliases: [],
    operationId: 'getThing',
    method: 'GET',
    path: '/thing/{id}',
    effect: 'read',
    summary: 'Get',
    deprecated: false,
    ...overrides,
  };
}

describe('operate commands: groups', () => {
  it('prints every group with description and number of commands as JSON when piped', async () => {
    const result = await cli(['commands']);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toBe(`${JSON.stringify(discoveryGroups(catalog))}\n`);
    expect(JSON.parse(result.stdout)).toContainEqual({
      group: 'workflow',
      description:
        'Top-level commands that combine several requests (operate <command>): inspect, wait, advance, retry, deploy, status',
      commands: 6,
    });
  });

  it('indents the JSON with --pretty', async () => {
    const result = await cli(['commands', '--pretty']);
    expect(result.stdout).toBe(`${JSON.stringify(discoveryGroups(catalog), null, 2)}\n`);
  });

  it('prints a GROUP COMMANDS DESCRIPTION table on a terminal, within its width', async () => {
    const result = await cli(['commands'], { stdoutTTY: true, columns: 100 });
    const lines = result.stdout.split('\n');
    expect(lines[0]).toBe(`${'GROUP'.padEnd(41)}  COMMANDS  DESCRIPTION`);
    expect(lines[1]).toBe(
      `${'authorization'.padEnd(41)}  7         Manage authorizations (permissions of users an…`,
    );
    expect(lines).toHaveLength(55);
    expect(lines.at(-2)).toMatch(/^workflow +6 +Top-level commands that combine/);
    expect(Math.max(...lines.map((line) => line.length))).toBe(100);
  });

  it('never truncates the group names, dropping the other columns on narrow terminals', async () => {
    const result = await cli(['commands'], { stdoutTTY: true, columns: 45 });
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('GROUP');
    expect(lines).toContain('historic-decision-requirements-definition');
  });

  it('projects the JSON with --fields', async () => {
    const result = await cli(['commands', '--fields', 'group']);
    expect(JSON.parse(result.stdout)).toEqual(
      discoveryGroups(catalog).map((group) => ({ group: group.group })),
    );
  });

  it('accepts the global options before the command', async () => {
    const result = await cli(['-o', 'table', 'commands']);
    expect(result.stdout).toMatch(/^GROUP {38}COMMANDS {2}DESCRIPTION\n/);
  });
});

describe('operate commands: commands', () => {
  it('prints the commands of a group', async () => {
    const result = await cli(['commands', 'task']);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toBe(`${JSON.stringify(listCommands(catalog, { group: 'task' }))}\n`);
  });

  it('prints a COMMAND EFFECT SUMMARY table, deprecated commands marked', async () => {
    const result = await cli(['commands', 'telemetry', '-o', 'table']);
    expect(result.stdout).toBe(
      [
        'COMMAND                      EFFECT  SUMMARY',
        'telemetry configure          write   [deprecated] Configure Telemetry',
        'telemetry get-configuration  read    Fetch Telemetry Configuration',
        'telemetry get-data           read    [deprecated] Fetch Telemetry Data',
        '',
      ].join('\n'),
    );
  });

  it('searches all groups', async () => {
    const result = await cli(['commands', '--search', 'CLAIM', '-o', 'table']);
    expect(result.stdout).toBe(
      'COMMAND       EFFECT  SUMMARY\ntask claim    write   Claim a task for a user\ntask unclaim  write   Unclaim a task\n',
    );
  });

  it('filters by effect alone, with a search or within a group', async () => {
    const bulk = await cli(['commands', '--effect', 'bulk']);
    expect(bulk.stdout).toBe(`${JSON.stringify(findCommands(catalog, { effect: 'bulk' }))}\n`);
    const parsed = JSON.parse(bulk.stdout) as CommandSummary[];
    expect(parsed.length).toBeGreaterThan(10);
    expect(parsed.every((command) => command.effect === 'bulk')).toBe(true);
    const incident = await cli(['commands', '--search', 'incident', '--effect', 'write']);
    expect(incident.stdout).toBe(
      `${JSON.stringify(findCommands(catalog, { search: 'incident', effect: 'write' }))}\n`,
    );
    expect((JSON.parse(incident.stdout) as { command: string }[])[0]?.command).toBe('retry');
    const task = await cli(['commands', 'task', '--effect', 'delete', '--fields', 'command']);
    expect(task.stdout).toBe('[{"command":"task delete"}]\n');
  });

  it('reports no matches as an empty list or "No results."', async () => {
    expect((await cli(['commands', '--search', 'no such text'])).stdout).toBe('[]\n');
    const table = await cli(['commands', '--search', 'no such text'], { stdoutTTY: true });
    expect(table.stdout).toBe('No results.\n');
  });

  it('never truncates the command names, only the summaries', async () => {
    const longest = 'process-definition update-history-time-to-live-by-key-and-tenant-id';
    const result = await cli(['commands', 'process-definition'], { stdoutTTY: true, columns: 90 });
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines.find((line) => line.startsWith(longest))).toBe(
      `${longest}  write   Update Histo…`,
    );
    expect(Math.max(...lines.map((line) => line.length))).toBe(90);
    const narrow = await cli(['commands', 'process-definition'], { stdoutTTY: true, columns: 60 });
    expect(narrow.stdout).toContain(`\n${longest}\n`);
  });

  it('uses the --fields as table columns', async () => {
    const result = await cli([
      'commands',
      'task',
      '--search',
      'claim',
      '-o',
      'table',
      '--fields',
      'operationId,method',
    ]);
    expect(result.stdout).toBe('operationId  method\nclaim        POST\nunclaim      POST\n');
  });
});

describe('operate commands: errors', () => {
  it('reports an unknown group with suggestions', async () => {
    const result = await cli(['commands', 'tsk']);
    expect(result).toMatchObject({ code: 2, stdout: '' });
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'Unknown group "tsk"',
      hint: 'Did you mean task? Run "operate commands" for the groups, or search all commands with "operate commands --search tsk".',
    });
  });

  it('reports an unknown effect with the choices', async () => {
    const result = await cli(['commands', '--effect', 'remove']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message:
        "Option '--effect <effect>' argument 'remove' is invalid. Allowed choices are read, write, delete, bulk.",
      hint: 'Run "operate commands --help" for the usage.',
    });
  });

  it('reports an unknown output format as configuration error', async () => {
    const result = await cli(['commands', '-o', 'yaml']);
    expect(result.code).toBe(3);
    expect(errorOf(result.stderr)).toMatchObject({ message: 'Unknown output format "yaml"' });
  });

  it('renders errors in the requested format', async () => {
    const result = await cli(['commands', 'tsk', '-o', 'table']);
    expect(result.stderr).toMatch(/^Error: Unknown group "tsk"\n {2}Hint: Did you mean task\? /);
  });

  it('rejects more than one group', async () => {
    const result = await cli(['commands', 'task', 'job']);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'USAGE',
      message: "Too many arguments for 'commands'. Expected 1 argument but got 2: task, job.",
    });
  });
});

describe('commands helpers', () => {
  it('lists the effects of the catalog', () => {
    expect(EFFECTS).toEqual(['read', 'write', 'delete', 'bulk']);
    expect(new Set(catalog.operations.map((operation) => operation.effect))).toEqual(
      new Set(EFFECTS),
    );
  });

  it('shows method and path for commands without summary', () => {
    expect(commandsText([summary({ summary: '' })], TABLE)).toBe(
      'COMMAND    EFFECT  SUMMARY\nthing get  read    GET /thing/{id}\n',
    );
    expect(commandsText([summary({ summary: '', deprecated: true })], TABLE)).toBe(
      'COMMAND    EFFECT  SUMMARY\nthing get  read    [deprecated] GET /thing/{id}\n',
    );
  });

  it('renders JSON as given, without table columns', () => {
    const json: Display = { ...TABLE, format: 'json' };
    expect(commandsText([summary({})], json)).toBe(`${JSON.stringify([summary({})])}\n`);
    expect(groupsText([{ group: 'g', description: 'd', commands: 1 }], json)).toBe(
      '[{"group":"g","description":"d","commands":1}]\n',
    );
  });

  it('accepts known groups', () => {
    expect(() => {
      requireGroup(catalog, 'task');
    }).not.toThrow();
    expect(() => {
      requireGroup(catalog, 'Task');
    }).toThrow(OperateError);
  });
});
