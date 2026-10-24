/**
 * Property (design §18, extends auth-secrets.test.ts and oauth-secrets.test.ts to bearer tokens
 * from elsewhere): for arbitrary opaque tokens and JWTs, no output of config show/set/list, ping,
 * dry-run (json, curl), operations with --verbose (success, 401, 403, network error), api,
 * `auth status|login|logout` or any error (invalid, expired or conflicting tokens, mistyped
 * flags) contains the token or its signature, unless --show-secrets is given; with it only
 * dry-run, the verbose trace and config show contain it.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { jwtWith, NOW_S, opaqueTokens, VALID_CLAIMS } from '../../test/support/bearer.js';
import { connectionRefused, fakeServer, json } from '../../test/support/fake-fetch.js';
import { CONFIG_PATH, execute, fakeRuntime } from '../../test/support/fake-runtime.js';
import { run } from './run.js';

interface Scenario {
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly status?: number | 'down';
}

function engine(status: Scenario['status']) {
  const reply = () =>
    status === undefined
      ? json([])
      : new Response('Jwt verification fails', {
          status: Number(status),
          headers: { 'content-type': 'text/plain' },
        });
  const fake = fakeServer()
    .on('GET', '/version', json({ version: '7.24.0' }))
    .on('GET', '/engine', json([{ name: 'default' }]))
    .on('GET', '/task', reply);
  return status === 'down' ? () => Promise.reject(connectionRefused()) : fake.fetch;
}

async function outcome(scenario: Scenario) {
  const runtime = fakeRuntime({
    fetch: engine(scenario.status),
    env: scenario.env ?? {},
    files: scenario.files ?? {},
    ...(scenario.stdin === undefined ? {} : { stdin: scenario.stdin }),
  });
  return execute(run, scenario.args, runtime);
}

async function output(scenario: Scenario): Promise<string> {
  const result = await outcome(scenario);
  return `${result.stdout}\n${result.stderr}`;
}

function stored(auth: Record<string, unknown>): Readonly<Record<string, string>> {
  return { [CONFIG_PATH]: JSON.stringify({ defaultProfile: 'p', profiles: { p: { auth } } }) };
}

/** Every way a token reaches operate, and every command that renders something. */
function scenarios(token: string): Scenario[] {
  const env = { OPERATE_TOKEN: token };
  const stdin = ['--auth-token-stdin'];
  const literal = stored({ type: 'bearer', token });
  const variable = {
    files: stored({ type: 'bearer', tokenEnv: 'CI_TOKEN' }),
    env: { CI_TOKEN: token },
  };
  const unused = {
    ...env,
    OPERATE_USERNAME: 'demo',
    OPERATE_PASSWORD: 'pw',
    OPERATE_AUTH: 'basic',
  };
  return [
    { args: ['config', 'show'], env },
    { args: ['config', 'show', '-o', 'table'], env },
    { args: ['config', 'show', ...stdin], stdin: `${token}\n` },
    { args: ['config', 'show'], files: literal },
    { args: ['config', 'show', '-o', 'table'], ...variable },
    { args: ['config', 'show'], env: unused },
    { args: ['config', 'show', '-o', 'table'], env: unused },
    { args: ['config', 'set', 'p', ...stdin, '-o', 'json'], stdin: `Bearer ${token}\r\n` },
    { args: ['config', 'set', 'p', ...stdin, '-o', 'table'], stdin: token },
    { args: ['config', 'list'], files: literal },
    { args: ['task', 'list', '--dry-run'], env },
    { args: ['task', 'list', '--dry-run', '-o', 'table'], env },
    { args: ['task', 'list', '--dry-run', ...stdin], stdin: token },
    { args: ['api', 'GET', '/task', '--dry-run'], files: literal },
    { args: ['ping', '--dry-run', '-o', 'table'], ...variable },
    { args: ['ping'], env },
    { args: ['ping', '--verbose'], env },
    { args: ['task', 'list', '--verbose'], env },
    { args: ['task', 'list', '--verbose'], env, status: 401 },
    { args: ['task', 'list', '-o', 'table', '--verbose'], env, status: 401 },
    { args: ['task', 'list', '--verbose'], env, status: 403 },
    { args: ['task', 'list', '--verbose'], env, status: 'down' },
    { args: ['auth', 'status'], env },
    { args: ['auth', 'status', '-o', 'table'], files: literal },
    { args: ['auth', 'login'], env },
    { args: ['auth', 'logout'], files: literal },
    // errors: a header next to the token, a username next to it, two stdin readers
    { args: ['task', 'list', '-H', 'Authorization: Bearer x'], env },
    { args: ['task', 'list', '--auth-user', 'demo'], env },
    { args: ['task', 'list', ...stdin, '--auth-password-stdin'], stdin: token },
    { args: ['api', 'POST', '/message', '--body', '-', ...stdin], stdin: token },
    // invalid tokens are refused without being repeated
    { args: ['task', 'list'], env: { OPERATE_TOKEN: `${token} x` } },
    { args: ['task', 'list'], env: { OPERATE_TOKEN: `{"access_token":"${token}"}` } },
    { args: ['task', 'list', ...stdin], stdin: `${token}\u0000` },
    { args: ['config', 'set', 'p', ...stdin], stdin: `${token}:x` },
    // mistyped flags: the usage error must not echo the value
    { args: ['task', 'list', `--auth-token=${token}`] },
    { args: ['task', 'list', `--auth-token-stdin=${token}`] },
    { args: ['task', 'list', ...stdin, token], stdin: token },
    { args: ['api', 'GET', '/task', ...stdin, token], stdin: token },
    { args: ['config', 'set', 'p', `--auth-token=${token}`] },
    { args: ['ping', `--token=${token}`] },
    { args: ['ping', `--access-token=${token}`] },
    // a token typed before the command, after --auth bearer, to auth status, as the auth type
    { args: [...stdin, token, 'task', 'list'], stdin: token },
    { args: ['--auth', 'bearer', token, 'task', 'list'] },
    { args: ['task', 'list', '--auth', 'bearer', token] },
    { args: ['auth', 'status', token] },
    { args: ['task', 'list', '--auth', `Bearer ${token}`] },
    { args: ['task', 'list'], env: { OPERATE_AUTH: `Bearer ${token}` } },
    { args: ['task', 'list'], files: stored({ type: token }) },
    // a token given as the name of its variable
    { args: ['config', 'set', 'p', '--auth', 'bearer', '--auth-token-env', token] },
    // a token next to a type that does not use it: the hints name it, never show it
    {
      args: ['task', 'list'],
      env,
      files: stored({ type: 'oauth', issuer: ISSUER, clientId: 'c' }),
    },
    {
      args: ['task', 'list', '--verbose'],
      env: { ...env, PW: 'pw' },
      files: stored({ type: 'basic', username: 'demo', passwordEnv: 'PW' }),
      status: 401,
    },
  ];
}

const ISSUER = 'https://login.example.com/realms/x';

const signatures = fc
  .string({
    unit: fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split(''),
    ),
    minLength: 12,
    maxLength: 40,
  })
  .map((value) => `Sg${value}`);

/**
 * A token and the parts of it that must never show: the whole token, a JWT's signature. JWTs
 * expire up to an hour before or after now (`minOffset` -30: none is expired yet).
 */
function tokensOf(minOffset: number) {
  return fc.oneof(
    opaqueTokens.map((token) => ({ token, forms: [token] })),
    fc.tuple(signatures, fc.integer({ min: minOffset, max: 3600 })).map(([signature, offset]) => {
      const token = jwtWith({ ...VALID_CLAIMS, exp: NOW_S + offset }, signature);
      return { token, forms: [token, signature] };
    }),
  );
}

const tokens = tokensOf(-3600);

describe('bearer token secrets', () => {
  it('scenarios reach the outputs they are meant for', async () => {
    const codes = [];
    for (const scenario of scenarios(jwtWith(VALID_CLAIMS, 'SgSignature0123'))) {
      codes.push((await outcome(scenario)).code);
    }
    // config show x7, config set x2, config list, dry-runs x5, ping x2, verbose, 401 x2, 403,
    // network, auth status x2, auth login/logout, header conflict, username conflict, two
    // stdin readers x2, invalid tokens x4, mistyped flags x7, misplaced tokens x4, token as the
    // type x3, token as the variable name, unused token: LOGIN_REQUIRED, 401
    expect(codes).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 8, 0, 0, 2, 2, 3, 3, 2, 2, 3,
      3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4,
    ]);
  });

  it('fail before sending when the JWT expired, without showing it', async () => {
    const token = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 120 }, 'SgExpiredSignature');
    for (const args of [
      ['task', 'list'],
      ['auth', 'status'],
      ['ping', '--verbose'],
    ]) {
      const result = await outcome({ args, env: { OPERATE_TOKEN: token } });
      expect(result.code).toBe(4);
      expect(result.stderr).toContain('TOKEN_EXPIRED');
      expect(`${result.stdout}${result.stderr}`).not.toContain('SgExpiredSignature');
    }
  });

  it('never appear in any output without --show-secrets', async () => {
    await fc.assert(
      fc.asyncProperty(tokens, async ({ token, forms }) => {
        for (const scenario of scenarios(token)) {
          const text = await output(scenario);
          for (const form of forms) expect(text, scenario.args.join(' ')).not.toContain(form);
        }
      }),
      { numRuns: 15 },
    );
  });

  it('appear with --show-secrets in dry-run, the verbose trace and config show only', async () => {
    await fc.assert(
      fc.asyncProperty(tokensOf(-30), async ({ token, forms }) => {
        const env = { OPERATE_TOKEN: token };
        const dryRun = await output({ args: ['task', 'list', '--dry-run', '--show-secrets'], env });
        expect(dryRun).toContain(`Bearer ${token}`);
        const verbose = await output({
          args: ['task', 'list', '--verbose', '--show-secrets'],
          env,
        });
        expect(verbose).toContain(`> Authorization: Bearer ${token}\n`);
        const show = await output({ args: ['config', 'show', '--show-secrets'], env });
        expect(show).toContain(token);
        const ping = await output({ args: ['ping', '--show-secrets'], env });
        for (const form of forms) expect(ping).not.toContain(form);
      }),
      { numRuns: 10 },
    );
  });
});
