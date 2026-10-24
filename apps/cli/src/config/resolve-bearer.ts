/**
 * Resolves a bearer token obtained outside operate (design §18, §23). The token:
 * `--auth-token-stdin` > OPERATE_TOKEN > OPERATE_TOKEN_COMMAND (a command line operate runs when
 * it needs the token) > the variable named by the profile's auth.tokenEnv (only read when no
 * higher source has a token) > the profile's auth.token. Without an auth type anywhere, a token
 * from the flag or the environment, or OPERATE_TOKEN_COMMAND, selects bearer auth, like a username
 * selects Basic auth. Pure; messages never show a token.
 */

import { OperateError } from '../errors.js';
import { compact } from '../util.js';
import { normalizeToken } from './bearer.js';
import { configError } from './config-error.js';
import type { Env } from './pick.js';
import {
  type AuthType,
  type BearerAuthConfig,
  type ConfigFlags,
  ENV,
  type ProfileAuth,
  type SelectedProfile,
  type Source,
  type UnusedToken,
} from './types.js';
import { TOKEN_VARIABLE, unsetVariable } from './variable.js';

export interface BearerContext {
  readonly flags: ConfigFlags;
  readonly env: Env;
  readonly selected: SelectedProfile;
  /** `operate auth` commands have no `--auth` option: hints suggest OPERATE_AUTH instead. */
  readonly authCommand?: boolean;
}

/**
 * A token as found: not yet normalized; `origin` names the source, `variable` its variable,
 * `command` says that `value` is a command line that prints the token.
 */
interface FoundToken {
  readonly value: string;
  readonly source: Source;
  readonly origin: string;
  readonly variable?: string;
  readonly command?: boolean;
}

const STDIN_FLAG = '--auth-token-stdin';

/** `a bearer token` or `a bearer token command`, for messages. */
export function tokenNoun(token: { readonly command?: boolean | undefined }): string {
  return token.command === true ? 'a bearer token command' : 'a bearer token';
}

/** A token value: blank counts as unset. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * The token of `--auth-token-stdin` or OPERATE_TOKEN, or the command of OPERATE_TOKEN_COMMAND:
 * these select bearer auth without a type.
 */
export function givenToken({ flags, env }: BearerContext): FoundToken | undefined {
  const fromFlag = present(flags.authToken);
  if (fromFlag !== undefined) return { value: fromFlag, source: 'flag', origin: STDIN_FLAG };
  const fromEnv = present(env[ENV.token]);
  if (fromEnv !== undefined) {
    return { value: fromEnv, source: 'env', origin: ENV.token, variable: ENV.token };
  }
  const commandEnv = present(env[ENV.tokenCommand]);
  return commandEnv === undefined
    ? undefined
    : { value: commandEnv, source: 'env', origin: ENV.tokenCommand, command: true };
}

/** The variable named by auth.tokenEnv; it must be set. */
function tokenFromVariable(variable: string, name: string, env: Env): FoundToken {
  const value = present(env[variable]);
  if (value === undefined) throw unsetVariable(variable, name, TOKEN_VARIABLE);
  return {
    value,
    source: 'profile',
    origin: `${variable} (auth.tokenEnv of profile "${name}")`,
    variable,
  };
}

function storedToken({ env, selected }: BearerContext): FoundToken | undefined {
  if (selected.profile === undefined) return undefined;
  const { name, profile } = selected;
  const auth: ProfileAuth = profile.auth ?? {};
  if (auth.tokenEnv !== undefined) return tokenFromVariable(auth.tokenEnv, name, env);
  const value = present(auth.token);
  return value === undefined
    ? undefined
    : { value, source: 'profile', origin: `auth.token of profile "${name}"` };
}

/** Where a bearer token comes from: its origin, and whether a command prints it. */
export interface BearerSource {
  readonly origin: string;
  readonly command: boolean;
}

/**
 * Where the bearer token of the context would come from, without reading the variable a profile's
 * tokenEnv names (and without running a command); undefined when there is none.
 */
export function bearerSource(context: BearerContext): BearerSource | undefined {
  const given = givenToken(context);
  if (given !== undefined) return { origin: given.origin, command: given.command === true };
  const { name, profile } = context.selected;
  const auth = profile?.auth ?? {};
  const key = (['tokenEnv', 'token'] as const).find((candidate) => auth[candidate] !== undefined);
  return key === undefined
    ? undefined
    : { origin: `auth.${key} of profile "${name ?? ''}"`, command: false };
}

function missingToken(selectedBy: string, selected: SelectedProfile) {
  const profile =
    selected.profile === undefined
      ? 'a profile (none is selected)'
      : `the auth.tokenEnv and auth.token of profile "${selected.name}"`;
  const name = selected.name ?? '<profile>';
  return configError(
    'Bearer auth is selected but the token is missing',
    `Bearer auth was selected by ${selectedBy}. Looked up the token in ${STDIN_FLAG}, ${ENV.token}, ${ENV.tokenCommand} and ${profile}. Fetch a token with the tool that issues it (e.g. az account get-access-token, gcloud auth print-access-token) and export ${ENV.token}=<token>, let operate run that tool with export ${ENV.tokenCommand}=<command>, pipe it into ${STDIN_FLAG}, or store the name of its variable with \`operate config set ${name} --auth bearer --auth-token-env <VAR>\`; --auth none switches bearer auth off.`,
  );
}

/** `--auth-password-stdin` with bearer auth: stdin would be read for nothing. */
function refuseStdinPassword(flags: ConfigFlags, selectedBy: string): void {
  if (present(flags.authPassword) === undefined) return;
  throw configError(
    `--auth-password-stdin reads a Basic auth password, but bearer auth is selected by ${selectedBy}`,
    `Drop --auth-password-stdin: bearer auth sends a token (${STDIN_FLAG} or ${ENV.token}), no password.`,
  );
}

/**
 * The bearer token, or the command that prints it; `selectedBy` names what selected bearer auth
 * (`--auth bearer`). A command is not run here.
 */
export function resolveBearer(context: BearerContext, selectedBy: string): BearerAuthConfig {
  refuseStdinPassword(context.flags, selectedBy);
  const found = givenToken(context) ?? storedToken(context);
  if (found === undefined) throw missingToken(selectedBy, context.selected);
  const base = {
    type: 'bearer',
    source: found.source,
    origin: found.origin,
    ...compact({ variable: found.variable, profile: context.selected.name }),
  } as const;
  return found.command === true
    ? { ...base, command: found.value.trim() }
    : { ...base, token: normalizeToken(found.value, found.origin) };
}

const FAMILY: Readonly<Record<Exclude<AuthType, 'bearer'>, string>> = {
  none: 'none',
  basic: 'Basic auth',
  oauth: 'OAuth',
};

/**
 * A token of `--auth-token-stdin` or OPERATE_TOKEN, or OPERATE_TOKEN_COMMAND, next to an explicit
 * type that does not use it. The environment variable is ignored (and reported by `config show`);
 * `--auth-token-stdin`, which reads stdin for nothing, is a CONFIG error unless the type is none
 * (switched off).
 */
export function unusedToken(
  context: BearerContext,
  type: Exclude<AuthType, 'bearer'>,
  typeLabel: string,
): UnusedToken | undefined {
  const token = givenToken(context);
  if (token === undefined) return undefined;
  if (token.source === 'flag' && type !== 'none') {
    const select = context.authCommand === true ? `${ENV.auth}=bearer` : '--auth bearer';
    throw configError(
      `${STDIN_FLAG} reads a bearer token, but ${FAMILY[type]} is selected by ${typeLabel}`,
      `Drop ${STDIN_FLAG}, or select bearer auth with ${select}.`,
    );
  }
  const reason =
    type === 'none'
      ? `bearer auth is switched off by ${typeLabel}`
      : `${FAMILY[type]} is selected by ${typeLabel}`;
  const { value, source, command } = token;
  return { value, source, reason, ...compact({ command }) };
}

/**
 * Basic auth and bearer auth both selected without a type (a username or
 * `--auth-password-stdin`, and a token): CONFIG, the user must choose.
 */
export function inferenceConflict(basicBy: string, token: FoundToken) {
  return configError(
    `Both Basic auth and ${tokenNoun(token)} are configured, but no auth type says which one to use`,
    `${basicBy} selects Basic auth, ${tokenNoun(token)} (from ${token.origin}) selects bearer auth. Choose one explicitly: --auth basic or --auth bearer (also OPERATE_AUTH or the auth.type of the profile), or unset the other.`,
  );
}

/**
 * `A bearer token is set (from OPERATE_TOKEN) but not used: <reason>; send it with --auth bearer
 * or OPERATE_AUTH=bearer.`, for hints of failures the type that won causes (also LOGIN_REQUIRED
 * and 401 answers, src/auth/note.ts).
 */
export function unusedTokenNote(unused: UnusedToken, authCommand?: boolean): string {
  const command = unused.command === true;
  const variable = command ? ENV.tokenCommand : ENV.token;
  const origin = unused.source === 'flag' ? STDIN_FLAG : variable;
  const noun = command ? 'A bearer token command' : 'A bearer token';
  const select = authCommand === true ? 'use it with' : 'send it with --auth bearer or';
  return `${noun} is set (from ${origin}) but not used: ${unused.reason}; ${select} ${ENV.auth}=bearer.`;
}

/**
 * Runs `resolve`; a CONFIG error of it (a Basic profile's password variable is not set, OAuth
 * settings are missing, ...) also carries `note` (`unusedTokenNote`), so a user who exported
 * OPERATE_TOKEN next to a profile with another type is not left guessing.
 */
export function mentioningUnused<T>(note: string | undefined, resolve: () => T): T {
  try {
    return resolve();
  } catch (error) {
    if (note === undefined || !(error instanceof OperateError) || error.code !== 'CONFIG') {
      throw error;
    }
    const { hint } = error.details;
    throw new OperateError('CONFIG', error.message, {
      ...error.details,
      hint: hint === undefined ? note : `${hint} ${note}`,
    });
  }
}
