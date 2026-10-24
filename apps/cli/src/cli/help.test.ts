import { Command, Option } from 'commander';
import { describe, expect, it } from 'vitest';
import { fakeRuntime } from '../../test/support/fake-runtime.js';
import { EXIT_CODES } from '../errors.js';
import {
  commandPath,
  examplesText,
  exitCodeLines,
  helpConfiguration,
  outputConfiguration,
  ROOT_DESCRIPTION,
  rootFooter,
  setHelpTerm,
} from './help.js';

describe('commandPath', () => {
  it('joins the names from the root', () => {
    const root = new Command('operate');
    const group = root.command('task');
    const leaf = group.command('list');
    expect(commandPath(root)).toBe('operate');
    expect(commandPath(leaf)).toBe('operate task list');
  });
});

describe('helpConfiguration', () => {
  it('shows registered help terms instead of the flags', () => {
    const command = new Command('x').configureHelp(helpConfiguration());
    const plain = new Option('--plain', 'Plain.');
    const termed = new Option('--skip', 'Skip.');
    setHelpTerm(termed, '--[no-]skip');
    command.addOption(plain).addOption(termed);
    const help = command.helpInformation();
    expect(help).toContain('\n  --plain      Plain.\n  --[no-]skip  Skip.\n');
  });

  it('builds the usage line from the command path and the usage without aliases', () => {
    const root = new Command('operate').configureHelp(helpConfiguration());
    const leaf = root.command('task').command('list').alias('get-tasks').usage('[options]');
    expect(leaf.createHelp().commandUsage(leaf)).toBe('operate task list [options]');
    const bare = root.command('bare').helpOption(false);
    expect(bare.createHelp().commandUsage(bare)).toBe('operate bare');
  });
});

describe('outputConfiguration', () => {
  it('writes help to stdout, never errors, without colors', () => {
    const runtime = fakeRuntime();
    const output = outputConfiguration(runtime);
    output.writeOut?.('out ');
    output.writeErr?.('err');
    output.outputError?.('error: x', () => {
      throw new Error('must not be called');
    });
    expect(runtime.stdout.text()).toBe('out err');
    expect(runtime.stderr.text()).toBe('');
    expect(output.getOutHasColors?.()).toBe(false);
    expect(output.getErrHasColors?.()).toBe(false);
  });

  it('uses the terminal width, else 80 columns', () => {
    expect(outputConfiguration(fakeRuntime()).getOutHelpWidth?.()).toBe(80);
    const tty = outputConfiguration(fakeRuntime({ stdoutTTY: true, columns: 132 }));
    expect(tty.getOutHelpWidth?.()).toBe(132);
    expect(tty.getErrHelpWidth?.()).toBe(132);
    expect(outputConfiguration(fakeRuntime({ stdoutTTY: true })).getOutHelpWidth?.()).toBe(80);
  });
});

describe('examples', () => {
  it('renders an Examples section after a blank line, nothing without examples', () => {
    expect(examplesText([])).toBe('');
    expect(examplesText(['operate task list', 'operate task get t1'])).toBe(
      '\nExamples:\n  $ operate task list\n  $ operate task get t1',
    );
  });
});

describe('root help texts', () => {
  it('ends the root description with the commands to start with', () => {
    expect(ROOT_DESCRIPTION.split('\n').slice(1)).toEqual([
      '',
      'The REST API root defaults to http://localhost:8080/engine-rest; set it with --url, OPERATE_URL or a profile (operate config set).',
      '',
      'Basic auth: --auth-user <name> with the password piped into --auth-password-stdin, OPERATE_USERNAME and OPERATE_PASSWORD, or a profile (operate config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>).',
      '',
      'OAuth: a person runs "operate auth login --profile <name>" once in a terminal; commands then refresh the token on their own.',
      '',
      'Bearer token from elsewhere (SSO tooling, a CI secret): OPERATE_TOKEN, --auth-token-stdin or a profile (operate config set <profile> --auth bearer --auth-token-env <VAR>); OPERATE_TOKEN_COMMAND names a command that prints one (operate guide auth).',
      '',
      'Get started:',
      '  operate ping                        check the connection to the engine',
      '  operate commands                    list the API groups',
      '  operate commands --search <text>    find a command',
      '  operate describe <group> <command>  options, body, responses, examples',
      '  operate inspect <id>                where an instance waits and why',
      '  operate status                      incidents, jobs and workers at a glance',
      '  operate guide                       usage guide for agents (markdown)',
    ]);
  });

  it('introduces operate and the first commands to run', () => {
    expect(ROOT_DESCRIPTION).toMatch(/^AI-first command line interface for the Camunda 7 REST API/);
    for (const start of ['operate ping', 'operate commands', 'operate describe', 'operate guide']) {
      expect(ROOT_DESCRIPTION).toContain(`\n  ${start} `);
    }
    expect(ROOT_DESCRIPTION).toContain('http://localhost:8080/engine-rest');
  });

  it('lists every exit code once, in order, with its meaning', () => {
    const lines = exitCodeLines();
    const entries = lines.filter((line) => /^ {2}\d/.test(line));
    expect(entries.map((line) => Number(line.trim().split(' ')[0]))).toEqual(
      Object.values(EXIT_CODES).toSorted((left, right) => left - right),
    );
    expect(lines).toEqual([
      '  0  success',
      '  1  internal error',
      '  2  usage error, invalid body (VALIDATION), READ_ONLY, CONFIRMATION_REQUIRED',
      '  3  configuration error, or an HTTP redirect (wrong --url)',
      '  4  not authenticated or authorized (401, 403), LOGIN_REQUIRED, LOGIN_FAILED,',
      '     TOKEN_EXPIRED',
      '  5  not found (404)',
      '  6  other 4xx: the engine rejected the request',
      '  7  engine error (5xx)',
      '  8  network error or timeout',
      '  9  the process did not reach the expected state (WAIT_TIMEOUT, INCIDENT,',
      '     INSTANCE_ENDED, JOB_FAILED, CHECK_FAILED)',
    ]);
  });

  it('ends the root help with the next steps and the exit codes', () => {
    expect(rootFooter()).toBe(
      [
        '',
        'Run "operate <group> --help" for the commands of a group and',
        '"operate <group> <command> --help" for the options of a command.',
        '',
        'Exit codes:',
        ...exitCodeLines(),
      ].join('\n'),
    );
  });

  it('keeps the root help texts within 80 columns', () => {
    const lines = [...ROOT_DESCRIPTION.split('\n').slice(10), ...rootFooter().split('\n')];
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(80);
  });
});
