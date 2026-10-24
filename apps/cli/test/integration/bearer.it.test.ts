/**
 * Bearer tokens from elsewhere (`--auth bearer`, design §18) of the built CLI against the OAuth
 * topology of design §16.14.1: Keycloak issues the tokens without operate (a CI pipeline's client
 * credentials grant, a person's login through another tool), and Envoy's `jwt_authn` gateway
 * checks them in front of an unmodified engine. operate only sends `Authorization: Bearer
 * <token>`: no login, no refresh, no token cache.
 *
 * Token commands (design §23) fetch such tokens for operate: OPERATE_TOKEN_COMMAND runs a script
 * that runs the client credentials grant, also for the profiles of a project file (design §22),
 * whose directories share the cached token.
 *
 * The 5 s token of `operate-cli-short` is issued first, in `beforeAll`, so the 30 s expiry grace of
 * the TOKEN_EXPIRED test mostly passes while the other tests run. Every CLI run is checked against
 * every token the suite has seen (and each JWT's signature on its own); only `--show-secrets` runs
 * may print the one token they send.
 */

import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { argv, globalFlag } from './support/catalog.js';
import {
  assertCliBuilt,
  bindCli,
  type Cli,
  type CliError,
  type CliOptions,
  type CliResult,
} from './support/cli.js';
import { ENGINES } from './support/engines.js';
import { expectError, expectSuccess, required } from './support/expect.js';
import { audiencesOf, claimsOf, expiryOf, isJwt, signatureOf, tamperedJwt } from './support/jwt.js';
import {
  CI_CLIENT_SECRET,
  CLIENTS,
  clientCredentialsToken,
  directLogin,
  endpointsOf,
  USER,
} from './support/keycloak.js';
import {
  type OAuthTopology,
  oauthEngine,
  startOAuthTopology,
  TOPOLOGY_START_TIMEOUT_MS,
} from './support/oauth.js';
import type { EnvOverrides } from './support/process.js';
import { makeTempDir, removeTempDir } from './support/temp.js';
import { MASKED_BEARER, SENT_REQUEST, traceOf } from './support/trace.js';
import type {
  BearerStatusOutput,
  ConfigShowOutput,
  Count,
  DryRunOutput,
  PingOutput,
  ProcessDefinition,
} from './support/types.js';

const engine = oauthEngine();

/** Profiles of the profiles file (runs without a profile use an empty config file). */
const PROFILE = {
  /** written by `config set --auth bearer --auth-token-env IT_TOKEN` */
  tokenEnv: 'it-token-env',
  /** written by `config set --auth bearer --auth-token-stdin` (a literal token) */
  literal: 'it-token-literal',
  /** `auth.tokenEnv: IT_TOKEN`, written by the test (for tests about other things) */
  fixed: 'it-fixed',
} as const;

/** Variable named by the profiles' `tokenEnv`. */
const TOKEN_ENV = 'IT_TOKEN';
const AUDIENCE = 'engine-rest';
/** `preferred_username` of the tokens of `operate-ci`. */
const SERVICE_ACCOUNT = `service-account-${CLIENTS.ci}`;
/** Generous, like the OAuth suite: Keycloak and the gateway share the machine with many containers. */
const RUN_TIMEOUT_MS = 90_000;
/** operate refuses a JWT whose `exp` lies more than 30 s in the past (design §18). */
const EXPIRY_GRACE_MS = 30_000;
/** Envoy accepts 1 s of clock skew (fixtures/envoy.yaml); beyond that it answers "Jwt is expired". */
const GATEWAY_SKEW_MS = 2_500;
/** An opaque token: a valid RFC 6750 b64token that the gateway cannot parse. */
const GARBAGE = 'garbage-token-it';
/** A password next to a token: Basic auth must not happen by accident, nor print it. */
const STRAY_PASSWORD = 'stray-password-it';
/** Tokens that are no RFC 6750 b64token (space, non-ASCII, `=` inside, comma). */
const INVALID_TOKENS = [
  'invalid-it-1 invalid-it-2',
  'invalid-ä-it-3',
  'invalid-it-4=invalid-it-5',
  'invalid-it-6,invalid-it-7',
];
const MASKED_CURL = /'authorization: Bearer \*\*\*'/i;
const ANY_AUTHORIZATION = /^> authorization:/im;
const COUNT_REQUEST = '> GET <engine>/process-definition/count';

/** `operate process-definition count [flags...]`, a read the gateway guards. */
function countArgs(...flags: string[]): string[] {
  return [...argv('process-definition count'), ...flags];
}

function profileArgs(profile: string): string[] {
  return [globalFlag('profile'), profile];
}

/** Message, hint and the gateway's text of an error, for checks that do not care which says it. */
function explanation(error: CliError): string {
  return [error.message, error.hint ?? '', error.engineMessage ?? ''].join('\n');
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

/** `exp` of a JWT as operate prints instants: ISO 8601 UTC with milliseconds (§16.3). */
function expiryIso(jwt: string): string {
  return new Date(expiryOf(jwt)).toISOString();
}

function revealedHeader(token: string): RegExp {
  return new RegExp(`^> authorization: Bearer ${token.replaceAll('.', '\\.')}$`, 'im');
}

/** A profile as the config file stores it. */
interface StoredProfile {
  readonly url?: string;
  readonly auth?: unknown;
}

interface StoredConfig {
  readonly profiles: Readonly<Record<string, StoredProfile | undefined>>;
}

describe.skipIf(engine === undefined)(`Bearer tokens from elsewhere at ${engine ?? ''}`, () => {
  let topology: OAuthTopology | undefined;
  let workdir: string | undefined;
  /** Config file of the runs without a profile: empty, so only the environment counts. */
  let configFile = '';
  /** Config file of the profile tests. */
  let profilesFile = '';
  /** A CI pipeline's token: client credentials grant of `operate-ci`, a JWT valid for 300 s. */
  let ciToken = '';
  /** A person's 5 s token (`operate-cli-short`), issued first; it expires while the suite runs. */
  let staleToken = '';
  /** Everything no output may contain (tokens, their signatures, stray credentials). */
  const secrets = new Set<string>();
  let cli: Cli = () => Promise.reject(new Error('the OAuth topology did not start'));

  const top = () => required(topology, 'the OAuth topology');
  /** Requests and answers of a `--verbose` run; `<engine>` is the gateway URL. */
  const trace = (result: CliResult) => traceOf(result.stderr, { engine: top().url });

  /** Records tokens (for a JWT also its signature) that no output may contain. */
  function remember(...values: readonly string[]): void {
    for (const value of values) {
      secrets.add(value);
      if (isJwt(value)) secrets.add(signatureOf(value));
    }
  }

  /** Neither stdout nor stderr contains a secret; `revealed` (a `--show-secrets` run) may show. */
  function expectHidden(result: CliResult, revealed?: string): void {
    const allowed = revealed === undefined ? [] : [revealed, signatureOf(revealed)];
    for (const secret of secrets) {
      if (allowed.includes(secret)) continue;
      const where = `${result.command}\nexit code ${result.code}`;
      expect(result.stdout.includes(secret), `stdout reveals a secret\n${where}`).toBe(false);
      expect(result.stderr.includes(secret), `stderr reveals a secret\n${where}`).toBe(false);
    }
  }

  /** Runs the CLI and checks that the output contains no secret except `revealed`. */
  async function run(
    args: readonly string[],
    options: CliOptions = {},
    revealed?: string,
  ): Promise<CliResult> {
    const result = await cli(args, { timeoutMs: RUN_TIMEOUT_MS, ...options });
    expectHidden(result, revealed);
    return result;
  }

  async function readProfiles(): Promise<StoredConfig['profiles']> {
    return (JSON.parse(await readFile(profilesFile, 'utf8')) as StoredConfig).profiles;
  }

  /** Adds or replaces a profile in the profiles file directly (not through `config set`). */
  async function writeProfile(name: string, profile: StoredProfile): Promise<void> {
    const next = { profiles: { ...(await readProfiles()), [name]: profile } };
    await writeFile(profilesFile, `${JSON.stringify(next, null, 2)}\n`);
  }

  /** Options of a run with the profiles file: the profile's URL counts, not OPERATE_URL. */
  function profiles(env: EnvOverrides = {}, options: CliOptions = {}): CliOptions {
    return { ...options, configFile: profilesFile, env: { OPERATE_URL: undefined, ...env } };
  }

  beforeAll(async () => {
    assertCliBuilt();
    // resolved, so paths printed by the CLI compare equal (macOS: /var → /private/var)
    workdir = await realpath(await makeTempDir('operate-it-bearer-'));
    configFile = join(workdir, 'config.json');
    profilesFile = join(workdir, 'profiles.json');
    // OPERATE_CONFIG names the file explicitly, so it must exist (an empty one: no profiles)
    await writeFile(configFile, '{"profiles":{}}\n');
    await writeFile(profilesFile, '{"profiles":{}}\n');
    topology = await startOAuthTopology(required(engine, 'an enabled engine'));
    // first: its expiry and the 30 s grace pass while the other tests run
    staleToken = (await directLogin(topology.issuer, CLIENTS.short, 'openid')).accessToken;
    ciToken = await clientCredentialsToken(topology.issuer, CLIENTS.ci, CI_CLIENT_SECRET);
    remember(staleToken, ciToken, CI_CLIENT_SECRET, GARBAGE, STRAY_PASSWORD);
    await writeProfile(PROFILE.fixed, {
      url: topology.url,
      auth: { type: 'bearer', tokenEnv: TOKEN_ENV },
    });
    cli = bindCli({
      url: topology.url,
      configFile,
      env: {
        // no token cache or user config may be read or written outside the suite's directory
        XDG_CONFIG_HOME: workdir,
        APPDATA: workdir,
        [TOKEN_ENV]: undefined,
      },
    });
  }, TOPOLOGY_START_TIMEOUT_MS);

  afterAll(async () => {
    await topology?.stop();
    await removeTempDir(workdir);
  });

  it('runs against a gateway that takes the tokens Keycloak issues without operate', async () => {
    const { url, issuer } = top();
    expect(claimsOf(ciToken)).toMatchObject({
      iss: issuer,
      azp: CLIENTS.ci,
      preferred_username: SERVICE_ACCOUNT,
    });
    expect(audiencesOf(ciToken)).toContain(AUDIENCE);
    const call = (authorization: string) => fetch(`${url}/version`, { headers: { authorization } });

    const authorized = await call(`Bearer ${ciToken}`);
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ version: ENGINES[top().engine].version });
    // the gateway takes the scheme as spelled: a pasted "bearer <token>" must be normalized
    const lowercase = await call(`bearer ${ciToken}`);
    expect(lowercase.status).toBe(401);
    expect(await lowercase.text()).toBe('Jwt is missing');
    const tampered = await call(`Bearer ${tamperedJwt(ciToken, { sub: 'someone-else-it' })}`);
    expect(tampered.status).toBe(401);
    expect(await tampered.text()).toBe('Jwt verification fails');
    const garbage = await call(`Bearer ${GARBAGE}`);
    expect(garbage.status).toBe(401);
  });

  it('completes bearer for --auth and the token flags in the shell completion', async () => {
    /** Candidate values of `operate __complete <words...>` (the completion scripts' protocol). */
    const complete = async (...words: string[]) => {
      const result = expectSuccess(await run(['__complete', ...words]));
      return result.stdout.split('\n').map((line) => line.split('\t')[0]);
    };
    expect(await complete('ping', globalFlag('auth'), '')).toContain('bearer');
    expect(await complete('process-definition', 'count', '--auth-')).toContain(
      globalFlag('auth-token-stdin'),
    );
    expect(await complete('config', 'set', PROFILE.tokenEnv, '--auth-')).toEqual(
      expect.arrayContaining(['--auth-token-env', globalFlag('auth-token-stdin')]),
    );
  });

  it('infers bearer from OPERATE_TOKEN alone and sends the token on every request', async () => {
    const env = { OPERATE_TOKEN: ciToken };
    const list = await run([...argv('process-definition list'), globalFlag('verbose')], { env });
    expect(expectSuccess(list).json<ProcessDefinition[]>()).toEqual(expect.any(Array));
    // one request, no token request: operate neither logs in nor refreshes
    expect(trace(list)).toEqual(['> GET <engine>/process-definition', '< 200']);
    expect(list.stderr).toMatch(MASKED_BEARER);

    const count = await run(countArgs(), { env: { ...env, OPERATE_AUTH: 'bearer' } });
    expect(expectSuccess(count).json<Count>()).toEqual({ count: expect.any(Number) });
    const api = await run(['api', 'GET', '/version'], { env });
    expect(expectSuccess(api).json()).toEqual({ version: ENGINES[top().engine].version });

    const ping = await run(['ping'], { env });
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
      url: top().url,
      reachable: true,
      auth: 'bearer',
      user: SERVICE_ACCOUNT,
      subject: claimsOf(ciToken).sub,
    });

    const show = await run(['config', 'show'], { env });
    expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
      values: {
        auth: { value: 'bearer', source: 'env' },
        token: { value: '***', source: 'env' },
      },
    });
  });

  it('reads the token from the first line of stdin with --auth-token-stdin', async () => {
    const explicit = await run(
      countArgs(globalFlag('auth'), 'bearer', globalFlag('auth-token-stdin')),
      { stdin: `${ciToken}\n` },
    );
    expect(expectSuccess(explicit).json<Count>()).toEqual({ count: expect.any(Number) });

    // the flag alone selects bearer; only the first line counts
    const inferred = await run(countArgs(globalFlag('auth-token-stdin'), globalFlag('verbose')), {
      stdin: `${ciToken}\r\nsecond line\n`,
    });
    expect(trace(expectSuccess(inferred))).toEqual([COUNT_REQUEST, '< 200']);
    expect(inferred.stderr).toMatch(MASKED_BEARER);

    // the flag beats OPERATE_TOKEN
    const precedence = await run(countArgs(globalFlag('auth-token-stdin')), {
      stdin: `${ciToken}\n`,
      env: { OPERATE_TOKEN: GARBAGE },
    });
    expectSuccess(precedence);
  });

  it('refuses an empty token on stdin and a second reader of stdin before any request', async () => {
    for (const stdin of ['', '\n', '\r\n']) {
      const empty = await run(countArgs(globalFlag('auth-token-stdin'), globalFlag('verbose')), {
        stdin,
      });
      expectError(empty, 'USAGE', 2);
      expect(empty.stderr).not.toMatch(SENT_REQUEST);
    }
    const body = await run(
      [
        ...argv('process-instance query', [], { body: '-' }),
        globalFlag('auth-token-stdin'),
        globalFlag('verbose'),
      ],
      { stdin: `${ciToken}\n` },
    );
    expectError(body, 'USAGE', 2);
    expect(body.stderr).not.toMatch(SENT_REQUEST);
    const password = await run(
      countArgs(
        globalFlag('auth-token-stdin'),
        globalFlag('auth-password-stdin'),
        globalFlag('verbose'),
      ),
      { stdin: `${ciToken}\n` },
    );
    expectError(password, 'USAGE', 2);
    expect(password.stderr).not.toMatch(SENT_REQUEST);
  });

  it('strips a pasted "Bearer " prefix and surrounding whitespace', async () => {
    const pasted = await run(countArgs(globalFlag('verbose')), {
      env: { OPERATE_TOKEN: `Bearer ${ciToken}` },
    });
    expect(trace(expectSuccess(pasted))).toEqual([COUNT_REQUEST, '< 200']);
    expect(pasted.stderr).toMatch(MASKED_BEARER);

    // the gateway refuses "bearer" in lower case (first test): operate sends the token alone
    const piped = await run(countArgs(globalFlag('auth-token-stdin')), {
      stdin: `  bearer ${ciToken}\t\r\n`,
    });
    expect(expectSuccess(piped).json<Count>()).toEqual({ count: expect.any(Number) });

    const preview = await run(
      countArgs(globalFlag('dry-run'), globalFlag('show-secrets')),
      { env: { OPERATE_TOKEN: ` BEARER ${ciToken} ` } },
      ciToken,
    );
    const { headers } = expectSuccess(preview).json<DryRunOutput>();
    expect(headerValue(headers, 'authorization')).toBe(`Bearer ${ciToken}`);
  });

  it('refuses a token that is not an RFC 6750 b64token without repeating it', async () => {
    for (const token of INVALID_TOKENS) {
      remember(token, ...token.split(/[\s=,]/));
      const result = await run(countArgs(globalFlag('verbose')), {
        env: { OPERATE_TOKEN: token },
      });
      expectError(result, 'CONFIG', 3);
      expect(result.stderr).not.toMatch(SENT_REQUEST);
    }
    const piped = await run(countArgs(globalFlag('auth-token-stdin'), globalFlag('verbose')), {
      stdin: `${INVALID_TOKENS[0] ?? ''}\n`,
    });
    expect(explanation(expectError(piped, 'CONFIG', 3))).toContain('--auth-token-stdin');
    expect(piped.stderr).not.toMatch(SENT_REQUEST);
  });

  it('fails with CONFIG before any request when bearer is selected without a token', async () => {
    const result = await run(['ping', globalFlag('auth'), 'bearer', globalFlag('verbose')]);
    const text = explanation(expectError(result, 'CONFIG', 3));
    expect(text).toContain('OPERATE_TOKEN');
    expect(text).toContain('--auth-token-stdin');
    expect(result.stderr).not.toMatch(SENT_REQUEST);

    const viaEnv = await run(['ping', globalFlag('verbose')], { env: { OPERATE_AUTH: 'bearer' } });
    expect(explanation(expectError(viaEnv, 'CONFIG', 3))).toContain('OPERATE_TOKEN');
    expect(viaEnv.stderr).not.toMatch(SENT_REQUEST);
  });

  it('masks the token in the --verbose trace and the --dry-run preview unless --show-secrets', async () => {
    const env = { OPERATE_TOKEN: ciToken };
    const masked = await run(countArgs(globalFlag('verbose')), { env });
    expect(expectSuccess(masked).stderr).toMatch(MASKED_BEARER);

    const revealed = await run(
      countArgs(globalFlag('verbose'), globalFlag('show-secrets')),
      { env },
      ciToken,
    );
    expect(expectSuccess(revealed).stderr).toMatch(revealedHeader(ciToken));
    // the secret check knows the token, so its checks of every other run are not vacuous
    expect(() => {
      expectHidden(revealed);
    }).toThrow(/stderr reveals a secret/);

    const preview = await run(countArgs(globalFlag('dry-run')), { env });
    const request = expectSuccess(preview).json<DryRunOutput>();
    expect(headerValue(request.headers, 'authorization')).toBe('Bearer ***');
    expect(request.curl).toMatch(MASKED_CURL);
    expect(preview.stderr).not.toMatch(SENT_REQUEST);

    const pingPreview = await run(['ping', globalFlag('dry-run')], { env });
    const pingRequest = expectSuccess(pingPreview).json<DryRunOutput>();
    expect(headerValue(pingRequest.headers, 'authorization')).toBe('Bearer ***');

    const shown = await run(
      countArgs(globalFlag('dry-run'), globalFlag('show-secrets')),
      { env },
      ciToken,
    );
    const { headers, curl } = expectSuccess(shown).json<DryRunOutput>();
    expect(headerValue(headers, 'authorization')).toBe(`Bearer ${ciToken}`);
    expect(curl).toContain(ciToken);
  });

  it('uses a profile whose tokenEnv config set wrote, and masks the token in config show', async () => {
    const set = await run(
      [
        'config',
        'set',
        PROFILE.tokenEnv,
        globalFlag('url'),
        top().url,
        globalFlag('auth'),
        'bearer',
        '--auth-token-env',
        TOKEN_ENV,
      ],
      profiles(),
    );
    // IT_TOKEN is not set in the environment of config set
    expect(expectSuccess(set).stderr).toMatch(/^Warning: .*--auth-token-env/m);
    expect((await readProfiles())[PROFILE.tokenEnv]?.auth).toEqual({
      type: 'bearer',
      tokenEnv: TOKEN_ENV,
    });
    if (process.platform !== 'win32') {
      expect((await stat(profilesFile)).mode & 0o777).toBe(0o600);
    }

    const withToken = profiles({ [TOKEN_ENV]: ciToken });
    const list = await run(
      [...argv('process-definition list'), ...profileArgs(PROFILE.tokenEnv)],
      withToken,
    );
    expect(expectSuccess(list).json<ProcessDefinition[]>()).toEqual(expect.any(Array));
    const ping = await run(['ping', ...profileArgs(PROFILE.tokenEnv)], withToken);
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
      url: top().url,
      reachable: true,
      auth: 'bearer',
    });

    const show = await run(['config', 'show', ...profileArgs(PROFILE.tokenEnv)], withToken);
    expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
      profile: PROFILE.tokenEnv,
      values: {
        url: { value: top().url, source: 'profile' },
        auth: { value: 'bearer', source: 'profile' },
        token: { value: '***', source: 'profile' },
      },
    });
    const table = await run(
      ['config', 'show', ...profileArgs(PROFILE.tokenEnv), '-o', 'table'],
      withToken,
    );
    expect(expectSuccess(table).stdout).toMatch(/^token\s+\*\*\*\s+profile\s*$/m);
    const revealed = await run(
      ['config', 'show', ...profileArgs(PROFILE.tokenEnv), globalFlag('show-secrets')],
      withToken,
      ciToken,
    );
    expect(expectSuccess(revealed).json<ConfigShowOutput>()).toMatchObject({
      values: { token: { value: ciToken } },
    });
  });

  it('fails with CONFIG naming an unset tokenEnv variable, unless OPERATE_TOKEN wins', async () => {
    for (const value of [undefined, '']) {
      const result = await run(
        ['ping', ...profileArgs(PROFILE.fixed), globalFlag('verbose')],
        profiles({ [TOKEN_ENV]: value }),
      );
      expect(explanation(expectError(result, 'CONFIG', 3))).toContain(TOKEN_ENV);
      expect(result.stderr).not.toMatch(SENT_REQUEST);
    }
    // OPERATE_TOKEN comes first, so the profile's variable is not read (like §15's passwordEnv)
    const override = await run(
      ['ping', ...profileArgs(PROFILE.fixed)],
      profiles({ OPERATE_TOKEN: ciToken }),
    );
    expect(expectSuccess(override).json<PingOutput>()).toMatchObject({ auth: 'bearer' });
    // and a garbage OPERATE_TOKEN is really what is sent
    const garbage = await run(
      countArgs(...profileArgs(PROFILE.fixed), globalFlag('verbose')),
      profiles({ [TOKEN_ENV]: ciToken, OPERATE_TOKEN: GARBAGE }),
    );
    expectError(garbage, 'UNAUTHORIZED', 4);
    expect(trace(garbage)).toEqual([COUNT_REQUEST, '< 401']);
  });

  it('stores a literal token from stdin with a warning; config unset removes single keys', async () => {
    const set = await run(
      [
        'config',
        'set',
        PROFILE.literal,
        globalFlag('url'),
        top().url,
        globalFlag('auth'),
        'bearer',
        globalFlag('auth-token-stdin'),
      ],
      profiles({}, { stdin: `${ciToken}\n` }),
    );
    expect(expectSuccess(set).stderr).toMatch(/^Warning: .*plain text/m);
    expect(set.stderr).toContain('--auth-token-env');
    expect((await readProfiles())[PROFILE.literal]?.auth).toEqual({
      type: 'bearer',
      token: ciToken,
    });
    const ping = await run(['ping', ...profileArgs(PROFILE.literal)], profiles());
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({ auth: 'bearer' });
    const edit = (...args: string[]) => run(['config', ...args], profiles());

    expectSuccess(await edit('unset', PROFILE.literal, 'token'));
    expect((await readProfiles())[PROFILE.literal]?.auth).toEqual({ type: 'bearer' });
    const missing = await run(
      ['ping', ...profileArgs(PROFILE.literal), globalFlag('verbose')],
      profiles(),
    );
    expectError(missing, 'CONFIG', 3);
    expect(missing.stderr).not.toMatch(SENT_REQUEST);

    expectSuccess(await edit('set', PROFILE.literal, '--auth-token-env', TOKEN_ENV));
    expect((await readProfiles())[PROFILE.literal]?.auth).toEqual({
      type: 'bearer',
      tokenEnv: TOKEN_ENV,
    });
    expectSuccess(await edit('unset', PROFILE.literal, 'tokenEnv'));
    expect((await readProfiles())[PROFILE.literal]?.auth).toEqual({ type: 'bearer' });

    expectSuccess(await edit('unset', PROFILE.literal, 'auth'));
    const profile = (await readProfiles())[PROFILE.literal];
    expect(profile).toMatchObject({ url: top().url });
    expect(profile).not.toHaveProperty('auth');
    // nothing is sent now, and the gateway says so
    const none = await run(
      countArgs(...profileArgs(PROFILE.literal), globalFlag('verbose')),
      profiles(),
    );
    expect(explanation(expectError(none, 'UNAUTHORIZED', 4))).toContain('Jwt is missing');
    expect(none.stderr).not.toMatch(ANY_AUTHORIZATION);
  });

  it('shows subject, issuer, audience and expiry in auth status, never the token', async () => {
    const claims = {
      type: 'bearer',
      command: null,
      cached: false,
      format: 'jwt',
      subject: claimsOf(ciToken).sub,
      user: SERVICE_ACCOUNT,
      issuer: top().issuer,
      audience: expect.arrayContaining([AUDIENCE]) as unknown,
      expiresAt: expiryIso(ciToken),
      expired: false,
    };
    const fromEnv = await run(['auth', 'status'], { env: { OPERATE_TOKEN: ciToken } });
    expect(expectSuccess(fromEnv).json<BearerStatusOutput>()).toEqual({
      ...claims,
      profile: null,
      source: 'env',
      origin: 'OPERATE_TOKEN',
    });
    const fromProfile = await run(
      ['auth', 'status', ...profileArgs(PROFILE.fixed)],
      profiles({ [TOKEN_ENV]: ciToken }),
    );
    expect(expectSuccess(fromProfile).json<BearerStatusOutput>()).toEqual({
      ...claims,
      profile: PROFILE.fixed,
      source: 'profile',
      origin: `${TOKEN_ENV} (auth.tokenEnv of profile "${PROFILE.fixed}")`,
    });
    // a piped token can be checked before it is used (design §18.6)
    const piped = await run(['auth', 'status', globalFlag('auth-token-stdin')], {
      stdin: `${ciToken}\n`,
      env: { OPERATE_TOKEN: GARBAGE },
    });
    expect(expectSuccess(piped).json<BearerStatusOutput>()).toEqual({
      ...claims,
      profile: null,
      source: 'flag',
      origin: '--auth-token-stdin',
    });
    const table = await run(['auth', 'status', '-o', 'table'], {
      env: { OPERATE_TOKEN: ciToken },
    });
    expect(expectSuccess(table).stdout).toMatch(new RegExp(`^issuer\\s+${top().issuer}\\s*$`, 'm'));
    expect(table.stdout).toMatch(new RegExp(`^expiresAt\\s+${expiryIso(ciToken)}\\s*$`, 'm'));

    // an opaque token has no claims to show, and is no reason to fail
    const opaque = await run(['auth', 'status'], { env: { OPERATE_TOKEN: GARBAGE } });
    expect(expectSuccess(opaque).json<BearerStatusOutput>()).toMatchObject({
      type: 'bearer',
      format: 'opaque',
      subject: null,
      issuer: null,
      audience: [],
      expiresAt: null,
      expired: false,
    });
  });

  it('refuses auth login and logout for bearer tokens, which are managed outside operate', async () => {
    const quick = profiles({ [TOKEN_ENV]: ciToken }, { timeoutMs: 30_000 });
    const login = await run(
      ['auth', 'login', ...profileArgs(PROFILE.fixed), '--no-browser', '--login-timeout', '5000'],
      quick,
    );
    expect(expectError(login, 'USAGE', 2).message).toContain('does not apply to bearer tokens');
    expect(login.stderr).not.toMatch(/^ {2}https?:\/\//m);
    const logout = await run(['auth', 'logout', ...profileArgs(PROFILE.fixed)], quick);
    expect(expectError(logout, 'USAGE', 2).message).toContain('does not apply to bearer tokens');
    // without a profile as well
    const envOnly = await run(['auth', 'logout'], { env: { OPERATE_TOKEN: ciToken } });
    expectError(envOnly, 'USAGE', 2);
  });

  it('explains a 401 for a tampered or garbage token and never prints the token', async () => {
    const tampered = tamperedJwt(ciToken, { sub: 'someone-else-it' });
    remember(tampered);
    const forged = await run(countArgs(globalFlag('verbose')), {
      env: { OPERATE_TOKEN: tampered },
    });
    const error = expectError(forged, 'UNAUTHORIZED', 4);
    expect(error.status).toBe(401);
    expect(explanation(error)).toContain('Jwt verification fails');
    expect(error.hint).toMatch(/rejected the bearer token from OPERATE_TOKEN/i);
    // a JWT: the hint names what to check in it; it has not expired, so not the expiry
    expect(error.hint).toContain(top().issuer);
    expect(error.hint).toContain(`expires at ${expiryIso(ciToken)}`);
    expect(error.hint).toContain('trusts the key that signed it');
    // no refresh, no second attempt
    expect(trace(forged)).toEqual([COUNT_REQUEST, '< 401']);

    const garbage = await run(countArgs(globalFlag('verbose')), {
      env: { OPERATE_TOKEN: GARBAGE },
    });
    const garbageError = expectError(garbage, 'UNAUTHORIZED', 4);
    expect(explanation(garbageError)).toContain('Jwt is not in the form');
    expect(garbageError.hint).toMatch(/rejected the bearer token from OPERATE_TOKEN/i);
    expect(trace(garbage)).toEqual([COUNT_REQUEST, '< 401']);

    const piped = await run(countArgs(globalFlag('auth-token-stdin')), { stdin: `${GARBAGE}\n` });
    expect(expectError(piped, 'UNAUTHORIZED', 4).hint).toMatch(
      /rejected the bearer token from --auth-token-stdin/i,
    );
  });

  it('explains a 403 for a token without the engine audience', async () => {
    const foreign = (await directLogin(top().issuer, CLIENTS.noAudience, 'openid')).accessToken;
    remember(foreign);
    expect(audiencesOf(foreign)).not.toContain(AUDIENCE);
    const result = await run(countArgs(globalFlag('verbose')), {
      env: { OPERATE_TOKEN: foreign },
    });
    const error = expectError(result, 'FORBIDDEN', 4);
    expect(error.status).toBe(403);
    expect(explanation(error)).toContain('Audiences in Jwt are not allowed');
    expect(error.hint).toMatch(/roles|scopes/i);
    expect(trace(result)).toEqual([COUNT_REQUEST, '< 403']);
  });

  it('refuses bearer together with an explicit Authorization header before any request', async () => {
    const flag = await run(
      ['ping', globalFlag('header'), 'Authorization: x', globalFlag('verbose')],
      { env: { OPERATE_TOKEN: ciToken } },
    );
    expect(explanation(expectError(flag, 'CONFIG', 3))).toContain('Authorization');
    expect(flag.stderr).not.toMatch(SENT_REQUEST);

    const other = 'other-token-it';
    remember(other);
    const headers = await run(
      countArgs(
        globalFlag('auth'),
        'bearer',
        globalFlag('auth-token-stdin'),
        globalFlag('verbose'),
      ),
      { stdin: `${ciToken}\n`, env: { OPERATE_HEADERS: `authorization: Bearer ${other}` } },
    );
    expect(explanation(expectError(headers, 'CONFIG', 3))).toContain('OPERATE_HEADERS');
    expect(headers.stderr).not.toMatch(SENT_REQUEST);
  });

  it('asks for an explicit --auth when a token and a username are both set', async () => {
    const env = {
      OPERATE_TOKEN: ciToken,
      OPERATE_USERNAME: 'operateit',
      OPERATE_PASSWORD: STRAY_PASSWORD,
    };
    const both = await run(countArgs(globalFlag('verbose')), { env });
    expect(explanation(expectError(both, 'CONFIG', 3))).toContain('--auth');
    expect(both.stderr).not.toMatch(SENT_REQUEST);
    const flags = await run(
      countArgs(globalFlag('auth-user'), 'operateit', globalFlag('auth-token-stdin')),
      { stdin: `${ciToken}\n` },
    );
    expectError(flags, 'CONFIG', 3);

    // an explicit type decides
    const bearer = await run(countArgs(globalFlag('auth'), 'bearer', globalFlag('verbose')), {
      env,
    });
    expect(trace(expectSuccess(bearer))).toEqual([COUNT_REQUEST, '< 200']);
    expect(bearer.stderr).toMatch(MASKED_BEARER);
    const viaEnv = await run(countArgs(), { env: { ...env, OPERATE_AUTH: 'bearer' } });
    expectSuccess(viaEnv);
    // --auth none switches it off: the gateway gets no token at all
    const none = await run(countArgs(globalFlag('auth'), 'none', globalFlag('verbose')), {
      env: { OPERATE_TOKEN: ciToken },
    });
    expect(explanation(expectError(none, 'UNAUTHORIZED', 4))).toContain('Jwt is missing');
    expect(none.stderr).not.toMatch(ANY_AUTHORIZATION);
    // config show reports a token the resolved type does not use
    for (const type of ['basic', 'none']) {
      const show = await run(['config', 'show', globalFlag('auth'), type], { env });
      expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
        values: {
          auth: { value: type, source: 'flag' },
          token: { value: '***', source: 'env', unused: expect.stringContaining(`--auth ${type}`) },
        },
      });
    }
  });

  it('never repeats a token typed in the wrong place, and sends nothing', async () => {
    // an opaque token in the form of a variable name (GitHub style)
    const opaque = 'tok_SECRETitabcdefghijklmnopqrstuvwxyz0123';
    remember(opaque);
    const auth = globalFlag('auth');
    const usage = [
      // before the command: commander takes the token for the command name
      await run([globalFlag('auth-token-stdin'), ciToken, ...countArgs()], { stdin: ciToken }),
      await run([auth, 'bearer', ciToken, ...countArgs()]),
      // after --auth bearer, and to auth status
      await run(countArgs(auth, 'bearer', ciToken, globalFlag('verbose'))),
      await run(['auth', 'status', ciToken]),
    ];
    for (const result of usage) {
      expectError(result, 'USAGE', 2);
      expect(result.stderr).not.toMatch(SENT_REQUEST);
    }
    expect(usage[1]?.errorJson().hint).toContain('--auth takes only the type');
    // the token as the auth type
    const typeErrors = [
      await run(countArgs(auth, `Bearer ${ciToken}`)),
      await run(countArgs(), { env: { OPERATE_AUTH: `Bearer ${ciToken}` } }),
    ];
    for (const result of typeErrors) {
      expect(expectError(result, 'CONFIG', 3).message).toBe(
        'Unsupported auth type (not one of none, basic, oauth, bearer)',
      );
    }
    // the token as the name of its variable: refused, nothing stored
    const before = await readFile(profilesFile, 'utf8');
    const named = await run(
      ['config', 'set', 'it-misnamed', auth, 'bearer', '--auth-token-env', opaque],
      profiles(),
    );
    expectError(named, 'CONFIG', 3);
    expect(await readFile(profilesFile, 'utf8')).toBe(before);
  });

  it('names an exported token that a typed profile does not use in its auth hints', async () => {
    await writeProfile('it-sso', {
      url: top().url,
      auth: { type: 'oauth', issuer: top().issuer, clientId: CLIENTS.public },
    });
    await writeProfile('it-basic', {
      url: top().url,
      auth: { type: 'basic', username: 'operateit', passwordEnv: 'IT_STRAY_PASSWORD' },
    });
    const env = { OPERATE_TOKEN: ciToken, IT_STRAY_PASSWORD: STRAY_PASSWORD };
    const note = 'A bearer token is set (from OPERATE_TOKEN) but not used';
    // OAuth without a login: LOGIN_REQUIRED, whose hint also points to the token
    const sso = await run(countArgs(...profileArgs('it-sso')), profiles(env));
    expect(expectError(sso, 'LOGIN_REQUIRED', 4).hint).toContain(note);
    // Basic auth: the gateway refuses the credentials; the hint names the unused token
    const basic = await run(countArgs(...profileArgs('it-basic')), profiles(env));
    expect(expectError(basic, 'UNAUTHORIZED', 4).hint).toContain(note);
    // following the hint sends the token
    const sent = await run(
      countArgs(...profileArgs('it-sso'), globalFlag('auth'), 'bearer'),
      profiles(env),
    );
    expect(expectSuccess(sent).json<Count>().count).toBeGreaterThanOrEqual(0);
    // auth status: OAuth or a bearer token; the hint says how to use the exported one
    const status = await run(['auth', 'status', ...profileArgs('it-basic')], profiles(env));
    expect(expectError(status, 'CONFIG', 3)).toMatchObject({
      message:
        'operate auth status needs OAuth or a bearer token, but profile "it-basic" uses basic',
      hint: expect.stringContaining('use it with OPERATE_AUTH=bearer'),
    });
  });

  it('sends a JWT that expired less than 30 s ago and explains the 401 with its expiry', async () => {
    const token = (await directLogin(top().issuer, CLIENTS.short, 'openid')).accessToken;
    remember(token);
    // expired at the gateway (1 s skew), but within operate's grace
    await sleep(Math.max(0, expiryOf(token) + GATEWAY_SKEW_MS - Date.now()));
    const result = await run(countArgs(globalFlag('verbose')), { env: { OPERATE_TOKEN: token } });
    expect(Date.now()).toBeLessThan(expiryOf(token) + EXPIRY_GRACE_MS);
    const error = expectError(result, 'UNAUTHORIZED', 4);
    expect(error.status).toBe(401);
    expect(explanation(error)).toContain('Jwt is expired');
    expect(error.hint).toMatch(/rejected the bearer token from OPERATE_TOKEN/i);
    // operate knows exp has passed, so the hint says so instead of a list of things to check
    expect(error.hint).toContain(`It expired at ${expiryIso(token)}`);
    expect(trace(result)).toEqual([COUNT_REQUEST, '< 401']);
  });

  it('refuses a JWT that expired more than 30 s ago with TOKEN_EXPIRED before sending it', async () => {
    // issued in beforeAll: usually the other tests have spent most of this wait
    await sleep(Math.max(0, expiryOf(staleToken) + EXPIRY_GRACE_MS + 2_000 - Date.now()));
    const expired = expiryIso(staleToken);
    const result = await run(countArgs(globalFlag('verbose')), {
      env: { OPERATE_TOKEN: staleToken },
    });
    const text = explanation(expectError(result, 'TOKEN_EXPIRED', 4));
    expect(text).toContain('OPERATE_TOKEN');
    expect(text).toContain(expired);
    expect(text).toMatch(/fetch a new one/i);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toMatch(SENT_REQUEST);

    const piped = await run(countArgs(globalFlag('auth-token-stdin'), globalFlag('verbose')), {
      stdin: `${staleToken}\n`,
    });
    expect(explanation(expectError(piped, 'TOKEN_EXPIRED', 4))).toContain('--auth-token-stdin');
    expect(piped.stderr).not.toMatch(SENT_REQUEST);

    const fromProfile = await run(
      countArgs(...profileArgs(PROFILE.fixed), globalFlag('verbose')),
      profiles({ [TOKEN_ENV]: staleToken }),
    );
    expect(explanation(expectError(fromProfile, 'TOKEN_EXPIRED', 4))).toContain(TOKEN_ENV);
    expect(fromProfile.stderr).not.toMatch(SENT_REQUEST);

    const ping = await run(['ping', globalFlag('verbose')], { env: { OPERATE_TOKEN: staleToken } });
    expectError(ping, 'TOKEN_EXPIRED', 4);
    expect(ping.stderr).not.toMatch(SENT_REQUEST);
    // a preview sends nothing either, so it shows the request and says why it would fail
    const preview = await run(countArgs(globalFlag('dry-run')), {
      env: { OPERATE_TOKEN: staleToken },
    });
    const request = expectSuccess(preview).json<DryRunOutput>();
    expect(headerValue(request.headers, 'authorization')).toBe('Bearer ***');
    expect(preview.stderr).toMatch(/^Note: .*expired/m);
    expect(preview.stderr).not.toMatch(SENT_REQUEST);
    // auth status shows the token's claims, then fails the same way
    const status = await run(['auth', 'status'], { env: { OPERATE_TOKEN: staleToken } });
    expectError(status, 'TOKEN_EXPIRED', 4);
    expect(status.json<BearerStatusOutput>()).toMatchObject({
      format: 'jwt',
      user: USER.username,
      expiresAt: expired,
      expired: true,
    });
  });
  describe('token commands', () => {
    /**
     * The token command: the client credentials grant of `operate-ci`, run by the shell. It logs
     * every run and every token it prints (so no output may contain one); IT_FAIL makes it fail,
     * IT_GARBAGE_FIRST prints a token the gateway rejects on its first run.
     */
    const SCRIPT = `import { appendFileSync, readFileSync } from 'node:fs';
const { IT_RUNS, IT_TOKENS, IT_ENDPOINT, IT_CLIENT, IT_SECRET } = process.env;
const runs = (() => { try { return readFileSync(IT_RUNS, 'utf8').split('\\n').filter(Boolean).length; } catch { return 0; } })();
appendFileSync(IT_RUNS, 'run\\n');
if (process.env.IT_FAIL) { console.error('the token endpoint is unreachable (it)'); process.exit(7); }
let token = 'garbage-token-it';
if (!process.env.IT_GARBAGE_FIRST || runs > 0) {
  const answer = await fetch(IT_ENDPOINT, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: IT_CLIENT, client_secret: IT_SECRET }) });
  token = (await answer.json()).access_token;
}
appendFileSync(IT_TOKENS, token + '\\n');
console.log(token);
`;
    let repo = '';
    let runsFile = '';
    let tokensFile = '';
    /** The command line: the script by its full path, so it runs in every directory. */
    const command = () => `${JSON.stringify(process.execPath)} ${join(repo, 'token.mjs')}`;

    const runs = async () =>
      (await readFile(runsFile, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;

    /** The variables of the command (passed through operate's environment). */
    function commandEnv(extra: EnvOverrides = {}): EnvOverrides {
      return {
        IT_RUNS: runsFile,
        IT_TOKENS: tokensFile,
        IT_ENDPOINT: endpointsOf(top().issuer).token,
        IT_CLIENT: CLIENTS.ci,
        IT_SECRET: CI_CLIENT_SECRET,
        ...extra,
      };
    }

    /**
     * Runs in the repository without OPERATE_CONFIG and OPERATE_URL, so the project file counts;
     * checks that no output contains a token the command printed.
     */
    async function inRepo(args: readonly string[], extra: EnvOverrides = {}, directory = 'src') {
      const result = await cli(args, {
        timeoutMs: RUN_TIMEOUT_MS,
        cwd: join(repo, directory),
        env: commandEnv({ OPERATE_CONFIG: undefined, OPERATE_URL: undefined, ...extra }),
      });
      remember(...(await readFile(tokensFile, 'utf8').catch(() => '')).split('\n').filter(Boolean));
      expectHidden(result);
      return result;
    }

    beforeAll(async () => {
      const dir = required(workdir, 'the work directory');
      repo = join(dir, 'repo');
      await mkdir(join(repo, '.git'), { recursive: true });
      await mkdir(join(repo, 'src'), { recursive: true });
      await mkdir(join(repo, 'docs'), { recursive: true });
      await writeFile(join(repo, 'token.mjs'), SCRIPT);
      runsFile = join(dir, 'token-runs.log');
      tokensFile = join(dir, 'token-values.log');
    });

    it('fetches the token for a profile of the project file and reuses it', async () => {
      const set = await inRepo([
        'config',
        'set',
        'it-command',
        '--project',
        '--url',
        top().url,
        '--auth',
        'bearer',
      ]);
      expect(expectSuccess(set).stderr).toContain(
        `Created the project file ${join(repo, '.operate.json')}`,
      );
      const env = { OPERATE_TOKEN_COMMAND: command() };
      const count = await inRepo(countArgs(), env);
      expect(expectSuccess(count).json<Count>().count).toBeGreaterThanOrEqual(0);
      expect(await runs()).toBe(1);
      // the next call takes the cached JWT
      const verbose = await inRepo(countArgs(globalFlag('verbose')), env);
      expectSuccess(verbose);
      expect(verbose.stderr).toContain(
        '* Using the token of the bearer token command of OPERATE_TOKEN_COMMAND, cached until it expires',
      );
      expect(verbose.stderr).toMatch(MASKED_BEARER);
      expect(await runs()).toBe(1);
      const status = expectSuccess(
        await inRepo(['auth', 'status'], env),
      ).json<BearerStatusOutput>();
      expect(status).toMatchObject({
        profile: 'it-command',
        source: 'env',
        origin: 'OPERATE_TOKEN_COMMAND',
        command: command(),
        cached: true,
        format: 'jwt',
        user: SERVICE_ACCOUNT,
      });
    });

    it('shares the cached token across the directories of the repository', async () => {
      const before = await runs();
      const env = { OPERATE_TOKEN_COMMAND: command() };
      expectSuccess(await inRepo(countArgs(), env, 'docs'));
      expect(await runs()).toBe(before);
    });

    it('refuses a project file that names a variable for the token, before any request', async () => {
      const path = join(repo, 'docs', '.operate.json');
      const file = {
        profiles: { it: { url: top().url, auth: { type: 'bearer', tokenEnv: 'IT_SECRET' } } },
      };
      await writeFile(path, JSON.stringify(file));
      const refused = await inRepo(countArgs(), { OPERATE_PROFILE: 'it' }, 'docs');
      expect(expectError(refused, 'CONFIG', 3).message).toContain(
        'profile "it" sets auth.tokenEnv;',
      );
      expect(refused.stderr).not.toMatch(SENT_REQUEST);
      await rm(path);
    });

    it('runs the command again after a 401 and retries with the new token', async () => {
      const retryRuns = join(required(workdir, 'the work directory'), 'retry-runs.log');
      const result = await inRepo(countArgs(globalFlag('verbose')), {
        OPERATE_TOKEN_COMMAND: command(),
        OPERATE_URL: top().url,
        OPERATE_CONFIG: configFile,
        IT_GARBAGE_FIRST: '1',
        IT_RUNS: retryRuns,
      });
      expectSuccess(result);
      const answers = trace(result).filter((event) => event.startsWith('< '));
      expect(answers).toEqual(['< 401', '< 200']);
      expect((await readFile(retryRuns, 'utf8')).split('\n').filter(Boolean)).toHaveLength(2);
    });

    it('reports a failing command as LOGIN_FAILED with the end of its stderr', async () => {
      const env = {
        OPERATE_TOKEN_COMMAND: command(),
        OPERATE_URL: top().url,
        OPERATE_CONFIG: configFile,
        IT_FAIL: '1',
      };
      // the token of the previous test is still cached: logout drops it
      const logout = expectSuccess(await inRepo(['auth', 'logout'], env));
      expect(logout.json()).toMatchObject({ profile: null, removed: true, revoked: null });
      const result = await inRepo(countArgs(), env);
      const error = expectError(result, 'LOGIN_FAILED', 4);
      expect(error.message).toBe(
        'The bearer token command (OPERATE_TOKEN_COMMAND) failed with exit code 7: the token endpoint is unreachable (it)',
      );
      expect(result.stderr).not.toMatch(SENT_REQUEST);
    });
  });
});
