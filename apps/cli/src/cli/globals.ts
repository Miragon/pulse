/**
 * Global options (design §2.1): registered on every operation command, `api` and `ping`, shown
 * under "Global Options:" in the help. `GLOBAL_OPTION_FLAGS` must equal `GLOBAL_FLAGS` of the
 * catalog generator (scripts/catalog/flags.ts), which keeps body field flags clear of them.
 */

import { type Command, Option } from 'commander';
import {
  AUTH_TYPES,
  type ConfigFlags,
  DEFAULT_PLATFORM,
  OUTPUT_FORMATS,
  PLATFORMS,
} from '../config/types.js';
import { compact } from '../util.js';
import { type OptionCompletion, setOptionCompletion } from './completion-meta.js';
import { collect } from './options.js';

export interface GlobalOptionSpec {
  /** Long flag without dashes. */
  readonly long: string;
  /** Short flag letter. */
  readonly short?: string;
  /** Placeholder of the option argument; absent for flags without one. */
  readonly value?: string;
  readonly repeatable?: boolean;
  readonly description: string;
}

export const GLOBAL_GROUP = 'Global Options:';

export const GLOBAL_OPTIONS: readonly GlobalOptionSpec[] = [
  {
    long: 'url',
    value: '<url>',
    description: 'REST API root, e.g. http://localhost:8080/engine-rest (env OPERATE_URL)',
  },
  {
    long: 'engine',
    value: '<name>',
    description: 'Named process engine, adds /engine/<name> to the path (env OPERATE_ENGINE)',
  },
  {
    long: 'platform',
    value: '<name>',
    description: `Engine product: ${PLATFORMS.join(', ')}; default ${DEFAULT_PLATFORM} (env OPERATE_PLATFORM)`,
  },
  {
    long: 'profile',
    value: '<name>',
    description: 'Profile of the config file (env OPERATE_PROFILE)',
  },
  { long: 'config', value: '<path>', description: 'Config file location (env OPERATE_CONFIG)' },
  {
    long: 'output',
    short: 'o',
    value: '<format>',
    description: 'json or table; default: table on a terminal, else json (env OPERATE_OUTPUT)',
  },
  {
    long: 'fields',
    value: '<list>',
    description:
      'Comma separated fields to keep, e.g. id,name,variables.amount; also table columns',
  },
  { long: 'pretty', description: 'Indent JSON output (default on a terminal)' },
  { long: 'dry-run', description: 'Print the request instead of sending it' },
  { long: 'yes', short: 'y', description: 'Confirm delete and bulk operations' },
  {
    long: 'read-only',
    description: 'Refuse every operation that is not a read (env OPERATE_READ_ONLY)',
  },
  {
    long: 'timeout',
    value: '<ms>',
    description: 'Request timeout in milliseconds, default 30000 (env OPERATE_TIMEOUT)',
  },
  {
    long: 'header',
    short: 'H',
    value: '<header>',
    repeatable: true,
    description: 'Extra request header "Name: value"; repeatable',
  },
  {
    long: 'auth',
    value: '<type>',
    description:
      'Authentication: none, basic, oauth or bearer; a username alone selects basic, a token bearer (env OPERATE_AUTH)',
  },
  {
    long: 'auth-user',
    value: '<name>',
    description: 'Username for Basic auth (env OPERATE_USERNAME)',
  },
  {
    long: 'auth-password-stdin',
    description: 'Read the Basic auth password from the first line of stdin (env OPERATE_PASSWORD)',
  },
  {
    long: 'auth-token-stdin',
    description: 'Read the bearer token from the first line of stdin (env OPERATE_TOKEN)',
  },
  { long: 'verbose', description: 'Trace requests and responses on stderr' },
  { long: 'out-file', value: '<path>', description: 'Write the response body to a file' },
  {
    long: 'show-secrets',
    description: 'Do not mask secret headers and passwords in dry-run, verbose and config output',
  },
  { long: 'help', short: 'h', description: 'Display help for command' },
];

/** Long flag names of the global options, in help order. */
export const GLOBAL_OPTION_FLAGS: readonly string[] = GLOBAL_OPTIONS.map((spec) => spec.long);

/** Values of the global options; flags that were not given are absent or false. */
export interface GlobalOptions {
  readonly url?: string;
  readonly engine?: string;
  readonly platform?: string;
  readonly profile?: string;
  readonly config?: string;
  readonly output?: string;
  readonly fields?: string;
  readonly timeout?: string;
  readonly outFile?: string;
  readonly auth?: string;
  readonly authUser?: string;
  readonly headers: readonly string[];
  readonly pretty: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly readOnly: boolean;
  readonly verbose: boolean;
  readonly showSecrets: boolean;
  readonly authPasswordStdin: boolean;
  readonly authTokenStdin: boolean;
}

/** commander flags of a spec, e.g. `-o, --output <format>`. */
export function optionFlags(spec: GlobalOptionSpec): string {
  const short = spec.short === undefined ? '' : `-${spec.short}, `;
  const value = spec.value === undefined ? '' : ` ${spec.value}`;
  return `${short}--${spec.long}${value}`;
}

/** What the values of global options complete to (design §17.10). */
const COMPLETIONS: Readonly<Record<string, OptionCompletion>> = {
  output: { values: OUTPUT_FORMATS },
  platform: { values: PLATFORMS },
  auth: { values: AUTH_TYPES },
  profile: { profiles: true },
  config: { path: 'files' },
  'out-file': { path: 'files' },
};

function createOption(spec: GlobalOptionSpec, group: string): Option {
  const option = new Option(optionFlags(spec), spec.description).helpGroup(group);
  const completion = Object.hasOwn(COMPLETIONS, spec.long) ? COMPLETIONS[spec.long] : undefined;
  if (completion !== undefined) setOptionCompletion(option, completion);
  return spec.repeatable === true ? option.argParser(collect) : option;
}

/** The global options as commander options (with their completion facts), for completion. */
export function globalOptionObjects(): Option[] {
  return GLOBAL_OPTIONS.map((spec) => createOption(spec, GLOBAL_GROUP));
}

/**
 * Registers global options on a command: all of them by default, or the named subset (config
 * commands). `group` is the help heading.
 */
export function addGlobalOptions(
  command: Command,
  names: readonly string[] = GLOBAL_OPTION_FLAGS,
  group: string = GLOBAL_GROUP,
): Command {
  for (const spec of GLOBAL_OPTIONS.filter((candidate) => names.includes(candidate.long))) {
    const option = createOption(spec, group);
    if (spec.long === 'help') command.addHelpOption(option);
    else command.addOption(option);
  }
  return command;
}

/** Reads the global option values of a parsed command. */
export function readGlobals(command: Command): GlobalOptions {
  const opts = command.opts<Record<string, unknown>>();
  const text = (key: string) => {
    const value = opts[key];
    return typeof value === 'string' ? value : undefined;
  };
  const flag = (key: string) => opts[key] === true;
  return {
    ...compact({
      url: text('url'),
      engine: text('engine'),
      platform: text('platform'),
      profile: text('profile'),
      config: text('config'),
      output: text('output'),
      fields: text('fields'),
      timeout: text('timeout'),
      outFile: text('outFile'),
      auth: text('auth'),
      authUser: text('authUser'),
    }),
    headers: Array.isArray(opts.header) ? (opts.header as string[]) : [],
    pretty: flag('pretty'),
    dryRun: flag('dryRun'),
    yes: flag('yes'),
    readOnly: flag('readOnly'),
    verbose: flag('verbose'),
    showSecrets: flag('showSecrets'),
    authPasswordStdin: flag('authPasswordStdin'),
    authTokenStdin: flag('authTokenStdin'),
  };
}

/** What `--auth-password-stdin` and `--auth-token-stdin` read from stdin. */
export interface StdinSecrets {
  readonly password?: string | undefined;
  readonly token?: string | undefined;
}

/** The config related global options as input for `resolveConfig`, with the stdin secrets. */
export function configFlags(globals: GlobalOptions, secrets: StdinSecrets = {}): ConfigFlags {
  return compact({
    url: globals.url,
    engine: globals.engine,
    platform: globals.platform,
    profile: globals.profile,
    output: globals.output,
    timeout: globals.timeout,
    headers: globals.headers.length > 0 ? globals.headers : undefined,
    readOnly: globals.readOnly ? true : undefined,
    auth: globals.auth,
    authUser: globals.authUser,
    authPassword: secrets.password,
    authToken: secrets.token,
  });
}
