import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { GLOBAL_FLAGS } from '../../scripts/catalog/flags.js';
import {
  addGlobalOptions,
  configFlags,
  GLOBAL_GROUP,
  GLOBAL_OPTION_FLAGS,
  GLOBAL_OPTIONS,
  type GlobalOptions,
  optionFlags,
  readGlobals,
} from './globals.js';

function parsed(args: readonly string[]): GlobalOptions {
  const command = addGlobalOptions(new Command('x').exitOverride()).action(() => undefined);
  command.parse([...args], { from: 'user' });
  return readGlobals(command);
}

const NONE: GlobalOptions = {
  headers: [],
  pretty: false,
  dryRun: false,
  yes: false,
  readOnly: false,
  verbose: false,
  showSecrets: false,
  authPasswordStdin: false,
  authTokenStdin: false,
};

describe('global options', () => {
  it('equal GLOBAL_FLAGS of the catalog generator', () => {
    expect(GLOBAL_OPTION_FLAGS).toEqual(GLOBAL_FLAGS);
  });

  it('render their commander flags', () => {
    expect(GLOBAL_OPTIONS.map(optionFlags)).toEqual([
      '--url <url>',
      '--engine <name>',
      '--platform <name>',
      '--profile <name>',
      '--config <path>',
      '-o, --output <format>',
      '--fields <list>',
      '--pretty',
      '--dry-run',
      '-y, --yes',
      '--read-only',
      '--timeout <ms>',
      '-H, --header <header>',
      '--auth <type>',
      '--auth-user <name>',
      '--auth-password-stdin',
      '--auth-token-stdin',
      '--verbose',
      '--out-file <path>',
      '--show-secrets',
      '-h, --help',
    ]);
  });

  it('are registered in the "Global Options:" help group, help last', () => {
    const command = addGlobalOptions(new Command('x'));
    expect(command.options.map((option) => option.long)).toEqual(
      GLOBAL_OPTION_FLAGS.filter((flag) => flag !== 'help').map((flag) => `--${flag}`),
    );
    expect(new Set(command.options.map((option) => option.helpGroupHeading))).toEqual(
      new Set([GLOBAL_GROUP]),
    );
    expect(command.helpInformation()).toMatch(
      /\nGlobal Options:\n {2}--url <url> [^\n]*\n[^]*\n {2}-h, --help {2,}Display help for command\n$/,
    );
  });

  it('can be registered as a subset under another heading', () => {
    const command = addGlobalOptions(new Command('x'), ['config', 'help'], 'Options:');
    expect(command.options.map((option) => [option.long, option.helpGroupHeading])).toEqual([
      ['--config', 'Options:'],
    ]);
    expect(command.helpInformation()).toContain('Options:\n  --config <path>');
    expect(command.helpInformation()).not.toContain('Global Options:');
  });
});

describe('readGlobals', () => {
  it('reads nothing when no option is given', () => {
    expect(parsed([])).toEqual(NONE);
  });

  it('reads every option', () => {
    expect(
      parsed([
        '--url',
        'http://u',
        '--engine',
        'e',
        '--profile',
        'p',
        '--config',
        '/c',
        '-o',
        'table',
        '--fields',
        'id',
        '--pretty',
        '--dry-run',
        '-y',
        '--read-only',
        '--timeout',
        '10',
        '-H',
        'A: 1',
        '--header',
        'B: 2',
        '--auth',
        'basic',
        '--auth-user',
        'demo',
        '--auth-password-stdin',
        '--verbose',
        '--out-file',
        '/o',
        '--show-secrets',
      ]),
    ).toEqual({
      url: 'http://u',
      engine: 'e',
      profile: 'p',
      config: '/c',
      output: 'table',
      fields: 'id',
      timeout: '10',
      outFile: '/o',
      auth: 'basic',
      authUser: 'demo',
      headers: ['A: 1', 'B: 2'],
      pretty: true,
      dryRun: true,
      yes: true,
      readOnly: true,
      verbose: true,
      showSecrets: true,
      authPasswordStdin: true,
      authTokenStdin: false,
    });
  });
});

describe('configFlags', () => {
  it('passes the config related values', () => {
    expect(
      configFlags({
        ...NONE,
        url: 'http://u',
        engine: 'e',
        profile: 'p',
        output: 'json',
        timeout: '5',
        headers: ['A: 1'],
        readOnly: true,
        fields: 'id',
        auth: 'basic',
        authUser: 'demo',
        authPasswordStdin: true,
      }),
    ).toEqual({
      url: 'http://u',
      engine: 'e',
      profile: 'p',
      output: 'json',
      timeout: '5',
      headers: ['A: 1'],
      readOnly: true,
      auth: 'basic',
      authUser: 'demo',
    });
  });

  it('passes the password read from stdin', () => {
    expect(configFlags({ ...NONE, authPasswordStdin: true }, { password: 'p:w' })).toEqual({
      authPassword: 'p:w',
    });
  });

  it('passes the token read from stdin', () => {
    expect(configFlags({ ...NONE, authTokenStdin: true }, { token: 'abc.def' })).toEqual({
      authToken: 'abc.def',
    });
  });

  it('reads --auth-token-stdin', () => {
    expect(parsed(['--auth-token-stdin'])).toEqual({ ...NONE, authTokenStdin: true });
  });

  it('leaves out absent values, empty headers and read-only false', () => {
    expect(configFlags(NONE)).toEqual({});
  });
});
