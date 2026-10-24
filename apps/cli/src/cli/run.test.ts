import { describe, expect, it } from 'vitest';
import { fakeServer, json } from '../../test/support/fake-fetch.js';
import { execute, fakeRuntime, type FakeRuntimeOptions } from '../../test/support/fake-runtime.js';
import { VERSION } from '../version.js';
import { run } from './run.js';

function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime(options));
}

function errorOf(stderr: string): Record<string, unknown> {
  const parsed = JSON.parse(stderr) as { error: Record<string, unknown> };
  return parsed.error;
}

describe('run: usage errors', () => {
  it('reports an unknown group with a suggestion and the search hint', async () => {
    const result = await cli(['tsk', 'list']);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      `${JSON.stringify({
        error: {
          code: 'USAGE',
          exitCode: 2,
          message: 'Unknown command "tsk"',
          hint: 'Did you mean task? Run "operate --help" for the commands, or search all commands with "operate commands --search tsk".',
        },
      })}\n`,
    );
  });

  it('reports an unknown command of a group with a suggestion', async () => {
    const result = await cli(['task', 'lsit']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'Unknown command "lsit"',
      hint: 'Did you mean list? Run "operate task --help" for the commands, or search all commands with "operate commands --search lsit".',
    });
  });

  it('reports an unknown option with the command path in the hint', async () => {
    const result = await cli(['task', 'list', '--assigne', 'demo']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'Unknown option "--assigne"',
      hint: 'Did you mean one of --assignee, --assigned? Run "operate task list --help" for the usage.',
    });
  });

  it('reports a missing argument', async () => {
    const result = await cli(['task', 'claim']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: "Missing required argument 'id'",
      hint: 'Run "operate task claim --help" for the usage.',
    });
  });

  it('reports excess arguments', async () => {
    const result = await cli(['task', 'claim', 'a', 'b']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'USAGE',
      message: "Too many arguments for 'claim'. Expected 1 argument but got 2: a, b.",
    });
  });

  it('reports a missing option value', async () => {
    const result = await cli(['task', 'list', '--assignee']);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'USAGE',
      message: "Option '--assignee <value>' argument missing",
    });
  });

  it('renders usage errors as text when stdout is a terminal', async () => {
    const result = await cli(['task', 'lsit'], { stdoutTTY: true });
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      [
        'Error: Unknown command "lsit"',
        '  Hint: Did you mean list? Run "operate task --help" for the commands, or search all commands with "operate commands --search lsit".',
        '',
      ].join('\n'),
    );
  });

  it('takes the error format from -o in argv, then OPERATE_OUTPUT', async () => {
    const fromArgv = await cli(['task', 'lsit', '-o', 'table'], {
      env: { OPERATE_OUTPUT: 'json' },
    });
    expect(fromArgv.stderr).toMatch(/^Error: Unknown command "lsit"/);
    const fromEnv = await cli(['task', 'lsit'], { env: { OPERATE_OUTPUT: 'table' } });
    expect(fromEnv.stderr).toMatch(/^Error: /);
  });

  it('adds the stack with --verbose', async () => {
    const result = await cli(['task', 'lsit', '--verbose']);
    expect(errorOf(result.stderr).stack).toEqual(expect.stringContaining('OperateError'));
  });
});

describe('run: help and version', () => {
  it('prints the version', async () => {
    for (const flag of ['-V', '--version']) {
      const result = await cli([flag]);
      expect(result).toMatchObject({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
    }
  });

  it('prints the root help without arguments, with --help and with the help command', async () => {
    const plain = await cli([]);
    expect(plain.code).toBe(0);
    expect(plain.stderr).toBe('');
    expect(plain.stdout).toMatch(
      /^Usage: operate \[options\] \[command\]\n\nAI-first command line/,
    );
    expect(plain.stdout).toContain('\nAPI groups:\n  authorization ');
    expect(plain.stdout).toMatch(/\n {2}ping +Check the connection to the engine\n/);
    expect(plain.stdout).toMatch(/\n {2}config \[command\] +Manage the config file/);
    expect(plain.stdout).toContain('  help [command]  ');
    expect(plain.stdout).toContain('\nGet started:\n  operate ping ');
    expect(plain.stdout).toMatch(
      /\nExit codes:\n {2}0 {2}success\n(?:.*\n)* {2}9 {2}the process did not reach the expected state .*\n {5}INSTANCE_ENDED, JOB_FAILED, CHECK_FAILED\)\n$/,
    );
    for (const args of [['--help'], ['-h'], ['help']]) {
      const result = await cli(args);
      expect(result).toMatchObject({ code: 0, stdout: plain.stdout, stderr: '' });
    }
  });

  it('lists the utility commands under "Commands:", then the groups alphabetically', async () => {
    const { stdout } = await cli(['--help']);
    const headings = stdout.split('\n').filter((line) => /^[A-Z][\w ]*:$/.test(line));
    expect(headings).toEqual([
      'Get started:',
      'Options:',
      'Commands:',
      'Workflow commands:',
      'API groups:',
      'Exit codes:',
    ]);
    const section = (heading: string) =>
      stdout
        .split(`\n${heading}\n`)[1]
        ?.split('\n\n')[0]
        ?.split('\n')
        .map((line) => line.trim().split(' ')[0]);
    expect(section('Commands:')).toEqual([
      'commands',
      'describe',
      'guide',
      'api',
      'ping',
      'config',
      'auth',
      'completion',
      'help',
    ]);
    expect(section('Workflow commands:')).toEqual([
      'inspect',
      'wait',
      'advance',
      'retry',
      'deploy',
      'status',
    ]);
    const groups = section('API groups:');
    expect(groups).toHaveLength(52);
    expect(groups).toEqual(groups?.toSorted());
  });

  it('prints the group help for a group without command, to stdout with exit code 0', async () => {
    const result = await cli(['task']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^Usage: operate task \[options\] \[command\]\n\nQuery, claim/);
    expect(result.stdout).toMatch(/\n {2}claim <id> +Claim a task for a user\n/);
    // aliases only in the help of the command itself
    expect(result.stdout).toMatch(/\n {2}list +List tasks\n/);
    expect(result.stdout).not.toContain('get-tasks');
    expect(result.stdout).toContain('Run "operate <group> <command> --help"');
    for (const args of [
      ['task', '--help'],
      ['help', 'task'],
      ['-o', 'json', 'help', 'task'],
    ]) {
      const other = await cli(args);
      expect(other).toMatchObject({ code: 0, stdout: result.stdout });
    }
  });

  it('prints the help of an operation with arguments, options and global options', async () => {
    const result = await cli(['task', 'claim', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /^Usage: operate task claim <id> \[options\]\n\nClaim a task for a user\n\nPOST \/task\/\{id\}\/claim\nEffect: write\n\nArguments:\n {2}id +The id of the task to claim\.\n\nOptions:\n {2}--user-id <value> +/,
    );
    expect(result.stdout).toContain('\nGlobal Options:\n  --url <url> ');
    expect(result.stdout).toMatch(/\n {2}-o, --output <format> +json or table/);
    expect(result.stdout).toMatch(
      /\n {2}-h, --help +Display help for command\n\nExamples:\n {2}\$ operate task claim 7c1d9e20-0f4a-11ef-a1b2-0242ac120002 --user-id demo\n$/,
    );
    const viaHelp = await cli(['task', 'help', 'claim']);
    expect(viaHelp.stdout).toBe(result.stdout);
  });

  it('shows boolean options as --[no-]x, presence flags and the effect guard', async () => {
    const result = await cli(['process-instance', 'delete', '--help'], { columns: 200 });
    expect(result.stdout).toContain(
      'Effect: delete (requires --yes)\nAliases: delete-process-instance\n',
    );
    expect(result.stdout).toMatch(/\n {2}--\[no-\]skip-custom-listeners +/);
    expect(result.stdout).not.toContain('--no-skip-custom-listeners');
    const jobs = await cli(['job', 'list', '--help']);
    expect(jobs.stdout).toMatch(/\n {2}--no-retries-left +Only select jobs which have no retries/);
    expect(jobs.stdout).toMatch(/\n {2}--all +Fetch all pages/);
  });

  it('ends the help of every operation with its examples', async () => {
    const curated = await cli(['process-definition', 'start', '--help']);
    expect(curated.stdout).toContain(
      [
        '',
        'Examples:',
        '  $ operate process-definition start invoice --business-key INV-1001 --var amount=250 --var approved=false',
        '  $ operate process-definition start invoice --var invoiceDate:Date=2024-05-01 --var zip:String=01234',
        '  $ operate process-definition start invoice --body @start.json --business-key INV-1002',
        '',
      ].join('\n'),
    );
    const generic = await cli(['task-identity-link', 'add', '--help']);
    expect(generic.stdout).toMatch(
      /\n\nExamples:\n {2}\$ operate task-identity-link add my-id --type my-type\n$/,
    );
  });

  it('lists enum choices and required options in the option help', async () => {
    const result = await cli(['process-instance', 'list', '--help']);
    expect(result.stdout).toMatch(/--sort-order <value> +.*\(choices: asc, desc\)/s);
  });

  it('wraps the help to the terminal width; examples stay on one line', async () => {
    const narrow = await cli(['task', 'claim', '--help'], { stdoutTTY: true, columns: 70 });
    const wide = await cli(['task', 'claim', '--help'], { stdoutTTY: true, columns: 200 });
    const [help = '', examples] = narrow.stdout.split('\nExamples:\n');
    expect(Math.max(...help.split('\n').map((line) => line.length))).toBeLessThanOrEqual(70);
    expect(examples).toBe(
      '  $ operate task claim 7c1d9e20-0f4a-11ef-a1b2-0242ac120002 --user-id demo\n',
    );
    expect(wide.stdout).toContain(
      '--url <url>            REST API root, e.g. http://localhost:8080/engine-rest (env OPERATE_URL)\n',
    );
  });
});

describe('run: global options', () => {
  const tasks = [{ id: 't1', name: 'Approve' }];

  it('accepts global options after the command path', async () => {
    const server = fakeServer().on('GET', '/task', json(tasks));
    const result = await cli(['task', 'list', '-o', 'json', '--pretty'], { fetch: server.fetch });
    expect(result).toMatchObject({ code: 0, stdout: `${JSON.stringify(tasks, null, 2)}\n` });
  });

  it('accepts global options before the group', async () => {
    const server = fakeServer().on('GET', '/task', json(tasks));
    const result = await cli(['--pretty', '-o', 'json', '--fields=id', 'task', 'list'], {
      fetch: server.fetch,
    });
    expect(result).toMatchObject({ code: 0, stdout: '[\n  {\n    "id": "t1"\n  }\n]\n' });
  });

  it('accepts global options before nested utility commands', async () => {
    const result = await cli(['-ojson', 'config', 'path'], { env: { OPERATE_CONFIG: '/c.json' } });
    expect(result).toMatchObject({ code: 0, stdout: '{"path":"/c.json"}\n' });
  });

  it('keeps leading options without a command for commander to report', async () => {
    const result = await cli(['--url', 'http://x']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toMatchObject({ message: 'Unknown option "--url"' });
  });

  it('passes operation flags named like root options to the operation', async () => {
    // -V/--version of the root only count before the command path
    for (const args of [
      ['process-definition', 'list', '--version', '3', '--dry-run'],
      ['process-definition', 'list', '--dry-run', '--version', '3'],
      ['--dry-run', 'process-definition', 'list', '--version', '3'],
    ]) {
      const result = await cli(args);
      expect(result.code, result.stderr).toBe(0);
      const preview = JSON.parse(result.stdout) as { method: string; url: string };
      expect(preview.method).toBe('GET');
      expect(new URL(preview.url).searchParams.get('version')).toBe('3');
    }
    const root = await cli(['--version']);
    expect(root.stdout).toBe(`${VERSION}\n`);
  });
});
