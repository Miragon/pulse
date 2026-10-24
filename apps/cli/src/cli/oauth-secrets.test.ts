/**
 * Property (design §16.13, extends auth-secrets.test.ts to OAuth): for arbitrary access, refresh
 * and ID tokens, codes, verifiers and client secrets, no output of config show/list/set, ping,
 * dry-run (json, table, curl), operations with --verbose (success, 401 + refresh, invalid_grant),
 * api, auth login/status/logout or any error contains them. With --show-secrets only dry-run and
 * the verbose trace may show the access token and config show the client secret; never the
 * refresh token, ID token, code, verifier or the Base64 client credentials.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fakeServer, json } from '../../test/support/fake-fetch.js';
import { ISSUER, jwt, oauthError, tokenJson } from '../../test/support/fake-idp.js';
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntime,
} from '../../test/support/fake-runtime.js';
import { cachedLogin, cacheText, oauthProfiles, TOKEN_FILE } from '../../test/support/oauth.js';
import { run } from './run.js';

const T0 = 1_700_000_000_000;

interface Secrets {
  readonly access: string;
  readonly refresh: string;
  readonly newAccess: string;
  readonly newRefresh: string;
  readonly idToken: string;
  readonly code: string;
  readonly verifierBytes: Uint8Array;
  readonly clientSecret: string;
}

type Engine = 'ok' | 'expired' | 'down';

interface Scenario {
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly login?: 'cached' | 'expiring' | 'none';
  readonly engine?: Engine;
  readonly invalidGrant?: boolean;
}

function verifierOf(secrets: Secrets): string {
  return Buffer.from(secrets.verifierBytes).toString('base64url');
}

function base64Credentials(secret: string): string {
  const encode = (text: string) => new URLSearchParams({ x: text }).toString().slice(2);
  return Buffer.from(`${encode('operate-cli')}:${encode(secret)}`, 'utf8').toString('base64');
}

/** A minimal authorization server that issues exactly the given secrets. */
function authorizationServer(secrets: Secrets, invalidGrant: boolean) {
  const tokens = () =>
    tokenJson({
      access_token: secrets.newAccess,
      refresh_token: secrets.newRefresh,
      id_token: secrets.idToken,
      token_type: 'Bearer',
      expires_in: 300,
    });
  return (url: URL, init: RequestInit | undefined): Response => {
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      return tokenJson({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/auth`,
        token_endpoint: `${ISSUER}/token`,
        revocation_endpoint: `${ISSUER}/revoke`,
      });
    }
    if (url.pathname.endsWith('/revoke')) return new Response(null, { status: 200 });
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    if (form.get('grant_type') === 'refresh_token' && invalidGrant) {
      return oauthError(400, 'invalid_grant', 'Session not active');
    }
    return tokens();
  };
}

function engineFetch(secrets: Secrets, engine: Engine) {
  const answer = (authorization: string | undefined) =>
    engine === 'expired' && authorization === `Bearer ${secrets.access}`
      ? new Response('Jwt is expired', { status: 401, headers: { 'content-type': 'text/plain' } })
      : json({ count: 1 });
  return fakeServer()
    .on('GET', '/process-definition/count', (request) => answer(request.headers.authorization))
    .on('GET', '/version', json({ version: '7.24.0' }))
    .on('GET', '/engine', json([{ name: 'default' }])).fetch;
}

function fetchOf(secrets: Secrets, scenario: Scenario): typeof globalThis.fetch {
  const as = authorizationServer(secrets, scenario.invalidGrant === true);
  const engine = engineFetch(secrets, scenario.engine ?? 'ok');
  return (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.origin === new URL(ISSUER).origin) return Promise.resolve(as(url, init));
    if (scenario.engine === 'down') return Promise.reject(new TypeError('fetch failed'));
    return engine(input, init);
  };
}

function cacheOf(secrets: Secrets, scenario: Scenario): Record<string, string> {
  if (scenario.login === 'none') return {};
  const received = scenario.login === 'expiring' ? T0 - 250_000 : T0;
  return {
    [TOKEN_FILE]: cacheText(
      cachedLogin(received, { accessToken: secrets.access, refreshToken: secrets.refresh }),
    ),
  };
}

async function output(
  secrets: Secrets,
  scenario: Scenario,
): Promise<{ code: number; text: string }> {
  const runtime: FakeRuntime = fakeRuntime({
    fetch: fetchOf(secrets, scenario),
    now: () => T0,
    env: { OPERATE_OAUTH_CLIENT_SECRET: secrets.clientSecret, ...scenario.env },
    files: { [CONFIG_PATH]: oauthProfiles(), ...cacheOf(secrets, scenario) },
    // the first value is the verifier, the second the state (any other value)
    randomBytes: (() => {
      const values = [secrets.verifierBytes, secrets.verifierBytes.map((byte) => byte ^ 0x5a)];
      return (length: number) => values.shift() ?? new Uint8Array(length);
    })(),
    browser: async (url, fake) => {
      const state = new URL(url).searchParams.get('state') ?? '';
      await fake.loopback.request('/callback', { state, iss: ISSUER, code: secrets.code });
      return true;
    },
    ...(scenario.stdin === undefined ? {} : { stdin: scenario.stdin }),
  });
  const result = await execute(run, scenario.args, runtime);
  return { code: result.code, text: `${result.stdout}\n${result.stderr}` };
}

function scenarios(): Scenario[] {
  return [
    { args: ['config', 'show'] },
    { args: ['config', 'show', '-o', 'table'] },
    { args: ['config', 'list'] },
    { args: ['config', 'set', 'p', '--oauth-client-secret-stdin'], stdin: 'Cs#piped\n' },
    { args: ['auth', 'login'], login: 'none' },
    { args: ['auth', 'login', '--verbose', '-o', 'table'], login: 'none' },
    { args: ['auth', 'status'] },
    { args: ['auth', 'status', '-o', 'table'], login: 'expiring' },
    { args: ['auth', 'logout', '--verbose'] },
    { args: ['process-definition', 'count'] },
    { args: ['process-definition', 'count', '--verbose'], login: 'expiring' },
    { args: ['process-definition', 'count', '--verbose'], engine: 'expired' },
    {
      args: ['process-definition', 'count', '--verbose', '-o', 'table'],
      engine: 'expired',
      invalidGrant: true,
    },
    { args: ['process-definition', 'count', '--verbose'], engine: 'down' },
    { args: ['process-definition', 'count', '--dry-run'] },
    { args: ['process-definition', 'count', '--dry-run', '-o', 'table'], login: 'expiring' },
    { args: ['api', 'GET', '/process-definition/count', '--dry-run'] },
    { args: ['ping', '--verbose'] },
    { args: ['ping'], login: 'none' },
    { args: ['ping', '-H', 'Authorization: Bearer x'] },
  ];
}

const marker = (prefix: string) =>
  fc.stringMatching(/^[A-Za-z0-9\-._~+/]{12,30}$/).map((value) => `${prefix}${value}`);

const secretsArbitrary: fc.Arbitrary<Secrets> = fc.record({
  access: marker('AT'),
  refresh: marker('RT'),
  newAccess: marker('NA'),
  newRefresh: marker('NR'),
  idToken: fc
    .tuple(fc.string({ minLength: 4, maxLength: 12 }), fc.integer())
    .map(([name, nonce]) =>
      jwt({ sub: 'user-1', preferred_username: `u${name.replace(/\p{Cc}/gu, '')}`, nonce }),
    ),
  code: marker('CODE'),
  verifierBytes: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  clientSecret: fc
    .tuple(
      fc.string({ unit: 'binary', minLength: 6, maxLength: 16 }),
      fc.constantFrom('', '"', '\\', "'", ' ', 'äß', ':'),
    )
    .map(([value, extra]) => `Cs#${value.replace(/\p{Cc}/gu, '')}${extra}`),
});

/** Every form of every secret that must never appear without --show-secrets. */
function hidden(secrets: Secrets): string[] {
  return [
    secrets.access,
    secrets.refresh,
    secrets.newAccess,
    secrets.newRefresh,
    secrets.idToken,
    secrets.code,
    verifierOf(secrets),
    secrets.clientSecret,
    JSON.stringify(secrets.clientSecret).slice(1, -1),
    base64Credentials(secrets.clientSecret),
    'Cs#piped',
  ];
}

describe('OAuth secrets', () => {
  it('scenarios reach the outputs they are meant for', async () => {
    const secrets = fc.sample(secretsArbitrary, { numRuns: 1, seed: 7 })[0]!;
    const codes: number[] = [];
    for (const scenario of scenarios()) codes.push((await output(secrets, scenario)).code);
    // config x4, login x2, status x2, logout, commands (ok, refresh, 401 + refresh,
    // invalid_grant, network), dry-runs x3, ping, ping without login, the header conflict
    expect(codes, codes.join(',')).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 8, 0, 0, 0, 0, 4, 3,
    ]);
  });

  it('never appear in any output without --show-secrets', async () => {
    await fc.assert(
      fc.asyncProperty(secretsArbitrary, async (secrets) => {
        for (const scenario of scenarios()) {
          const { text } = await output(secrets, scenario);
          for (const form of hidden(secrets)) {
            expect(text, `${scenario.args.join(' ')}: ${form}`).not.toContain(form);
          }
        }
      }),
      { numRuns: 15 },
    );
  });

  it('show only the access token (trace, dry-run) and the client secret (config show) with --show-secrets', async () => {
    await fc.assert(
      fc.asyncProperty(secretsArbitrary, async (secrets) => {
        const never = [
          secrets.refresh,
          secrets.newRefresh,
          secrets.idToken,
          secrets.code,
          verifierOf(secrets),
          base64Credentials(secrets.clientSecret),
        ];
        const runs: Scenario[] = [
          { args: ['process-definition', 'count', '--dry-run', '--show-secrets'] },
          {
            args: ['process-definition', 'count', '--verbose', '--show-secrets'],
            login: 'expiring',
          },
          {
            args: ['process-definition', 'count', '--verbose', '--show-secrets'],
            engine: 'expired',
          },
          { args: ['auth', 'login', '--verbose', '--show-secrets'], login: 'none' },
          { args: ['config', 'show', '--show-secrets'] },
        ];
        const texts = await Promise.all(
          runs.map(async (scenario) => (await output(secrets, scenario)).text),
        );
        for (const text of texts) for (const form of never) expect(text).not.toContain(form);
        expect(texts[0]).toContain(`Bearer ${secrets.access}`);
        expect(texts[1]).toContain(`> Authorization: Bearer ${secrets.newAccess}\n`);
        expect(texts[2]).toContain(`> Authorization: Bearer ${secrets.access}\n`);
        expect(texts[4]).toContain(JSON.stringify(secrets.clientSecret).slice(1, -1));
      }),
      { numRuns: 10 },
    );
  });
});
