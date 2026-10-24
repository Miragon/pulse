/**
 * `operate auth login|status|logout` (design §16.3): the OAuth login of a person in a terminal,
 * the state of the token cache, and the logout (auth-logout.ts); `auth status` also shows a bearer
 * token from elsewhere (auth-bearer.ts, §18). This is the only module that imports the interactive login
 * (src/auth/oauth/login.ts): no other command can start a loopback server or a browser, so agents
 * never end up in an interactive login.
 */

import type { Command } from 'commander';
import { commandToken } from '../../auth/command-provider.js';
import { cachePath, readCache } from '../../auth/oauth/cache.js';
import { checkUsable, notLoggedIn, otherIdentity } from '../../auth/oauth/errors.js';
import { identityOf, sameIdentity } from '../../auth/oauth/identity.js';
import { login } from '../../auth/oauth/login.js';
import type { LoginDeps } from '../../auth/oauth/types.js';
import { MAX_TIMEOUT_MS } from '../../config/resolve.js';
import type { BearerAuthConfig } from '../../config/types.js';
import { usageError } from '../../errors.js';
import type { Runtime } from '../../runtime.js';
import { subcommand } from '../command.js';
import type { CliContext } from '../context.js';
import { addGlobalOptions } from '../globals.js';
import { type Session, sessionAuthDeps, sessionOAuthDeps } from '../session.js';
import { bearerStatusView, expiredError } from './auth-bearer.js';
import { runLogout } from './auth-logout.js';
import { printView, safeStderr, withWidth } from './auth-output.js';
import { authSession, oauthOf } from './auth-session.js';
import { sharedLoginLines, sharingProfiles } from './auth-shared.js';
import { loginView } from './auth-view.js';
import type { UtilityCommand } from './types.js';

const LOGIN_OPTIONS = ['profile', 'config', 'output', 'timeout', 'verbose'];
/** `--auth-token-stdin` lets `auth status` show a piped bearer token (design §18). */
const STATUS_OPTIONS = ['profile', 'config', 'output', 'auth-token-stdin'];
const OPTIONS_GROUP = 'Options:';
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;

const DESCRIPTION = [
  'Log in with OAuth 2.0 (authorization code flow with PKCE) and manage the cached tokens.',
  '',
  'A person runs "operate auth login" once in a terminal; every other command reads the token cache and refreshes the token on its own. Agents never log in themselves: without a usable login a command fails with LOGIN_REQUIRED (exit 4).',
  '',
  'A bearer token from elsewhere (--auth bearer, OPERATE_TOKEN) needs no login: "operate auth status" shows where it comes from and, for a JWT, its subject, issuer, audience and expiry.',
].join('\n');

/** `--login-timeout <ms>`: a positive whole number up to the largest timer delay. */
export function parseLoginTimeout(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LOGIN_TIMEOUT_MS;
  const value = /^\s*\d+\s*$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS) return value;
  throw usageError(
    `--login-timeout expects a positive number of milliseconds, got "${raw}"`,
    `Use a whole number between 1 and ${MAX_TIMEOUT_MS}, e.g. 600000 for ten minutes.`,
  );
}

async function runLogin(command: Command, context: CliContext): Promise<void> {
  const { runtime } = context;
  const options = command.opts<{ browser?: boolean; loginTimeout?: string }>();
  const loginTimeoutMs = parseLoginTimeout(options.loginTimeout);
  const session = await authSession(command, context, 'login');
  const config = oauthOf(session, 'login', runtime.env);
  const deps: LoginDeps = {
    ...sessionOAuthDeps(session, runtime),
    randomBytes: (length) => runtime.randomBytes(length),
    listenLoopback: (port, handler) => runtime.listenLoopback(port, handler),
    openBrowser: (url) => runtime.openBrowser(url),
    deadline: (ms) => runtime.deadline(ms),
    stderr: safeStderr(runtime),
  };
  const noBrowser = options.browser === false;
  const result = await login(config, { noBrowser, loginTimeoutMs }, deps);
  const profiles = sharingProfiles(session.file, config.login, config.profile);
  for (const line of sharedLoginLines(session.file, profiles, config.profile)) {
    deps.stderr.write(`${line}\n`);
  }
  const use = { tokenCache: result.tokenFile, profiles };
  printView(
    loginView(result.login, config, use, runtime.now()),
    withWidth(session, runtime),
    runtime,
  );
}

/**
 * `auth status` of a bearer token: the view, then TOKEN_EXPIRED for an expired JWT. A token
 * command runs (unless its token is cached); it fails before the view.
 */
async function bearerStatus(auth: BearerAuthConfig, session: Session, runtime: Runtime) {
  const display = withWidth(session, runtime);
  if (auth.command !== undefined) {
    const { entry, cached } = await commandToken(auth, sessionAuthDeps(session, runtime));
    printView(bearerStatusView(auth, entry.token, runtime.now(), cached), display, runtime);
    return;
  }
  const now = runtime.now();
  printView(bearerStatusView(auth, auth.token, now), display, runtime);
  const expired = expiredError(auth, now);
  if (expired !== undefined) throw expired;
}

async function runStatus(command: Command, context: CliContext): Promise<void> {
  const { runtime } = context;
  const session = await authSession(command, context, 'status');
  const { auth } = session.config;
  if (auth.type === 'bearer') {
    await bearerStatus(auth, session, runtime);
    return;
  }
  const config = oauthOf(session, 'status', runtime.env);
  const deps = sessionOAuthDeps(session, runtime);
  const path = await cachePath(config, deps);
  const cached = await readCache(path, deps, config);
  if (cached === undefined) throw notLoggedIn(config);
  if (!sameIdentity(cached.identity, identityOf(config)))
    throw otherIdentity(cached.identity, config);
  const now = runtime.now();
  checkUsable(cached, now, config);
  const profiles = sharingProfiles(session.file, config.login, config.profile);
  const use = { tokenCache: path, profiles };
  printView(loginView(cached, config, use, now), withWidth(session, runtime), runtime);
}

function authSubcommand(parent: Command, name: string, description: string): Command {
  return subcommand(parent, name).description(description);
}

function registerLogin(auth: Command, context: CliContext): void {
  const command = authSubcommand(
    auth,
    'login',
    'Log in with the OAuth settings of the profile: prints the authorization URL, opens the system browser and waits for the login at http://127.0.0.1:<port>/callback. Replaces a cached login. Meant for a person in a terminal, not for agents.',
  )
    .option('--no-browser', 'Only print the URL; do not start the system browser')
    .option('--login-timeout <ms>', 'How long to wait for the login, default 300000');
  addGlobalOptions(command, LOGIN_OPTIONS, OPTIONS_GROUP);
  command.action(() => runLogin(command, context));
}

function registerStatus(auth: Command, context: CliContext): void {
  const command = authSubcommand(
    auth,
    'status',
    'Show the cached OAuth login without network access: user, scopes and the expiry of the access and refresh token. Exit 0 when commands can run without a new login, else LOGIN_REQUIRED (exit 4). With a bearer token: its source (OPERATE_TOKEN_COMMAND runs, unless its token is cached) and, for a JWT, subject, issuer, audience and expiry; an expired JWT given as such exits with TOKEN_EXPIRED (exit 4). Never prints a token.',
  );
  addGlobalOptions(command, STATUS_OPTIONS, OPTIONS_GROUP);
  command.action(() => runStatus(command, context));
}

function registerLogout(auth: Command, context: CliContext): void {
  const command = authSubcommand(
    auth,
    'logout',
    'Revoke the refresh token at the authorization server (when it supports revocation) and remove the cached login, for every profile that shares it. Works for a profile whose OAuth settings no longer resolve.',
  );
  addGlobalOptions(command, LOGIN_OPTIONS, OPTIONS_GROUP);
  command.action(() => runLogout(command, context));
}

export const authCommand: UtilityCommand = {
  name: 'auth',
  nested: true,
  register(program, context) {
    const auth = subcommand(program, 'auth')
      .summary('Log in with OAuth, manage the cached tokens, check a bearer token')
      .description(DESCRIPTION);
    registerLogin(auth, context);
    registerStatus(auth, context);
    registerLogout(auth, context);
  },
};
