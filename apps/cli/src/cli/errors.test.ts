import { Command, CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { CONFIG_PATH, fakeRuntime } from '../../test/support/fake-runtime.js';
import { OperateError } from '../errors.js';
import {
  CommandExit,
  commanderUsageError,
  errorFormat,
  exitHandler,
  isDisplayExit,
  reportError,
} from './errors.js';

function exitOf(command: Command, code: string, message: string): CommandExit {
  return new CommandExit(new CommanderError(1, code, message), command);
}

describe('exitHandler', () => {
  it('throws a CommandExit that names the command', () => {
    const command = new Command('task');
    const exit = new CommanderError(1, 'commander.unknownOption', "error: unknown option '--x'");
    let thrown: unknown;
    try {
      exitHandler(command)(exit);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommandExit);
    expect(thrown).toMatchObject({ name: 'CommandExit', exit, command, message: exit.message });
  });
});

describe('isDisplayExit', () => {
  it('is true for help and version exits only', () => {
    const command = new Command('x');
    for (const code of ['commander.help', 'commander.helpDisplayed', 'commander.version']) {
      expect(isDisplayExit(exitOf(command, code, ''))).toBe(true);
    }
    expect(isDisplayExit(exitOf(command, 'commander.unknownOption', ''))).toBe(false);
    expect(isDisplayExit(new CommanderError(0, 'commander.help', ''))).toBe(false);
  });
});

describe('commanderUsageError', () => {
  const root = new Command('operate');
  const group = new Command('task');
  root.addCommand(group);
  group.addCommand(new Command('list').alias('get-tasks'));
  group.addCommand(new Command('claim'));
  const list = group.commands[0]!;
  list.option('--assignee <value>').option('--assigned');

  it('strips the error prefix, capitalizes and points to the help of the command', () => {
    const error = commanderUsageError(
      exitOf(group, 'commander.missingArgument', "error: missing required argument 'id'"),
    );
    expect(error).toBeInstanceOf(OperateError);
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe("Missing required argument 'id'");
    expect(error.details.hint).toBe('Run "operate task --help" for the usage.');
  });

  it('reports unknown commands with the suggestion in the hint, plus the command search', () => {
    group.args = ['lsit'];
    const error = commanderUsageError(
      exitOf(
        group,
        'commander.unknownCommand',
        "error: unknown command 'lsit'\n(Did you mean list?)",
      ),
    );
    expect(error.message).toBe('Unknown command "lsit"');
    expect(error.details.hint).toBe(
      'Did you mean list? Run "operate task --help" for the commands, or search all commands with "operate commands --search lsit".',
    );
    group.args = ['get-taks'];
    expect(
      commanderUsageError(
        exitOf(group, 'commander.unknownCommand', "error: unknown command 'get-taks'"),
      ).details.hint,
    ).toMatch(/^Did you mean get-tasks\? /);
    group.args = [];
    const odd = commanderUsageError(exitOf(group, 'commander.unknownCommand', 'error: x'));
    expect(odd.message).toBe('Unknown command ""');
    expect(odd.details.hint).toContain('"operate commands --search ".');
  });

  it('reports unknown options with the close long flags in the hint', () => {
    const error = commanderUsageError(
      exitOf(list, 'commander.unknownOption', "error: unknown option '--assigne'"),
    );
    expect(error.message).toBe('Unknown option "--assigne"');
    expect(error.details.hint).toBe(
      'Did you mean one of --assignee, --assigned? Run "operate task list --help" for the usage.',
    );
    const far = commanderUsageError(
      exitOf(list, 'commander.unknownOption', "error: unknown option '--zzz'"),
    );
    expect(far.details.hint).toBe('Run "operate task list --help" for the usage.');
  });

  it('never quotes the value of an unknown --name=value option', () => {
    const error = commanderUsageError(
      exitOf(list, 'commander.unknownOption', "error: unknown option '--assigne=S3cr3t'"),
    );
    expect(error.message).toBe('Unknown option "--assigne"');
    expect(error.details.hint).toBe(
      'Did you mean one of --assignee, --assigned? Run "operate task list --help" for the usage.',
    );
    const quoted = commanderUsageError(
      exitOf(list, 'commander.unknownOption', "error: unknown option '--auth-password=it's'"),
    );
    expect(quoted.message).toBe('Unknown option "--auth-password"');
  });

  it('reports a value given to a flag that takes none', () => {
    const error = commanderUsageError(
      exitOf(list, 'commander.unknownOption', "error: unknown option '--assigned=S3cr3t'"),
    );
    expect(error.message).toBe('Option "--assigned" takes no value');
    expect(error.details.hint).toBe('Run "operate task list --help" for the usage.');
  });

  describe('auth flags', () => {
    const auth = new Command('ping');
    root.addCommand(auth);
    auth.option('--auth <type>').option('--auth-user <name>').option('--auth-password-stdin');
    const secret =
      'Secrets are never flag values: pipe the password into --auth-password-stdin, or set OPERATE_PASSWORD (a profile stores the name of a variable: config set --auth-password-env <VAR>); pass a bearer token with OPERATE_TOKEN or --auth-token-stdin; an OAuth token comes from `operate auth login`. ';
    const help = 'Run "operate ping --help" for the usage.';
    const unknown = (flag: string) =>
      commanderUsageError(
        exitOf(auth, 'commander.unknownOption', `error: unknown option '${flag}'`),
      );

    it('points the flag names of issue #1 to the --auth-* flags', () => {
      for (const flag of ['--username', '--USER', '--auth-username']) {
        expect(unknown(flag).details.hint).toBe(`Did you mean --auth-user? ${help}`);
      }
      expect(unknown('--password-stdin').details.hint).toBe(
        `Did you mean --auth-password-stdin? ${help}`,
      );
      expect(unknown('--auth-type=basic').details.hint).toBe(`Did you mean --auth? ${help}`);
      // only flags the command has: ping has no --auth-password-env
      expect(unknown('--password-env').details.hint).toBe(`${secret}${help}`);
    });

    it('says that passwords are never flag values, without the value', () => {
      for (const flag of [
        '--password',
        '--auth-password',
        '--pass',
        '--token',
        '--client-secret',
      ]) {
        const error = unknown(`${flag}=S3cr3t`);
        expect(error.message).toBe(`Unknown option "${flag}"`);
        expect(error.details.hint).toBe(`${secret}${help}`);
      }
      const stdin = unknown('--auth-password-stdin=S3cr3t');
      expect(stdin.message).toBe('Option "--auth-password-stdin" takes no value');
      expect(stdin.details.hint).toBe(`${secret}${help}`);
      expect(unknown('--compass').details.hint).toBe(help);
    });

    it('leaves out extra arguments next to an option about a secret', () => {
      const excess = (argv: readonly string[]) =>
        commanderUsageError(
          exitOf(
            auth,
            'commander.excessArguments',
            "error: too many arguments for 'ping'. Expected 0 arguments but got 2: S3:cr3t, x\ny.",
          ),
          argv,
        );
      const stdin = excess(['ping', '--auth-password-stdin', 'S3:cr3t', 'x']);
      expect(stdin.message).toBe("Too many arguments for 'ping'. Expected 0 arguments but got 2.");
      expect(stdin.details.hint).toBe(
        `--auth-password-stdin takes no value: pipe the password into it, e.g. printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin. ${help}`,
      );
      const other = excess(['ping', '--password=x', 'S3:cr3t']);
      expect(other.message).toBe("Too many arguments for 'ping'. Expected 0 arguments but got 2.");
      expect(other.details.hint).toBe(help);
      expect(excess(['ping', 'S3:cr3t', 'x\ny']).message).toBe(
        "Too many arguments for 'ping'. Expected 0 arguments but got 2: S3:cr3t, x\ny.",
      );
      expect(excess(['ping', 'password', 'x']).message).toContain('got 2: S3:cr3t, x\ny.');
      const bearer = excess(['ping', '--auth', 'bearer', 'S3:cr3t', 'x']);
      expect(bearer.message).toBe("Too many arguments for 'ping'. Expected 0 arguments but got 2.");
      expect(bearer.details.hint).toBe(
        `--auth takes only the type: the token goes into OPERATE_TOKEN or --auth-token-stdin, not after --auth bearer. ${help}`,
      );
    });

    it('leaves out an unknown command next to an option about a secret', () => {
      const unknownCommand = (argv: readonly string[]) =>
        commanderUsageError(
          exitOf(root, 'commander.unknownCommand', "error: unknown command 'S3cr3t'"),
          argv,
        );
      const hidden = unknownCommand(['--auth-password-stdin', 'S3cr3t', 'task', 'list']);
      expect(hidden.message).toBe('Unknown command (not repeated: it may be a token or password)');
      expect(hidden.details.hint).toBe(
        `--auth-password-stdin takes no value: pipe the password into it, e.g. printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin. Run "operate --help" for the commands.`,
      );
      expect(unknownCommand(['--auth', 'bearer', 'S3cr3t']).message).not.toContain('S3cr3t');
      expect(unknownCommand(['S3cr3t']).message).toBe('Unknown command "S3cr3t"');
    });
  });

  describe('auth commands', () => {
    const authGroup = new Command('auth');
    root.addCommand(authGroup);
    const status = new Command('status');
    const logout = new Command('logout');
    authGroup.addCommand(status);
    authGroup.addCommand(logout);
    const excess = (command: Command) =>
      commanderUsageError(
        exitOf(
          command,
          'commander.excessArguments',
          `error: too many arguments for '${command.name()}'. Expected 0 arguments but got 1: S3cr3t.`,
        ),
        ['auth', command.name(), 'S3cr3t'],
      );

    it('leaves out extra arguments: the most likely one is a token', () => {
      expect(excess(status)).toMatchObject({
        message: "Too many arguments for 'status'. Expected 0 arguments but got 1.",
        details: {
          hint: `operate auth status takes no token argument: pipe the token into --auth-token-stdin, e.g. printf '%s\\n' "$TOKEN" | operate auth status --auth-token-stdin. Run "operate auth status --help" for the usage.`,
        },
      });
      expect(excess(logout)).toMatchObject({
        message: "Too many arguments for 'logout'. Expected 0 arguments but got 1.",
        details: { hint: 'Run "operate auth logout --help" for the usage.' },
      });
    });

    it('leaves out an unknown subcommand but keeps the suggestion', () => {
      const error = commanderUsageError(
        exitOf(authGroup, 'commander.unknownCommand', "error: unknown command 'stauts'"),
        ['auth', 'stauts'],
      );
      expect(error.message).not.toContain('stauts');
      expect(error.details.hint).toBe(
        'Did you mean status? Run "operate auth --help" for the commands.',
      );
    });
  });

  it('keeps messages without prefix', () => {
    expect(commanderUsageError(exitOf(root, 'commander.error', 'odd')).message).toBe('Odd');
  });
});

describe('errorFormat', () => {
  it('prefers the resolved format, then argv, then OPERATE_OUTPUT, then the terminal', async () => {
    const tty = fakeRuntime({ stdoutTTY: true, env: { OPERATE_OUTPUT: 'json' } });
    expect(await errorFormat(['-o', 'json'], tty, { format: 'table' })).toBe('table');
    expect(await errorFormat(['-o', 'table'], tty, {})).toBe('table');
    expect(await errorFormat([], tty, {})).toBe('json');
    expect(await errorFormat([], fakeRuntime({ stdoutTTY: true }), {})).toBe('table');
    const spaced = fakeRuntime({ env: { OPERATE_OUTPUT: ' table ' } });
    expect(await errorFormat([], spaced, {})).toBe('table');
    expect(await errorFormat([], fakeRuntime({ env: { OPERATE_OUTPUT: 'yaml' } }), {})).toBe(
      'json',
    );
    expect(await errorFormat([], fakeRuntime(), {})).toBe('json');
  });

  it('takes the output of the profile named in argv, or of the default profile', async () => {
    const file = JSON.stringify({
      defaultProfile: 't',
      profiles: { t: { output: 'table' }, j: { output: 'json' } },
    });
    const runtime = fakeRuntime({ files: { '/c.json': file, [CONFIG_PATH]: file } });
    expect(await errorFormat([], runtime, {})).toBe('table');
    expect(await errorFormat(['--profile', 'j'], runtime, {})).toBe('json');
    expect(await errorFormat(['--config=/c.json', '--profile=t'], runtime, {})).toBe('table');
    expect(await errorFormat(['-o', 'json'], runtime, {})).toBe('json');
    const broken = fakeRuntime({ files: { [CONFIG_PATH]: '{' } });
    expect(await errorFormat([], broken, {})).toBe('json');
  });
});

describe('reportError', () => {
  it('returns 0 and prints nothing for help and version', async () => {
    const runtime = fakeRuntime();
    const exit = exitOf(new Command('x'), 'commander.version', '1');
    const code = await reportError(exit, [], runtime, {});
    expect(code).toBe(0);
    expect(runtime.stderr.text()).toBe('');
  });

  it('renders OperateErrors and returns their exit code', async () => {
    const runtime = fakeRuntime();
    const error = new OperateError('NOT_FOUND', 'gone', { hint: 'look elsewhere' });
    expect(await reportError(error, [], runtime, {})).toBe(5);
    expect(runtime.stderr.text()).toBe(
      '{"error":{"code":"NOT_FOUND","exitCode":5,"message":"gone","hint":"look elsewhere"}}\n',
    );
    expect(runtime.stdout.text()).toBe('');
  });

  it('turns other errors into INTERNAL with the stack when verbose', async () => {
    const runtime = fakeRuntime();
    const code = await reportError(new Error('bug'), ['--verbose'], runtime, { format: 'table' });
    expect(code).toBe(1);
    expect(runtime.stderr.text()).toMatch(/^Error: bug\n {2}Hint: This is likely a bug/);
    expect(runtime.stderr.text()).toContain('  Stack:\n');
    const quiet = fakeRuntime();
    await reportError(new Error('bug'), [], quiet, { format: 'table' });
    expect(quiet.stderr.text()).not.toContain('Stack:');
  });

  it('replaces control characters of messages on a terminal stderr only', async () => {
    const error = new OperateError('HTTP_CLIENT_ERROR', 'bad \u009b2J value');
    const tty = fakeRuntime({ stderrTTY: true });
    await reportError(error, [], tty, { format: 'json' });
    expect(tty.stderr.text()).toContain('bad \ufffd2J value');
    const pipe = fakeRuntime();
    await reportError(error, [], pipe, { format: 'json' });
    expect(pipe.stderr.text()).toContain('bad \u009b2J value');
  });
});
