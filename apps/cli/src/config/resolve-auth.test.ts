import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { compact } from '../util.js';
import { resolveHeaders } from './headers.js';
import { authorizationConflict, resolveAuth } from './resolve-auth.js';
import { resolveConfig } from './resolve.js';
import type { ConfigFlags, Profile, ProfileAuth, SelectedProfile, Source } from './types.js';

function failure(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    if (error instanceof OperateError) return error;
    throw error;
  }
  throw new Error('expected an OperateError');
}

function profile(auth: ProfileAuth, name = 'prod'): SelectedProfile {
  return { name, profile: { auth } };
}

const NO_PROFILE: SelectedProfile = {};

describe('resolveAuth type', () => {
  it('is none without any auth setting', () => {
    expect(resolveAuth({}, {}, NO_PROFILE)).toEqual({ auth: { type: 'none' }, source: 'default' });
    expect(resolveAuth({}, {}, { name: 'p', profile: {} })).toEqual({
      auth: { type: 'none' },
      source: 'default',
    });
  });

  it('takes an explicit none from every source and says where it was set', () => {
    expect(resolveAuth({ auth: 'none' }, {}, NO_PROFILE)).toEqual({
      auth: { type: 'none', off: 'Basic auth is switched off by --auth none' },
      source: 'flag',
    });
    expect(resolveAuth({}, { OPERATE_AUTH: ' none ' }, NO_PROFILE)).toEqual({
      auth: { type: 'none', off: 'Basic auth is switched off by OPERATE_AUTH=none' },
      source: 'env',
    });
    expect(resolveAuth({}, {}, profile({ type: 'none' }))).toEqual({
      auth: { type: 'none', off: 'Basic auth is switched off by the auth.type of profile "prod"' },
      source: 'profile',
    });
  });

  it('says where a password is set that nothing uses (no username, no type)', () => {
    const off = (env: Record<string, string>, selected: SelectedProfile) =>
      resolveAuth({}, env, selected).auth;
    expect(off({ OPERATE_PASSWORD: 'pw' }, profile({ password: 'x' }))).toEqual({
      type: 'none',
      off: 'a password is set (from OPERATE_PASSWORD), but no username',
    });
    expect(off({ OPERATE_PASSWORD: ' ' }, profile({ passwordEnv: 'UNSET_VARIABLE' }))).toEqual({
      type: 'none',
      off: 'a password is set (auth.passwordEnv of profile "prod"), but no username',
    });
    expect(off({}, profile({ password: 'x' }, 'p'))).toEqual({
      type: 'none',
      off: 'a password is set (auth.password of profile "p"), but no username',
    });
    expect(off({ PW: 'x' }, NO_PROFILE)).toEqual({ type: 'none' });
    expect(off({}, { name: 'p', profile: { auth: {} } })).toEqual({ type: 'none' });
  });

  it('selects basic for --auth-password-stdin without a type, so a missing username fails', () => {
    const error = failure(() => resolveAuth({ authPassword: 'pw' }, {}, NO_PROFILE));
    expect(error.message).toBe('Basic auth is selected but the username is missing');
    expect(error.details.hint).toMatch(
      /^Basic auth was selected by --auth-password-stdin without an auth type\. Looked up the username in --auth-user, /,
    );
    expect(resolveAuth({ authPassword: 'pw' }, { OPERATE_USERNAME: 'u' }, NO_PROFILE)).toEqual({
      auth: {
        type: 'basic',
        username: 'u',
        password: 'pw',
        sources: { username: 'env', password: 'flag' },
      },
      source: 'env',
    });
    // an explicit none still wins: credentials are ignored
    expect(resolveAuth({ authPassword: 'pw' }, { OPERATE_AUTH: 'none' }, NO_PROFILE).auth).toEqual({
      type: 'none',
      off: 'Basic auth is switched off by OPERATE_AUTH=none',
    });
  });

  it('lets --auth none and OPERATE_AUTH=none switch off Basic auth of the profile', () => {
    const basic = profile({ type: 'basic', username: 'demo', password: 'pw' });
    expect(resolveAuth({ auth: 'none' }, {}, basic)).toEqual({
      auth: { type: 'none', off: 'Basic auth is switched off by --auth none' },
      source: 'flag',
    });
    expect(resolveAuth({}, { OPERATE_AUTH: 'none' }, basic)).toEqual({
      auth: { type: 'none', off: 'Basic auth is switched off by OPERATE_AUTH=none' },
      source: 'env',
    });
    // a username from the environment does not override an explicit none
    expect(resolveAuth({ auth: 'none' }, { OPERATE_USERNAME: 'x' }, basic).auth.type).toBe('none');
  });

  it('selects basic for a username without a type, with the source of the username', () => {
    const env = { OPERATE_USERNAME: 'demo', OPERATE_PASSWORD: 'pw' };
    expect(resolveAuth({}, env, NO_PROFILE)).toEqual({
      auth: {
        type: 'basic',
        username: 'demo',
        password: 'pw',
        sources: { username: 'env', password: 'env' },
      },
      source: 'env',
    });
    expect(resolveAuth({ authUser: 'demo', authPassword: 'pw' }, {}, NO_PROFILE).source).toBe(
      'flag',
    );
    expect(resolveAuth({}, {}, profile({ username: 'demo', password: 'pw' })).source).toBe(
      'profile',
    );
  });

  it('ignores credentials when auth is none', () => {
    const resolved = resolveAuth(
      { auth: 'none', authPassword: 'a\nb' },
      { OPERATE_PASSWORD: 'x' },
      profile({ passwordEnv: 'UNSET_VARIABLE' }),
    );
    expect(resolved.auth).toEqual({
      type: 'none',
      off: 'Basic auth is switched off by --auth none',
    });
  });

  it('rejects an unsupported type from any source', () => {
    expect(failure(() => resolveAuth({ auth: 'digest' }, {}, NO_PROFILE)).message).toBe(
      'Unsupported auth type "digest"',
    );
    expect(failure(() => resolveAuth({}, { OPERATE_AUTH: 'OAuth' }, NO_PROFILE)).message).toBe(
      'Unsupported auth type "OAuth"',
    );
  });
});

describe('resolveAuth password', () => {
  const user = { authUser: 'demo', auth: 'basic' };

  function password(flags: ConfigFlags, env: Record<string, string>, selected: SelectedProfile) {
    const { auth } = resolveAuth({ ...user, ...flags }, env, selected);
    return auth.type === 'basic' ? [auth.password, auth.sources.password] : undefined;
  }

  it('prefers stdin, then OPERATE_PASSWORD, then passwordEnv, then the stored password', () => {
    const env = { OPERATE_PASSWORD: 'from-env', PW: 'from-variable' };
    const stored = profile({ passwordEnv: 'PW' });
    expect(password({ authPassword: 'from-stdin' }, env, stored)).toEqual(['from-stdin', 'flag']);
    expect(password({}, env, stored)).toEqual(['from-env', 'env']);
    expect(password({}, { PW: 'from-variable' }, stored)).toEqual(['from-variable', 'profile']);
    expect(password({}, {}, profile({ password: 'literal' }))).toEqual(['literal', 'profile']);
  });

  it('keeps passwords exactly, but treats blank values as unset', () => {
    expect(password({ authPassword: ' p w ' }, {}, NO_PROFILE)).toEqual([' p w ', 'flag']);
    expect(password({ authPassword: '  ' }, { OPERATE_PASSWORD: ' x ' }, NO_PROFILE)).toEqual([
      ' x ',
      'env',
    ]);
    expect(password({}, { OPERATE_PASSWORD: '' }, profile({ password: 'p' }))).toEqual([
      'p',
      'profile',
    ]);
  });

  it('only reads the passwordEnv variable when no other source has a password', () => {
    expect(
      password({}, { OPERATE_PASSWORD: 'env' }, profile({ passwordEnv: 'UNSET_VARIABLE' })),
    ).toEqual(['env', 'env']);
  });

  it.each([undefined, '', '   '])(
    'fails naming the passwordEnv variable when it is %j, never its value',
    (value) => {
      const env = value === undefined ? {} : { CAMUNDA_PASSWORD: value };
      const error = failure(() =>
        resolveAuth(user, env, profile({ passwordEnv: 'CAMUNDA_PASSWORD' })),
      );
      expect(error.code).toBe('CONFIG');
      expect(error.exitCode).toBe(3);
      expect(error.message).toBe(
        'The password variable CAMUNDA_PASSWORD (auth.passwordEnv of profile "prod") is not set or empty',
      );
      expect(error.details.hint).toBe(
        'Export it, e.g. export CAMUNDA_PASSWORD=<password>, or name another variable with `operate config set prod --auth-password-env <VAR>`.',
      );
    },
  );
});

describe('resolveAuth missing credentials', () => {
  it('names what is missing and where it was looked up', () => {
    const error = failure(() => resolveAuth({ auth: 'basic' }, {}, NO_PROFILE));
    expect(error.code).toBe('CONFIG');
    expect(error.exitCode).toBe(3);
    expect(error.message).toBe(
      'Basic auth is selected but the username and the password are missing',
    );
    expect(error.details.hint).toBe(
      'Basic auth was selected by --auth basic. Looked up the username in --auth-user, OPERATE_USERNAME and a profile (none is selected); the password in --auth-password-stdin, OPERATE_PASSWORD and a profile (none is selected). Pipe the password into --auth-password-stdin, set OPERATE_USERNAME and OPERATE_PASSWORD, or store them with `operate config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>`; --auth none switches Basic auth off.',
    );
  });

  it('lists only the missing value, with the profile keys', () => {
    const error = failure(() => resolveAuth({}, {}, profile({ username: 'demo' })));
    expect(error.message).toBe('Basic auth is selected but the password is missing');
    expect(error.details.hint).toMatch(
      /^Basic auth was selected by a username \(auth\.username of profile "prod"\) without an auth type\. Looked up the password in --auth-password-stdin, OPERATE_PASSWORD and the auth\.passwordEnv or auth\.password of profile "prod"\. /,
    );
    const user = failure(() =>
      resolveAuth({}, { OPERATE_AUTH: 'basic', OPERATE_PASSWORD: 'pw' }, profile({})),
    );
    expect(user.message).toBe('Basic auth is selected but the username is missing');
    expect(user.details.hint).toMatch(
      /^Basic auth was selected by OPERATE_AUTH=basic\. Looked up the username in --auth-user, OPERATE_USERNAME and the auth\.username of profile "prod"\. /,
    );
    const env = failure(() => resolveAuth({}, { OPERATE_USERNAME: 'demo' }, NO_PROFILE));
    expect(env.details.hint).toMatch(
      /^Basic auth was selected by a username \(from OPERATE_USERNAME\) without an auth type\. /,
    );
    const flag = failure(() => resolveAuth({ authUser: 'demo' }, {}, NO_PROFILE));
    expect(flag.details.hint).toMatch(
      /^Basic auth was selected by a username \(from --auth-user\) /,
    );
    const stored = failure(() => resolveAuth({}, {}, profile({ type: 'basic' })));
    expect(stored.details.hint).toMatch(
      /^Basic auth was selected by the auth\.type of profile "prod"\. /,
    );
  });
});

describe('resolveAuth with a profile without auth settings', () => {
  const plain: SelectedProfile = { name: 'plain', profile: { url: 'http://x' } };

  it('looks up the credentials of the profile and reports them missing', () => {
    const error = failure(() => resolveAuth({ auth: 'basic' }, {}, plain));
    expect(error.message).toBe(
      'Basic auth is selected but the username and the password are missing',
    );
    expect(error.details.hint).toContain(
      'Looked up the username in --auth-user, OPERATE_USERNAME and the auth.username of profile "plain"; the password in --auth-password-stdin, OPERATE_PASSWORD and the auth.passwordEnv or auth.password of profile "plain".',
    );
  });

  it('takes the credentials from flags and environment', () => {
    expect(resolveAuth({ authUser: 'demo' }, { OPERATE_PASSWORD: 'pw' }, plain).auth).toEqual({
      type: 'basic',
      username: 'demo',
      password: 'pw',
      sources: { username: 'flag', password: 'env' },
    });
    expect(resolveAuth({}, {}, plain)).toEqual({ auth: { type: 'none' }, source: 'default' });
  });
});

describe('resolveAuth validation', () => {
  it.each([
    [{ authUser: 'a:b', authPassword: 'p' }, {}, {}, 'from --auth-user'],
    [{ authPassword: 'p' }, { OPERATE_USERNAME: 'a:b' }, {}, 'from OPERATE_USERNAME'],
    [{ authPassword: 'p' }, {}, { username: 'a:b' }, 'auth.username of profile "prod"'],
  ] as const)('names the source of a username with ":"', (flags, env, auth, label) => {
    const error = failure(() => resolveAuth(flags, env, profile(auth)));
    expect(error.message).toBe(`The username (${label}) must not contain ":"`);
  });

  it.each([
    [{ authPassword: 'a\rb' }, {}, {}, 'from --auth-password-stdin'],
    [{}, { OPERATE_PASSWORD: 'a\0b' }, {}, 'from OPERATE_PASSWORD'],
    [{}, { PW: 'a\nb' }, { passwordEnv: 'PW' }, 'from PW, auth.passwordEnv of profile "prod"'],
    [{}, {}, { password: 'a\tb' }, 'auth.password of profile "prod"'],
  ] as const)(
    'names the source of a password with control characters',
    (flags, env, auth, label) => {
      const error = failure(() => resolveAuth({ authUser: 'demo', ...flags }, env, profile(auth)));
      expect(error.message).toBe(
        `The password (${label}) must not contain control characters (line breaks, NUL, tab, ...)`,
      );
    },
  );

  it('trims usernames like other values', () => {
    const { auth } = resolveAuth({ authUser: ' demo ', authPassword: 'p' }, {}, NO_PROFILE);
    expect(auth).toMatchObject({ username: 'demo' });
  });
});

type Choice<T> = readonly [flag: T | undefined, env: T | undefined, profile: T | undefined];

function choice<T>(value: fc.Arbitrary<T>): fc.Arbitrary<Choice<T>> {
  const optional = fc.option(value, { nil: undefined });
  return fc.tuple(optional, optional, optional);
}

function first<T>([flag, env, stored]: Choice<T>): { value?: T; source: Source } {
  if (flag !== undefined) return { value: flag, source: 'flag' };
  if (env !== undefined) return { value: env, source: 'env' };
  if (stored !== undefined) return { value: stored, source: 'profile' };
  return { source: 'default' };
}

describe('resolveAuth precedence', () => {
  const types = choice(fc.constantFrom('none' as const, 'basic' as const));
  const names = choice(fc.stringMatching(/^[a-z][a-z0-9.@-]{0,8}$/));
  // never blank: blank passwords count as unset
  const secrets = choice(
    fc.string({ unit: 'binary' }).map((value) => `p${value.replace(/\p{Cc}/gu, '')}`),
  );

  type Case = readonly [
    type: Choice<'none' | 'basic'>,
    user: Choice<string>,
    secret: Choice<string>,
    viaVariable: boolean,
  ];

  /** Flags, environment and profile auth of a case; a stored password may sit in PW_VAR. */
  function inputs([type, user, secret, viaVariable]: Case) {
    const stored = viaVariable ? { passwordEnv: secret[2] && 'PW_VAR' } : { password: secret[2] };
    return {
      flags: compact({ auth: type[0], authUser: user[0], authPassword: secret[0] }),
      env: {
        OPERATE_AUTH: type[1],
        OPERATE_USERNAME: user[1],
        OPERATE_PASSWORD: secret[1],
        PW_VAR: viaVariable ? secret[2] : undefined,
      },
      auth: compact({ type: type[2], username: user[2], ...stored }) as ProfileAuth,
    };
  }

  const NONE_LABELS = { flag: '--auth none', env: 'OPERATE_AUTH=none' } as const;

  /** Why auth is none: an explicit none, or a password nothing uses. */
  function off(
    explicit: { source: Source },
    [, env, stored]: Choice<string>,
    viaVariable: boolean,
  ) {
    if (explicit.source !== 'default') {
      const label =
        explicit.source === 'profile'
          ? 'the auth.type of profile "prod"'
          : NONE_LABELS[explicit.source];
      return `Basic auth is switched off by ${label}`;
    }
    if (env !== undefined) return 'a password is set (from OPERATE_PASSWORD), but no username';
    if (stored === undefined) return undefined;
    const key = viaVariable ? 'passwordEnv' : 'password';
    return `a password is set (auth.${key} of profile "prod"), but no username`;
  }

  /** The expected outcome: none, the missing credentials error, or the credentials. */
  function expected([type, user, secret, viaVariable]: Case) {
    const explicit = first(type);
    const username = first(user);
    const password = first(secret);
    // without a type, a username or the password from stdin selects Basic auth
    const implied = username.value !== undefined || secret[0] !== undefined;
    if (explicit.value === 'none' || (explicit.value === undefined && !implied)) {
      return {
        auth: { type: 'none', off: off(explicit, secret, viaVariable) },
        source: explicit.source,
      };
    }
    if (username.value === undefined || password.value === undefined) return undefined;
    return {
      auth: {
        type: 'basic',
        username: username.value,
        password: password.value,
        sources: { username: username.source, password: password.source },
      },
      source: explicit.value === undefined ? username.source : explicit.source,
    };
  }

  it('takes type, username and password from the highest source that sets them', () => {
    fc.assert(
      fc.property(fc.tuple(types, names, secrets, fc.boolean()), (testCase) => {
        const { flags, env, auth } = inputs(testCase);
        const run = () => resolveAuth(flags, env, profile(auth));
        const outcome = expected(testCase);
        if (outcome === undefined) {
          expect(failure(run).message).toMatch(/^Basic auth is selected but .* missing$/);
        } else {
          expect(run()).toEqual(outcome);
        }
      }),
    );
  });
});

describe('authorizationConflict', () => {
  const basic = {
    type: 'basic' as const,
    username: 'demo',
    password: 'pw',
    sources: { username: 'env' as const, password: 'env' as const },
  };

  it('allows an Authorization header without Basic auth, and Basic auth without one', () => {
    expect(authorizationConflict({ type: 'none' }, 'flag', 'p')).toBeUndefined();
    expect(authorizationConflict(basic, undefined, 'p')).toBeUndefined();
  });

  it.each([
    ['flag', 'given with -H/--header', 'prod'],
    ['env', 'from OPERATE_HEADERS', 'prod'],
    [
      'profile',
      'from the headers of profile "prod"; `operate config unset prod headers` removes them',
      'prod',
    ],
  ] as const)('asks to drop one when the header comes from %s', (source, origin, name) => {
    const error = authorizationConflict(basic, source, name);
    expect(error?.code).toBe('CONFIG');
    expect(error?.exitCode).toBe(3);
    expect(error?.message).toBe('Basic auth and an Authorization header are both configured');
    expect(error?.details.hint).toBe(
      `Drop one: remove the Authorization header (${origin}), or switch Basic auth off with --auth none, OPERATE_AUTH=none or \`operate config unset prod auth\`.`,
    );
  });

  it('uses a placeholder without a selected profile', () => {
    expect(authorizationConflict(basic, 'profile', undefined)?.details.hint).toBe(
      'Drop one: remove the Authorization header (from the headers of profile "<profile>"; `operate config unset <profile> headers` removes them), or switch Basic auth off with --auth none, OPERATE_AUTH=none or `operate config unset <profile> auth`.',
    );
  });
});

describe('resolveHeaders', () => {
  it('reports the most specific source of an Authorization header', () => {
    const stored: Profile = { headers: { authorization: 'Bearer p', 'X-A': '1' } };
    const env = { OPERATE_HEADERS: 'Authorization: Bearer e' };
    expect(
      resolveHeaders({ headers: ['AUTHORIZATION: Bearer f'] }, env, stored).authorization,
    ).toBe('flag');
    expect(resolveHeaders({ headers: ['X-B: 2'] }, env, stored)).toEqual({
      value: { 'X-A': '1', Authorization: 'Bearer e', 'X-B': '2' },
      source: 'flag',
      authorization: 'env',
    });
    expect(resolveHeaders({}, {}, stored).authorization).toBe('profile');
    expect(resolveHeaders({}, {}, { headers: { 'X-A': '1' } })).toStrictEqual({
      value: { 'X-A': '1' },
      source: 'profile',
    });
    expect(resolveHeaders({}, {}, undefined)).toStrictEqual({ value: {}, source: 'default' });
  });
});

describe('resolveConfig with Basic auth', () => {
  const file = (stored: Profile) => ({ defaultProfile: 'p', profiles: { p: stored } });

  it('resolves Basic auth credentials', () => {
    const resolved = resolveConfig(
      { authPassword: 'from-stdin' },
      { OPERATE_USERNAME: 'demo' },
      file({ url: 'http://x' }),
    );
    expect(resolved.auth).toEqual({
      type: 'basic',
      username: 'demo',
      password: 'from-stdin',
      sources: { username: 'env', password: 'flag' },
    });
    expect(resolved.sources.auth).toBe('env');
  });

  it('refuses Basic auth together with an Authorization header', () => {
    const error = failure(() =>
      resolveConfig(
        { auth: 'basic', authUser: 'demo', authPassword: 'pw' },
        {},
        file({ headers: { Authorization: 'Bearer t' } }),
      ),
    );
    expect(error.message).toBe('Basic auth and an Authorization header are both configured');
    expect(error.details.hint).toContain('`operate config unset p headers`');
    expect(
      resolveConfig({ auth: 'none' }, {}, file({ headers: { Authorization: 'Bearer t' } })).headers,
    ).toEqual({ Authorization: 'Bearer t' });
  });

  it('checks the basic values before the credentials', () => {
    const error = failure(() => resolveConfig({ auth: 'basic', url: 'nope' }, {}, undefined));
    expect(error.message).toBe('Invalid engine URL "nope"');
  });
});
