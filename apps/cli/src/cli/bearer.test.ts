/**
 * Bearer tokens from elsewhere end to end through `run()` (design §18): flag, environment and
 * profile sources, the header on the wire, JWT expiry, masking, the 401/403 hints, `auth status`,
 * `auth login|logout`, `config set|show|unset|list`, mistyped flags and completion.
 */

import { describe, expect, it } from 'vitest';
import { jwtWith, NOW_S, VALID_CLAIMS } from '../../test/support/bearer.js';
import { BASE_URL, fakeServer, json } from '../../test/support/fake-fetch.js';
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from '../../test/support/fake-runtime.js';
import { cachedLogin, cacheText, oauthProfiles, TOKEN_FILE } from '../../test/support/oauth.js';
import { usageError } from '../errors.js';
import { run } from './run.js';

const JWT = jwtWith(VALID_CLAIMS);
const EXPIRED = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 31 });

function server(status = 200) {
  const reply = () =>
    status === 200
      ? json([])
      : new Response('Jwt is expired', { status, headers: { 'content-type': 'text/plain' } });
  return fakeServer()
    .on('GET', '/task', reply)
    .on('POST', '/message', reply)
    .on('GET', '/version', json({ version: '7.24.0' }))
    .on('GET', '/engine', json([{ name: 'default' }]));
}

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}, status = 200) {
  const fake = server(status);
  const outcome = await execute(run, args, fakeRuntime({ fetch: fake.fetch, ...options }));
  return { ...outcome, requests: fake.requests };
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error;
}

function profiles(value: Record<string, unknown>, defaultProfile = 'p'): string {
  return JSON.stringify({ defaultProfile, profiles: value });
}

describe('bearer token sources', () => {
  it('sends OPERATE_TOKEN as Authorization: Bearer, and nothing else', async () => {
    const result = await cli(['task', 'list'], { env: { OPERATE_TOKEN: 'opaque-token' } });
    expect(result).toMatchObject({ code: 0, stdout: '[]\n', stderr: '' });
    expect(result.requests.map((request) => request.headers.authorization)).toEqual([
      'Bearer opaque-token',
    ]);
  });

  it('reads the first line of stdin for --auth-token-stdin, CR/LF and "Bearer " stripped', async () => {
    const result = await cli(['task', 'list', '--auth-token-stdin'], {
      stdin: 'Bearer abc.def\r\nsecond line\n',
    });
    expect(result.code).toBe(0);
    expect(result.requests[0]?.headers.authorization).toBe('Bearer abc.def');
    const before = await cli(['--auth-token-stdin', 'task', 'list'], { stdin: 'xyz' });
    expect(before.requests[0]?.headers.authorization).toBe('Bearer xyz');
  });

  it('takes the token from the variable named by the profile, or the stored token', async () => {
    const files = {
      [CONFIG_PATH]: profiles({
        p: { auth: { type: 'bearer', tokenEnv: 'CI_TOKEN' } },
        lit: { auth: { type: 'bearer', token: 'stored' } },
      }),
    };
    const fromVariable = await cli(['task', 'list'], { files, env: { CI_TOKEN: 'ci' } });
    expect(fromVariable.requests[0]?.headers.authorization).toBe('Bearer ci');
    const stored = await cli(['task', 'list', '--profile', 'lit'], { files });
    expect(stored.requests[0]?.headers.authorization).toBe('Bearer stored');
    const unset = await cli(['task', 'list'], { files });
    expect(unset.code).toBe(3);
    expect(errorOf(unset.stderr).message).toBe(
      'The token variable CI_TOKEN (auth.tokenEnv of profile "p") is not set or empty',
    );
    expect(unset.requests).toEqual([]);
  });

  it('refuses an empty token, a terminal and a second reader of stdin before sending', async () => {
    const empty = await cli(['task', 'list', '--auth-token-stdin'], { stdin: '  \n' });
    expect(empty.code).toBe(2);
    expect(errorOf(empty.stderr)).toMatchObject({
      code: 'USAGE',
      message: '--auth-token-stdin read an empty token',
      hint: 'Pipe the token into the command, e.g. gcloud auth print-access-token | operate ... --auth-token-stdin.',
    });
    // the Node runtime refuses a terminal with a USAGE error (src/bin/node-runtime.test.ts)
    const tty = fakeRuntime();
    const terminalRuntime = {
      ...tty,
      readStdin: () =>
        Promise.reject(usageError('stdin is a terminal; pipe the input into the command')),
    };
    const terminal = {
      ...(await execute(run, ['task', 'list', '--auth-token-stdin'], terminalRuntime)),
      requests: [],
    };
    expect(terminal.code).toBe(2);
    expect(errorOf(terminal.stderr).message).toBe(
      'stdin is a terminal; pipe the input into the command',
    );
    const body = await cli(['message', 'correlate', '--body', '-', '--auth-token-stdin'], {
      stdin: '{}',
    });
    expect(errorOf(body.stderr).message).toBe('--auth-token-stdin and --body - both read stdin');
    const both = await cli(['task', 'list', '--auth-token-stdin', '--auth-password-stdin'], {
      stdin: 't',
    });
    expect(errorOf(both.stderr).message).toBe(
      '--auth-password-stdin and --auth-token-stdin both read stdin',
    );
    for (const result of [empty, terminal, body, both]) expect(result.requests).toEqual([]);
  });

  it('refuses a token next to an Authorization header', async () => {
    const result = await cli(['task', 'list', '-H', 'Authorization: Bearer other'], {
      env: { OPERATE_TOKEN: 't' },
    });
    expect(result.code).toBe(3);
    expect(errorOf(result.stderr).message).toBe(
      'Bearer auth and an Authorization header are both configured',
    );
    const env = await cli(['task', 'list', '--auth', 'bearer'], {
      env: { OPERATE_TOKEN: 't', OPERATE_HEADERS: 'Authorization: Basic x' },
    });
    expect(errorOf(env.stderr).hint).toContain('from OPERATE_HEADERS');
  });

  it('refuses a username and a token without a type', async () => {
    const result = await cli(['task', 'list', '--auth-user', 'demo'], {
      env: { OPERATE_TOKEN: 't', OPERATE_PASSWORD: 'pw' },
    });
    expect(result.code).toBe(3);
    expect(errorOf(result.stderr).message).toBe(
      'Both Basic auth and a bearer token are configured, but no auth type says which one to use',
    );
    const basic = await cli(['task', 'list', '--auth-user', 'demo', '--auth', 'basic'], {
      env: { OPERATE_TOKEN: 't', OPERATE_PASSWORD: 'demo' },
    });
    expect(basic.requests[0]?.headers.authorization).toBe('Basic ZGVtbzpkZW1v');
    const none = await cli(['task', 'list', '--auth', 'none'], { env: { OPERATE_TOKEN: 't' } });
    expect(none.requests[0]?.headers.authorization).toBeUndefined();
  });
});

describe('JWT expiry', () => {
  it('fails with TOKEN_EXPIRED (exit 4) before sending an expired JWT', async () => {
    const result = await cli(['task', 'list'], { env: { OPERATE_TOKEN: EXPIRED } });
    expect(result.code).toBe(4);
    expect(result.requests).toEqual([]);
    expect(errorOf(result.stderr)).toEqual({
      code: 'TOKEN_EXPIRED',
      exitCode: 4,
      message: 'The bearer token from OPERATE_TOKEN expired at 2023-11-14T22:12:49.000Z',
      hint: "operate never refreshes bearer tokens: the bearer token from OPERATE_TOKEN expired at 2023-11-14T22:12:49.000Z; fetch a new one (e.g. with your identity provider's CLI) and set OPERATE_TOKEN.",
    });
    const ping = await cli(['ping', '--auth-token-stdin'], { stdin: EXPIRED });
    expect(errorOf(ping.stderr).hint).toContain('and pipe it into --auth-token-stdin.');
  });

  it('sends a JWT that expired less than 30 s ago (clock skew)', async () => {
    const recent = jwtWith({ exp: NOW_S - 30 });
    const result = await cli(['task', 'list'], { env: { OPERATE_TOKEN: recent } });
    expect(result.code).toBe(0);
    expect(result.requests).toHaveLength(1);
  });
});

describe('bearer tokens in dry-run, verbose and ping', () => {
  it('masks the token in dry-run previews and curl unless --show-secrets', async () => {
    const env = { OPERATE_TOKEN: JWT };
    const preview = await cli(['task', 'list', '--dry-run'], { env });
    expect(JSON.parse(preview.stdout)).toMatchObject({
      headers: { Authorization: 'Bearer ***' },
    });
    expect(preview.stdout).not.toContain(JWT);
    const curl = await cli(['task', 'list', '--dry-run', '-o', 'table'], { env });
    expect(curl.stdout).toContain("-H 'Authorization: Bearer ***'");
    const shown = await cli(['task', 'list', '--dry-run', '--show-secrets'], { env });
    expect(JSON.parse(shown.stdout)).toMatchObject({
      headers: { Authorization: `Bearer ${JWT}` },
    });
    expect(preview.requests).toEqual([]);
  });

  it('notes in a dry-run that an expired JWT would fail', async () => {
    const result = await cli(['task', 'list', '--dry-run'], { env: { OPERATE_TOKEN: EXPIRED } });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe(
      'Note: The bearer token from OPERATE_TOKEN expired at 2023-11-14T22:12:49.000Z: the request would fail with TOKEN_EXPIRED. Fetch a new one and set OPERATE_TOKEN.\n',
    );
  });

  it('masks the token in the verbose trace', async () => {
    const result = await cli(['task', 'list', '--verbose'], { env: { OPERATE_TOKEN: 'secret.t' } });
    expect(result.stderr).toContain('> Authorization: Bearer ***\n');
    expect(result.stderr).not.toContain('secret.t');
  });

  it('pings with auth bearer and the user and subject of a JWT', async () => {
    const jwt = await cli(['ping'], { env: { OPERATE_TOKEN: JWT } });
    expect(JSON.parse(jwt.stdout)).toMatchObject({
      auth: 'bearer',
      user: 'alice',
      subject: VALID_CLAIMS.sub,
    });
    const opaque = JSON.parse(
      (await cli(['ping'], { env: { OPERATE_TOKEN: 'op' } })).stdout,
    ) as Record<string, unknown>;
    expect(opaque.auth).toBe('bearer');
    expect(opaque).not.toHaveProperty('subject');
    expect(opaque).not.toHaveProperty('user');
  });

  it('warns about a token over plain http beyond loopback, not in a dry-run', async () => {
    const env = { OPERATE_TOKEN: 't', OPERATE_URL: 'http://camunda.intranet:8080/engine-rest' };
    const fake = fakeServer('http://camunda.intranet:8080/engine-rest').on(
      'GET',
      '/task',
      json([]),
    );
    const result = await execute(run, ['task', 'list'], fakeRuntime({ fetch: fake.fetch, env }));
    expect(result.stderr).toBe(
      'Warning: operate sends the bearer token over plain http to camunda.intranet:8080; anyone on the network path can read and reuse it. Use https:// for the engine URL (RFC 6750 §5.3).\n',
    );
    const dry = await execute(run, ['task', 'list', '--dry-run'], fakeRuntime({ env }));
    expect(dry.stderr).toBe('');
  });
});

describe('a rejected bearer token', () => {
  it('explains a 401 without retrying', async () => {
    const result = await cli(['task', 'list'], { env: { OPERATE_TOKEN: JWT } }, 401);
    expect(result.code).toBe(4);
    expect(result.requests).toHaveLength(1);
    const error = errorOf(result.stderr);
    expect(error).toMatchObject({ code: 'UNAUTHORIZED', engineMessage: 'Jwt is expired' });
    expect(error.hint).toContain(
      'the engine rejected the bearer token from OPERATE_TOKEN (a JWT: subject',
    );
    expect(error.hint).toContain(
      "fetch a new token (e.g. with your identity provider's CLI) and set OPERATE_TOKEN",
    );
  });

  it('explains a 403 with missing roles or scopes', async () => {
    const result = await cli(['task', 'list'], { env: { OPERATE_TOKEN: 'op' } }, 403);
    expect(result.code).toBe(4);
    expect(errorOf(result.stderr)).toMatchObject({ code: 'FORBIDDEN' });
    expect(errorOf(result.stderr).hint).toContain('lacks the roles or scopes this operation needs');
  });
});

describe('operate auth with a bearer token', () => {
  it('shows the source and the claims of a JWT without the token', async () => {
    const result = await cli(['auth', 'status'], { env: { OPERATE_TOKEN: JWT } });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      type: 'bearer',
      profile: null,
      source: 'env',
      origin: 'OPERATE_TOKEN',
      command: null,
      cached: false,
      format: 'jwt',
      subject: VALID_CLAIMS.sub,
      user: 'alice',
      issuer: VALID_CLAIMS.iss,
      audience: ['engine-rest', 'account'],
      expiresAt: '2023-11-14T23:13:20.000Z',
      expired: false,
    });
    expect(result.stdout + result.stderr).not.toContain(JWT);
    expect(result.requests).toEqual([]);
  });

  it('shows a piped token', async () => {
    const result = await cli(['auth', 'status', '--auth-token-stdin'], { stdin: `${JWT}\n` });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      source: 'flag',
      origin: '--auth-token-stdin',
    });
    const oauth = {
      [CONFIG_PATH]: profiles({
        p: { auth: { type: 'oauth', issuer: 'https://login.example.com/realms/x', clientId: 'c' } },
      }),
    };
    const refused = await cli(['auth', 'status', '--auth-token-stdin'], {
      stdin: 't',
      files: oauth,
    });
    expect(errorOf(refused.stderr)).toMatchObject({
      message:
        '--auth-token-stdin reads a bearer token, but OAuth is selected by the auth.type of profile "p"',
      // auth commands have no --auth option: the hint names the variable
      hint: 'Drop --auth-token-stdin, or select bearer auth with OPERATE_AUTH=bearer.',
    });
    const followed = await cli(['auth', 'status', '--auth-token-stdin'], {
      stdin: `${JWT}\n`,
      files: oauth,
      env: { OPERATE_AUTH: 'bearer' },
    });
    expect(followed.code).toBe(0);
    expect(JSON.parse(followed.stdout)).toMatchObject({
      source: 'flag',
      subject: VALID_CLAIMS.sub,
    });
    // a Basic profile: the error is about the piped token, not "needs OAuth"
    const basic = {
      [CONFIG_PATH]: profiles({ p: { auth: { type: 'basic', username: 'u', passwordEnv: 'PW' } } }),
    };
    const piped = await cli(['auth', 'status', '--auth-token-stdin'], { stdin: 't', files: basic });
    expect(errorOf(piped.stderr).message).toBe(
      '--auth-token-stdin reads a bearer token, but Basic auth is selected by the auth.type of profile "p"',
    );
  });

  it('shows an opaque token of a profile as a table', async () => {
    const files = { [CONFIG_PATH]: profiles({ p: { auth: { type: 'bearer', token: 'op' } } }) };
    const result = await cli(['auth', 'status', '-o', 'table'], { files });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('origin     auth.token of profile "p"');
    expect(result.stdout).toMatch(/format +opaque/);
    expect(result.stdout).toMatch(/expired +false/);
  });

  it('prints the view of an expired JWT and exits with TOKEN_EXPIRED', async () => {
    const result = await cli(['auth', 'status'], { env: { OPERATE_TOKEN: EXPIRED } });
    expect(result.code).toBe(4);
    expect(JSON.parse(result.stdout)).toMatchObject({
      expired: true,
      expiresAt: '2023-11-14T22:12:49.000Z',
    });
    expect(errorOf(result.stderr).code).toBe('TOKEN_EXPIRED');
  });

  it('refuses auth login and auth logout: operate manages no bearer token', async () => {
    const login = await cli(['auth', 'login'], { env: { OPERATE_TOKEN: 't' } });
    expect(login.code).toBe(2);
    expect(errorOf(login.stderr)).toMatchObject({
      code: 'USAGE',
      message: 'operate auth login does not apply to bearer tokens',
    });
    expect(errorOf(login.stderr).hint).toContain('never logs in, refreshes or stores it');
    const files = {
      [CONFIG_PATH]: profiles({ p: { auth: { type: 'bearer', tokenEnv: 'UNSET' } } }),
    };
    const unresolved = await cli(['auth', 'login'], { files });
    expect(errorOf(unresolved.stderr).message).toBe(
      'operate auth login does not apply to bearer tokens',
    );
    const logout = await cli(['auth', 'logout'], { files });
    expect(logout.code).toBe(2);
    expect(errorOf(logout.stderr)).toMatchObject({
      message: 'operate auth logout does not apply to bearer tokens',
      hint: 'operate stores no bearer token, so there is nothing to log out (bearer auth is selected by the auth.type of profile "p"); `operate config unset p auth` removes that setting. The token stays valid at the engine until it expires; revoke it with the tool that issued it.',
    });
    const env = await cli(['auth', 'logout'], { env: { OPERATE_TOKEN: 't' } });
    expect(errorOf(env.stderr).hint).toBe(
      'operate stores no bearer token, so there is nothing to log out (bearer auth is selected by a token from OPERATE_TOKEN without an auth type); unset OPERATE_TOKEN to stop sending it. The token stays valid at the engine until it expires; revoke it with the tool that issued it.',
    );
    for (const result of [login, unresolved, logout, env])
      expect(result.runtime.browserUrls).toEqual([]);
  });

  it('names OPERATE_AUTH=bearer, not the OAuth profile, as what blocks login and logout', async () => {
    const files = {
      [CONFIG_PATH]: profiles({
        sso: {
          auth: { type: 'oauth', issuer: 'https://login.example.com/realms/x', clientId: 'c' },
        },
        plain: {},
      }),
    };
    const env = { OPERATE_AUTH: 'bearer' };
    const login = await cli(['auth', 'login', '--profile', 'sso'], { files, env });
    expect(errorOf(login.stderr).hint).toMatch(/^Bearer auth is selected by OPERATE_AUTH=bearer: /);
    expect(errorOf(login.stderr).hint).toContain(
      'To log in with OAuth instead, unset OPERATE_AUTH so that the auth settings of profile "sso" apply.',
    );
    const logout = await cli(['auth', 'logout', '--profile', 'sso'], { files, env });
    expect(errorOf(logout.stderr).hint).toBe(
      'operate stores no bearer token, so there is nothing to log out (bearer auth is selected by OPERATE_AUTH=bearer); unset OPERATE_AUTH to use the auth settings of profile "sso". The token stays valid at the engine until it expires; revoke it with the tool that issued it.',
    );
    // a token without a type and a profile without auth: nothing to unset in the profile
    const token = { OPERATE_TOKEN: 't' };
    const plain = await cli(['auth', 'logout', '--profile', 'plain'], { files, env: token });
    expect(errorOf(plain.stderr).hint).toContain('unset OPERATE_TOKEN to stop sending it');
    expect(errorOf(plain.stderr).hint).not.toContain('config unset');
    const inferred = await cli(['auth', 'login', '--profile', 'plain'], { files, env: token });
    expect(errorOf(inferred.stderr).hint).toContain(
      'For an OAuth login run by operate: unset OPERATE_TOKEN and configure OAuth: operate config set plain --auth oauth',
    );
    const anonymous = await cli(['auth', 'login'], { env: { ...env, ...token } });
    expect(errorOf(anonymous.stderr).hint).toContain(
      'the auth settings of the configuration apply',
    );
  });

  it('removes the OAuth login when config set switches the profile to a bearer token', async () => {
    const files = { [CONFIG_PATH]: oauthProfiles(), [TOKEN_FILE]: cacheText(cachedLogin(0)) };
    const args = ['config', 'set', 'p', '--auth', 'bearer', '--auth-token-env', 'CI_TOKEN'];
    const result = await cli(args, { files, env: { CI_TOKEN: 't' } });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      `Removed the OAuth login of profile "p" for its previous settings (${TOKEN_FILE}); it was not revoked.\n`,
    );
    expect(fileText(result.runtime, TOKEN_FILE)).toBeUndefined();
  });

  it('says that auth status needs OAuth or a bearer token, and how to use one that is set', async () => {
    const result = await cli(['auth', 'status'], {
      env: { OPERATE_USERNAME: 'demo', OPERATE_PASSWORD: 'x' },
    });
    expect(errorOf(result.stderr).message).toBe(
      'operate auth status needs OAuth or a bearer token, but the configuration uses basic',
    );
    const files = {
      [CONFIG_PATH]: profiles({
        b2: { auth: { type: 'basic', username: 'demo', passwordEnv: 'CI_PW' } },
        nn: { auth: { type: 'none' } },
        offp: { auth: { type: 'none', tokenEnv: 'CI_T' } },
      }),
    };
    const status = async (profile: string, env: Record<string, string>) =>
      errorOf((await cli(['auth', 'status', '--profile', profile], { files, env })).stderr);
    expect(await status('b2', { CI_PW: 'x', OPERATE_TOKEN: 'abc' })).toEqual({
      code: 'CONFIG',
      exitCode: 3,
      message: 'operate auth status needs OAuth or a bearer token, but profile "b2" uses basic',
      hint: 'A bearer token is set (from OPERATE_TOKEN) but not used: Basic auth is selected by the auth.type of profile "b2"; use it with OPERATE_AUTH=bearer.',
    });
    // the password variable is not set: still about the token, not about the password
    expect((await status('b2', { OPERATE_TOKEN: 'abc' })).hint).toBe(
      'A bearer token is set (from OPERATE_TOKEN) but not used: Basic auth is selected by the auth.type of profile "b2"; use it with OPERATE_AUTH=bearer.',
    );
    expect((await status('nn', { OPERATE_TOKEN: 'abc' })).hint).toBe(
      'A bearer token is set (from OPERATE_TOKEN) but not used: bearer auth is switched off by the auth.type of profile "nn"; use it with OPERATE_AUTH=bearer.',
    );
    expect((await status('offp', { CI_T: 'abc' })).hint).toBe(
      'Bearer auth is switched off by the auth.type of profile "offp". Switch it on: operate config set offp --auth bearer',
    );
    expect((await status('offp', { CI_T: 'abc', OPERATE_AUTH: 'none' })).hint).toBe(
      'Bearer auth is switched off by OPERATE_AUTH=none. Switch it on: OPERATE_AUTH=bearer',
    );
    // following the hints works
    const followed = await cli(['auth', 'status', '--profile', 'b2'], {
      files,
      env: { CI_PW: 'x', OPERATE_TOKEN: 'abc', OPERATE_AUTH: 'bearer' },
    });
    expect(followed.code).toBe(0);
    expect(JSON.parse(followed.stdout)).toMatchObject({ type: 'bearer', origin: 'OPERATE_TOKEN' });
  });
});

describe('operate config with a bearer token', () => {
  it('stores the name of the variable and warns when it is not set, without naming it', async () => {
    const result = await cli(['config', 'set', 'ci', '--auth-token-env', 'CI_ENGINE_TOKEN']);
    expect(result.code).toBe(0);
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? '{}')).toEqual({
      defaultProfile: 'ci',
      profiles: { ci: { auth: { type: 'bearer', tokenEnv: 'CI_ENGINE_TOKEN' } } },
    });
    expect(result.stderr).toBe(
      'Warning: the variable named by --auth-token-env is not set in this environment. Pass the name of a variable that holds the token (e.g. CI_ENGINE_TOKEN), never the token itself; commands read it when they run.\n',
    );
    const set = await cli(['config', 'set', 'ci', '--auth', 'bearer', '--auth-token-env', 'X'], {
      env: { X: 'value' },
    });
    expect(set.stderr).toBe('');
  });

  it('stores a token from stdin with a plain text warning and prints it masked', async () => {
    const result = await cli(['config', 'set', 'ci', '--auth-token-stdin', '-o', 'json'], {
      stdin: 'Bearer lit.token\n',
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? '{}')).toMatchObject({
      profiles: { ci: { auth: { type: 'bearer', token: 'lit.token' } } },
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ auth: { type: 'bearer', token: '***' } });
    expect(result.stdout).not.toContain('lit.token');
    expect(result.stderr).toBe(
      `Warning: the bearer token is stored in plain text in ${CONFIG_PATH} (mode 0600). Prefer --auth-token-env <VAR>, which stores only the name of an environment variable.\n`,
    );
  });

  it('refuses two secrets from stdin and names replaced Basic auth settings', async () => {
    const both = await cli(['config', 'set', 'ci', '--auth-token-stdin', '--auth-password-stdin'], {
      stdin: 'x',
    });
    expect(errorOf(both.stderr).message).toBe(
      '--auth-password-stdin and --auth-token-stdin both read stdin',
    );
    const files = {
      [CONFIG_PATH]: profiles({ p: { auth: { type: 'basic', username: 'u', passwordEnv: 'PW' } } }),
    };
    const replaced = await cli(['config', 'set', 'p', '--auth-token-env', 'X'], {
      files,
      env: { X: 'v' },
    });
    expect(replaced.stderr).toBe(
      'Notice: removed the Basic auth settings of the profile; bearer auth replaces them.\n',
    );
    const oauth = {
      [CONFIG_PATH]: profiles({ p: { auth: { type: 'oauth', clientId: 'c' } } }),
    };
    const fromOAuth = await cli(['config', 'set', 'p', '--auth', 'bearer'], { files: oauth });
    expect(fromOAuth.stderr).toBe(
      'Notice: removed the OAuth settings of the profile; bearer auth replaces them.\n',
    );
    const header = {
      [CONFIG_PATH]: profiles({ p: { headers: { Authorization: 'Bearer x' } } }),
    };
    const upgraded = await cli(['config', 'set', 'p', '--auth-token-env', 'X'], {
      files: header,
      env: { X: 'v' },
    });
    expect(upgraded.stderr).toBe(
      'Notice: removed the Authorization header of the profile; bearer auth replaces it.\n',
    );
  });

  it('shows the token masked with its source, the real value with --show-secrets', async () => {
    const env = { OPERATE_TOKEN: 'shown.token' };
    const view = JSON.parse((await cli(['config', 'show'], { env })).stdout) as {
      values: Record<string, unknown>;
    };
    expect(view.values.auth).toEqual({ value: 'bearer', source: 'env' });
    expect(view.values.token).toEqual({ value: '***', source: 'env' });
    const shown = await cli(['config', 'show', '--show-secrets'], { env });
    expect(shown.stdout).toContain('"token":{"value":"shown.token","source":"env"}');
    const stdin = await cli(['config', 'show', '--auth-token-stdin', '-o', 'table'], {
      stdin: 'piped',
    });
    expect(stdin.stdout).toMatch(/\ntoken +\*\*\* +flag\n/);
  });

  it('reports a token the auth type does not use', async () => {
    const env = {
      OPERATE_TOKEN: 'tok',
      OPERATE_USERNAME: 'u',
      OPERATE_PASSWORD: 'p',
      OPERATE_AUTH: 'basic',
    };
    const json = JSON.parse((await cli(['config', 'show'], { env })).stdout) as {
      values: Record<string, unknown>;
    };
    expect(json.values.token).toEqual({
      value: '***',
      source: 'env',
      unused: 'Basic auth is selected by OPERATE_AUTH=basic',
    });
    const table = await cli(['config', 'show', '-o', 'table'], { env });
    expect(table.stdout).toMatch(
      /\ntoken +\*\*\* \(unused: Basic auth is selected by OPERATE_AUTH=basic\) +env\n/,
    );
    expect(table.stdout).not.toContain('tok ');
  });

  it('unsets the token and lists the type', async () => {
    const files = { [CONFIG_PATH]: profiles({ p: { auth: { type: 'bearer', token: 't' } } }) };
    const list = await cli(['config', 'list'], { files });
    expect(JSON.parse(list.stdout)).toMatchObject([{ name: 'p', auth: 'bearer' }]);
    const unset = await cli(['config', 'unset', 'p', 'token'], { files });
    expect(JSON.parse(fileText(unset.runtime, CONFIG_PATH) ?? '{}')).toMatchObject({
      profiles: { p: { auth: { type: 'bearer' } } },
    });
  });
});

describe('mistyped bearer flags', () => {
  it('never echoes a token given as a flag value', async () => {
    const value = await cli(['task', 'list', '--auth-token=s3cr3t.tok']);
    expect(errorOf(value.stderr)).toMatchObject({ message: 'Unknown option "--auth-token"' });
    expect(errorOf(value.stderr).hint).toContain('Did you mean --auth-token-stdin?');
    const stdin = await cli(['task', 'list', '--auth-token-stdin=s3cr3t.tok']);
    expect(errorOf(stdin.stderr).message).toBe('Option "--auth-token-stdin" takes no value');
    const extra = await cli(['task', 'list', '--auth-token-stdin', 's3cr3t.tok'], { stdin: 't' });
    expect(errorOf(extra.stderr).hint).toContain(
      '--auth-token-stdin takes no value: pipe the token into it',
    );
    const guessed = await cli(['config', 'set', 'p', '--token-env', 'X']);
    expect(errorOf(guessed.stderr).hint).toContain('Did you mean --auth-token-env?');
    for (const result of [value, stdin, extra, guessed]) {
      expect(result.stderr).not.toContain('s3cr3t.tok');
      expect(result.requests).toEqual([]);
    }
  });

  it('never echoes a token typed before the command name', async () => {
    const stdin = await cli(['--auth-token-stdin', JWT, 'task', 'list'], { stdin: 't' });
    expect(errorOf(stdin.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'Unknown command (not repeated: it may be a token or password)',
      hint: `--auth-token-stdin takes no value: pipe the token into it, e.g. printf '%s\\n' "$TOKEN" | operate ... --auth-token-stdin. Run "operate --help" for the commands.`,
    });
    const typed = await cli(['--auth', 'bearer', JWT, 'task', 'list']);
    expect(errorOf(typed.stderr).hint).toBe(
      '--auth takes only the type: the token goes into OPERATE_TOKEN or --auth-token-stdin, not after --auth bearer. Run "operate --help" for the commands.',
    );
    const password = await cli(['--auth-password-stdin', 's3cr3t.pw', 'task', 'list']);
    const group = await cli(['auth', JWT]);
    // a typo next to a secret option keeps its suggestion (known names only)
    const typo = await cli(['--auth-token-stdin', 'tsk', 'list'], { stdin: 't' });
    expect(errorOf(typo.stderr).hint).toMatch(/^Did you mean task\? /);
    const plain = await cli(['tsk', 'list']);
    expect(errorOf(plain.stderr).message).toBe('Unknown command "tsk"');
    for (const result of [stdin, typed, password, group]) {
      expect(result.code).toBe(2);
      expect(result.stderr).not.toContain(JWT);
      expect(result.stderr).not.toContain('s3cr3t.pw');
      expect(result.requests).toEqual([]);
    }
  });

  it('never echoes a token typed after --auth bearer or given to an auth command', async () => {
    const after = await cli(['task', 'list', '--auth', 'bearer', JWT]);
    expect(errorOf(after.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: "Too many arguments for 'list'. Expected 0 arguments but got 1.",
      hint: '--auth takes only the type: the token goes into OPERATE_TOKEN or --auth-token-stdin, not after --auth bearer. Run "operate task list --help" for the usage.',
    });
    const equals = await cli(['ping', '--auth=Bearer', JWT]);
    const set = await cli(['config', 'set', 'p', '--auth', 'bearer', JWT]);
    expect(errorOf(set.stderr).message).toBe(
      "Too many arguments for 'set'. Expected 1 argument but got 2.",
    );
    const status = await cli(['auth', 'status', JWT]);
    expect(errorOf(status.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: "Too many arguments for 'status'. Expected 0 arguments but got 1.",
      hint: `operate auth status takes no token argument: pipe the token into --auth-token-stdin, e.g. printf '%s\\n' "$TOKEN" | operate auth status --auth-token-stdin. Run "operate auth status --help" for the usage.`,
    });
    const logout = await cli(['auth', 'logout', JWT]);
    for (const result of [after, equals, set, status, logout]) {
      expect(result.code).toBe(2);
      expect(result.stderr).not.toContain(JWT);
      expect(result.requests).toEqual([]);
    }
  });

  it('never echoes a token given as the auth type', async () => {
    const files = { [CONFIG_PATH]: profiles({ p: { auth: { type: `Bearer ${JWT}` } } }) };
    const results = [
      await cli(['task', 'list', '--auth', `Bearer ${JWT}`]),
      await cli(['task', 'list', `--auth=${JWT}`]),
      await cli(['task', 'list', '--auth', `bearer:${JWT}`]),
      await cli(['task', 'list'], { env: { OPERATE_AUTH: `Bearer ${JWT}` } }),
      await cli(['config', 'set', 'p', '--auth', `Bearer ${JWT}`]),
      await cli(['task', 'list'], { files }),
      await cli(['config', 'show'], { files }),
    ];
    for (const result of results) {
      expect(result.code).toBe(3);
      expect(errorOf(result.stderr)).toMatchObject({
        code: 'CONFIG',
        message: 'Unsupported auth type (not one of none, basic, oauth, bearer)',
      });
      expect(errorOf(result.stderr).hint).toContain(
        'A bearer token itself goes into OPERATE_TOKEN or --auth-token-stdin',
      );
      expect(result.stderr).not.toContain(JWT);
      expect(result.requests).toEqual([]);
    }
    expect(fileText(results[4]!.runtime, CONFIG_PATH)).toBeUndefined();
    // a mistyped type name is still quoted
    const typo = await cli(['task', 'list', '--auth', 'Bearer']);
    expect(errorOf(typo.stderr).message).toBe('Unsupported auth type "Bearer"');
  });

  it('refuses a token given to --auth-token-env without storing or repeating it', async () => {
    const token = 'tok_SECRETabcdefghijklmnopqrstuvwxyz0123';
    const result = await cli(['config', 'set', 'p', '--auth', 'bearer', '--auth-token-env', token]);
    expect(result.code).toBe(3);
    expect(errorOf(result.stderr).message).toBe(
      '--auth-token-env names a variable that is not set and does not look like a variable name: it may be the token itself, so it is neither stored nor repeated',
    );
    expect(result.stdout + result.stderr).not.toContain(token);
    expect(fileText(result.runtime, CONFIG_PATH)).toBeUndefined();
    // a set variable in any form is stored; an unset name in the usual form only warns
    const set = await cli(['config', 'set', 'p', '--auth-token-env', 'ci_token'], {
      env: { ci_token: 'v' },
    });
    expect(set.code).toBe(0);
    const usual = await cli(['config', 'set', 'p', '--auth-token-env', 'CI_ENGINE_TOKEN']);
    expect(usual.code).toBe(0);
    // a hand-edited file: an unusual unset name is not repeated either
    const files = { [CONFIG_PATH]: profiles({ p: { auth: { type: 'bearer', tokenEnv: token } } }) };
    for (const args of [
      ['task', 'list'],
      ['config', 'show'],
      ['auth', 'status'],
    ]) {
      const run = await cli(args, { files });
      expect(errorOf(run.stderr)).toMatchObject({
        code: 'CONFIG',
        message: 'The token variable named by auth.tokenEnv of profile "p" is not set or empty',
      });
      expect(run.stderr).not.toContain(token);
    }
  });
});

describe('a bearer token that the auth type does not use', () => {
  const sso = {
    [CONFIG_PATH]: profiles({
      p: { auth: { type: 'oauth', issuer: 'https://login.example.com/realms/x', clientId: 'cli' } },
      b: { auth: { type: 'basic', username: 'demo', passwordEnv: 'PW' } },
    }),
  };
  const note =
    'A bearer token is set (from OPERATE_TOKEN) but not used: OAuth is selected by the auth.type of profile "p"; send it with --auth bearer or OPERATE_AUTH=bearer.';

  it('is named by the LOGIN_REQUIRED hint and the dry-run note of an OAuth profile', async () => {
    const env = { OPERATE_TOKEN: JWT };
    const result = await cli(['task', 'list'], { files: sso, env });
    expect(result.code).toBe(4);
    expect(errorOf(result.stderr).code).toBe('LOGIN_REQUIRED');
    expect(String(errorOf(result.stderr).hint).endsWith(` ${note}`)).toBe(true);
    const dryRun = await cli(['task', 'list', '--dry-run'], { files: sso, env });
    expect(dryRun.code).toBe(0);
    expect(dryRun.stderr).toMatch(
      /^Note: Not logged in with OAuth .* in a terminal\. A bearer token is set/,
    );
    const sent = await cli(['task', 'list', '--auth', 'bearer'], { files: sso, env });
    expect(sent.requests[0]?.headers.authorization).toBe(`Bearer ${JWT}`);
    for (const output of [result, dryRun]) expect(output.stderr).not.toContain(JWT);
  });

  it('is named by the 401 and 403 hints of a Basic profile', async () => {
    const env = { OPERATE_TOKEN: JWT, PW: 'pw' };
    const rejected = await cli(['task', 'list', '--profile', 'b'], { files: sso, env }, 401);
    expect(rejected.code).toBe(4);
    expect(errorOf(rejected.stderr).hint).toBe(
      'The engine rejected the credentials of user demo (source: profile). Check the username and the password; `operate config show` shows where each comes from. After a failed login the engine refuses the user for a few seconds (and locks it after repeated failures), so wait before retrying. A bearer token is set (from OPERATE_TOKEN) but not used: Basic auth is selected by the auth.type of profile "b"; send it with --auth bearer or OPERATE_AUTH=bearer.',
    );
    const forbidden = await cli(['task', 'list', '--profile', 'b'], { files: sso, env }, 403);
    expect(errorOf(forbidden.stderr).hint).toContain('A bearer token is set (from OPERATE_TOKEN)');
    // switched off explicitly: the 401 hint already says why nothing was sent
    const none = await cli(
      ['task', 'list', '--auth', 'none'],
      { env: { OPERATE_TOKEN: JWT } },
      401,
    );
    expect(errorOf(none.stderr).hint).not.toContain('A bearer token is set');
    expect(errorOf(none.stderr).hint).toContain('Bearer auth is switched off by --auth none');
  });
});

describe('completion of the bearer options', () => {
  async function values(words: readonly string[]): Promise<string[]> {
    const result = await execute(run, ['__complete', ...words], fakeRuntime());
    return result.stdout
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('\t')[0] ?? '');
  }

  it('offers bearer and the token options', async () => {
    expect(await values(['ping', '--auth', 'b'])).toEqual(['basic', 'bearer']);
    expect(await values(['task', 'list', '--auth-to'])).toEqual(['--auth-token-stdin']);
    expect(await values(['config', 'set', 'p', '--auth-token'])).toEqual([
      '--auth-token-env',
      '--auth-token-stdin',
    ]);
    expect(await values(['config', 'set', 'p', '--auth', 'be'])).toEqual(['bearer']);
    expect(await values(['config', 'show', '--auth-t'])).toEqual(['--auth-token-stdin']);
  });

  it('documents the base URL of the fixtures', () => {
    expect(BASE_URL).toBe('http://localhost:8080/engine-rest');
  });
});
