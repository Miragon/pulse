import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { configError } from './config-error.js';
import {
  isHeaderName,
  isHeaderValue,
  parseEnvHeaders,
  parseHeader,
  parseHeaders,
} from './headers.js';
import {
  MAX_TIMEOUT_MS,
  findProfile,
  isEngineName,
  isTimeout,
  missingProfileError,
  parseReadOnly,
  parseTimeout,
  resolveConfig,
  resolvePlatform,
  selectProfile,
  validateEngine,
  validateOutput,
  validatePlatform,
  validateUrl,
} from './resolve.js';
import { redactUrl } from './redact.js';
import { type ConfigFile, type ConfigFlags, PLATFORMS, type Profile } from './types.js';

function failure(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    if (error instanceof OperateError) return error;
    throw error;
  }
  throw new Error('expected an OperateError');
}

function file(profile: Profile, name = 'p'): ConfigFile {
  return { defaultProfile: name, profiles: { [name]: profile } };
}

const DEFAULT_SOURCES = {
  url: 'default',
  engine: 'default',
  platform: 'default',
  auth: 'default',
  output: 'default',
  timeout: 'default',
  headers: 'default',
  readOnly: 'default',
};

describe('resolveConfig defaults', () => {
  it('resolves the defaults without flags, environment or file', () => {
    expect(resolveConfig({}, {}, undefined)).toEqual({
      url: 'http://localhost:8080/engine-rest',
      platform: 'camunda7',
      auth: { type: 'none' },
      timeoutMs: 30000,
      headers: {},
      readOnly: false,
      sources: DEFAULT_SOURCES,
    });
  });

  it('treats blank flags and environment variables as unset', () => {
    const env = {
      OPERATE_URL: ' ',
      OPERATE_ENGINE: '',
      OPERATE_PLATFORM: ' ',
      OPERATE_OUTPUT: '',
      OPERATE_TIMEOUT: ' ',
      OPERATE_AUTH: '',
      OPERATE_READ_ONLY: '',
      OPERATE_PROFILE: '',
    };
    const flags: ConfigFlags = { url: '', engine: ' ', platform: '', output: '', profile: '' };
    expect(resolveConfig(flags, env, undefined).sources).toEqual(DEFAULT_SOURCES);
  });

  it('trims flag and environment values', () => {
    const resolved = resolveConfig(
      { engine: ' e1 ' },
      { OPERATE_URL: ' http://x/ ', OPERATE_OUTPUT: ' json ' },
      undefined,
    );
    expect(resolved.engine).toBe('e1');
    expect(resolved.url).toBe('http://x');
    expect(resolved.output).toBe('json');
  });
});

describe('resolveConfig precedence', () => {
  const profile: Profile = {
    url: 'http://profile:8080/engine-rest',
    engine: 'profile-engine',
    platform: 'operaton',
    auth: { type: 'none' },
    output: 'table',
    timeout: 3000,
    headers: { 'X-Profile': 'p' },
    readOnly: true,
  };
  const env = {
    OPERATE_URL: 'http://env:8080/engine-rest',
    OPERATE_ENGINE: 'env-engine',
    OPERATE_PLATFORM: 'cibseven',
    OPERATE_OUTPUT: 'json',
    OPERATE_TIMEOUT: '2000',
    OPERATE_AUTH: 'none',
    OPERATE_READ_ONLY: 'false',
  };
  const flags: ConfigFlags = {
    url: 'http://flag:8080/engine-rest/',
    engine: 'flag-engine',
    platform: 'camunda7',
    output: 'table',
    timeout: '1000',
    headers: ['X-Flag: f'],
    readOnly: true,
  };

  it('takes every value from the profile', () => {
    const resolved = resolveConfig({}, {}, file(profile));
    expect(resolved).toEqual({
      profile: 'p',
      url: 'http://profile:8080/engine-rest',
      engine: 'profile-engine',
      platform: 'operaton',
      auth: { type: 'none', off: 'Basic auth is switched off by the auth.type of profile "p"' },
      output: 'table',
      timeoutMs: 3000,
      headers: { 'X-Profile': 'p' },
      readOnly: true,
      sources: {
        url: 'profile',
        engine: 'profile',
        platform: 'profile',
        auth: 'profile',
        output: 'profile',
        timeout: 'profile',
        headers: 'profile',
        readOnly: 'profile',
      },
    });
  });

  it('lets the environment override the profile', () => {
    const resolved = resolveConfig({}, env, file(profile));
    expect(resolved).toMatchObject({
      url: 'http://env:8080/engine-rest',
      engine: 'env-engine',
      output: 'json',
      timeoutMs: 2000,
      readOnly: false,
      sources: {
        url: 'env',
        engine: 'env',
        auth: 'env',
        output: 'env',
        timeout: 'env',
        headers: 'profile',
        readOnly: 'env',
      },
    });
  });

  it('lets flags override the environment', () => {
    const resolved = resolveConfig(flags, env, file(profile));
    expect(resolved).toMatchObject({
      url: 'http://flag:8080/engine-rest',
      engine: 'flag-engine',
      output: 'table',
      timeoutMs: 1000,
      headers: { 'X-Profile': 'p', 'X-Flag': 'f' },
      readOnly: true,
      sources: {
        url: 'flag',
        engine: 'flag',
        auth: 'env',
        output: 'flag',
        timeout: 'flag',
        headers: 'flag',
        readOnly: 'flag',
      },
    });
  });

  it('lets a false read-only flag override a read-only profile', () => {
    const resolved = resolveConfig({ readOnly: false }, {}, file({ readOnly: true }));
    expect(resolved.readOnly).toBe(false);
    expect(resolved.sources.readOnly).toBe('flag');
  });

  it('merges header flags over profile headers case-insensitively', () => {
    const resolved = resolveConfig(
      { headers: ['authorization: Bearer flag', 'X-A: 1', 'x-a: 2'] },
      {},
      file({ headers: { Authorization: 'Bearer profile', 'X-B': 'b' } }),
    );
    expect(resolved.headers).toEqual({ authorization: 'Bearer flag', 'X-B': 'b', 'x-a': '2' });
    expect(resolved.sources.headers).toBe('flag');
  });

  it('merges OPERATE_HEADERS between profile headers and header flags', () => {
    const env = { OPERATE_HEADERS: 'Authorization: Bearer env\nX-Env: e\r\n\n  ' };
    const fromEnv = resolveConfig({}, env, file({ headers: { authorization: 'p', 'X-P': 'p' } }));
    expect(fromEnv.headers).toEqual({ 'X-P': 'p', Authorization: 'Bearer env', 'X-Env': 'e' });
    expect(fromEnv.sources.headers).toBe('env');
    const flag = resolveConfig({ headers: ['authorization: Bearer flag'] }, env, undefined);
    expect(flag.headers).toEqual({ 'X-Env': 'e', authorization: 'Bearer flag' });
    expect(flag.sources.headers).toBe('flag');
    expect(resolveConfig({}, { OPERATE_HEADERS: ' ' }, undefined).sources.headers).toBe('default');
  });

  it('rejects an invalid OPERATE_HEADERS without repeating the value', () => {
    const error = failure(() => parseEnvHeaders('X-Token secret'));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe('Invalid OPERATE_HEADERS: Invalid header: expected "Name: value"');
    expect(error.message).not.toContain('secret');
    expect(error.details.hint).toBe(
      "Example: OPERATE_HEADERS='X-API-Key: <key>'; separate several headers with line breaks. A bearer token goes into OPERATE_TOKEN (--auth bearer).",
    );
    expect(parseEnvHeaders(undefined)).toEqual({});
  });

  it('rejects the engine names "." and ".." from every source', () => {
    expect(failure(() => resolveConfig({ engine: '..' }, {}, undefined)).message).toBe(
      'Invalid process engine name ".."',
    );
    expect(failure(() => resolveConfig({}, { OPERATE_ENGINE: ' . ' }, undefined)).code).toBe(
      'CONFIG',
    );
    expect(resolveConfig({ engine: ' second ' }, {}, undefined).engine).toBe('second');
    expect(validateEngine('a.b')).toBe('a.b');
    expect(isEngineName('...')).toBe(true);
    expect(isEngineName(' ')).toBe(false);
    expect(isEngineName(3)).toBe(false);
  });

  it('reports headers from the profile as profile and empty flags as default', () => {
    expect(resolveConfig({ headers: [] }, {}, file({ headers: { A: 'b' } })).sources.headers).toBe(
      'profile',
    );
    expect(resolveConfig({ headers: [] }, {}, file({ headers: {} })).sources.headers).toBe(
      'default',
    );
  });

  it('validates values from every source', () => {
    expect(failure(() => resolveConfig({ output: 'yaml' }, {}, undefined)).message).toBe(
      'Unknown output format "yaml"',
    );
    expect(failure(() => resolveConfig({}, { OPERATE_TIMEOUT: 'soon' }, undefined)).message).toBe(
      'Timeout must be a positive number of milliseconds, got "soon"',
    );
    expect(failure(() => resolveConfig({}, { OPERATE_AUTH: 'digest' }, undefined)).message).toBe(
      'Unsupported auth type "digest"',
    );
    expect(failure(() => resolveConfig({ auth: 'Basic' }, {}, undefined)).message).toBe(
      'Unsupported auth type "Basic"',
    );
    expect(failure(() => resolveConfig({}, { OPERATE_URL: 'nope' }, undefined)).message).toBe(
      'Invalid engine URL "nope"',
    );
    expect(failure(() => resolveConfig({ headers: ['bad'] }, {}, undefined)).code).toBe('CONFIG');
    expect(failure(() => resolveConfig({}, { OPERATE_READ_ONLY: 'maybe' }, undefined)).code).toBe(
      'CONFIG',
    );
  });

  it('rejects an unsupported auth type stored in the profile', () => {
    const config = file({ auth: { type: 'digest' } as unknown as NonNullable<Profile['auth']> });
    expect(failure(() => resolveConfig({}, {}, config)).message).toBe(
      'Unsupported auth type "digest"',
    );
  });

  type Choice<T> = readonly [flag: T | undefined, env: T | undefined, profile: T | undefined];

  function choice<T>(value: fc.Arbitrary<T>): fc.Arbitrary<Choice<T>> {
    const optional = fc.option(value, { nil: undefined });
    return fc.tuple(optional, optional, optional);
  }

  function expected<T>([flag, env, profile]: Choice<T>, fallback: T) {
    if (flag !== undefined) return { value: flag, source: 'flag' };
    if (env !== undefined) return { value: env, source: 'env' };
    if (profile !== undefined) return { value: profile, source: 'profile' };
    return { value: fallback, source: 'default' };
  }

  it('always takes the value of the highest-precedence defined source', () => {
    const urls = fc.constantFrom('http://a:1/engine-rest', 'https://b/rest', 'http://c');
    const engines = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
    const outputs = fc.constantFrom('json' as const, 'table' as const);
    const platforms = fc.constantFrom(...PLATFORMS);
    const timeouts = fc.integer({ min: 1, max: MAX_TIMEOUT_MS });
    fc.assert(
      fc.property(
        fc.record({
          url: choice(urls),
          engine: choice(engines),
          platform: choice(platforms),
          output: choice(outputs),
          timeout: choice(timeouts),
          readOnly: choice(fc.boolean()),
          auth: fc.tuple(fc.constant(undefined), fc.boolean(), fc.boolean()),
        }),
        (c) => {
          const flags = {
            url: c.url[0],
            engine: c.engine[0],
            platform: c.platform[0],
            output: c.output[0],
            timeout: c.timeout[0]?.toString(),
            readOnly: c.readOnly[0],
          };
          const env = {
            OPERATE_URL: c.url[1],
            OPERATE_ENGINE: c.engine[1],
            OPERATE_PLATFORM: c.platform[1],
            OPERATE_OUTPUT: c.output[1],
            OPERATE_TIMEOUT: c.timeout[1]?.toString(),
            OPERATE_READ_ONLY: c.readOnly[1]?.toString(),
            OPERATE_AUTH: c.auth[1] ? 'none' : undefined,
          };
          const profile = {
            url: c.url[2],
            engine: c.engine[2],
            platform: c.platform[2],
            output: c.output[2],
            timeout: c.timeout[2],
            readOnly: c.readOnly[2],
            ...(c.auth[2] ? { auth: { type: 'none' as const } } : {}),
          };
          const resolved = resolveConfig(
            flags as ConfigFlags,
            env,
            file(JSON.parse(JSON.stringify(profile)) as Profile),
          );
          const url = expected(c.url, 'http://localhost:8080/engine-rest');
          const engine = expected(c.engine, undefined);
          const platform = expected(c.platform, 'camunda7');
          const output = expected(c.output, undefined);
          const timeout = expected(c.timeout, 30000);
          const readOnly = expected(c.readOnly, false);
          const auth = expected([undefined, c.auth[1] || undefined, c.auth[2] || undefined], false);
          expect(resolved.url).toBe(url.value);
          expect(resolved.engine).toBe(engine.value);
          expect(resolved.platform).toBe(platform.value);
          expect(resolved.output).toBe(output.value);
          expect(resolved.timeoutMs).toBe(timeout.value);
          expect(resolved.readOnly).toBe(readOnly.value);
          expect(resolved.sources).toEqual({
            url: url.source,
            engine: engine.source,
            platform: platform.source,
            auth: auth.source,
            output: output.source,
            timeout: timeout.source,
            headers: 'default',
            readOnly: readOnly.source,
          });
        },
      ),
    );
  });
});

describe('selectProfile', () => {
  const config: ConfigFile = {
    defaultProfile: 'dev',
    profiles: { dev: { engine: 'd' }, prod: { engine: 'p' }, test: { engine: 't' } },
  };

  it('selects the profile by flag, then OPERATE_PROFILE, then defaultProfile', () => {
    const env = { OPERATE_PROFILE: 'test' };
    expect(selectProfile({ profile: 'prod' }, env, config)).toEqual({
      name: 'prod',
      profile: { engine: 'p' },
    });
    expect(selectProfile({}, env, config).name).toBe('test');
    expect(selectProfile({}, {}, config).name).toBe('dev');
    expect(selectProfile({ profile: ' ' }, { OPERATE_PROFILE: '' }, config).name).toBe('dev');
  });

  it('selects nothing without a name', () => {
    expect(selectProfile({}, {}, undefined)).toEqual({});
    expect(selectProfile({}, {}, { profiles: { a: {} } })).toEqual({});
    expect(selectProfile({}, {}, { defaultProfile: ' ', profiles: {} })).toEqual({});
  });

  it('explains a missing profile selected by flag', () => {
    const error = failure(() => selectProfile({ profile: 'qa' }, {}, config));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe('Profile "qa" does not exist');
    expect(error.details.hint).toBe(
      'Known profiles: dev, prod, test. Create it with `operate config set qa --url <url>`.',
    );
  });

  it('names OPERATE_PROFILE when it selects a missing profile', () => {
    const error = failure(() => selectProfile({}, { OPERATE_PROFILE: 'qa' }, undefined));
    expect(error.details.hint).toBe(
      'It is selected by OPERATE_PROFILE. Create it with `operate config set qa --url <url>`.',
    );
  });

  it('names defaultProfile when it points to a missing profile', () => {
    const error = failure(() =>
      selectProfile({}, {}, { defaultProfile: 'gone', profiles: { a: {} } }),
    );
    expect(error.details.hint).toBe(
      'It is the defaultProfile of the config file; choose another one with `operate config use <profile>`. Known profiles: a. Create it with `operate config set gone --url <url>`.',
    );
  });

  it('does not treat inherited object properties as profiles', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
      expect(failure(() => selectProfile({ profile: name }, {}, config)).message).toBe(
        `Profile "${name}" does not exist`,
      );
    }
  });
});

describe('configError', () => {
  it('creates a CONFIG error with an optional hint', () => {
    const plain = configError('broken');
    expect(plain).toBeInstanceOf(OperateError);
    expect(plain.code).toBe('CONFIG');
    expect(plain.exitCode).toBe(3);
    expect(plain.message).toBe('broken');
    expect(plain.details).toStrictEqual({});
    expect(configError('broken', 'fix it').details).toEqual({ hint: 'fix it' });
  });
});

describe('findProfile and missingProfileError', () => {
  it('finds own profiles only', () => {
    const config: ConfigFile = { profiles: { a: { engine: 'x' } } };
    expect(findProfile(config, 'a')).toEqual({ engine: 'x' });
    expect(findProfile(config, 'b')).toBeUndefined();
    expect(findProfile(config, 'constructor')).toBeUndefined();
    expect(findProfile(undefined, 'a')).toBeUndefined();
  });

  it('defaults to the flag wording', () => {
    expect(missingProfileError('x', undefined).details.hint).toBe(
      'Create it with `operate config set x --url <url>`.',
    );
  });
});

describe('validateUrl', () => {
  it.each([
    ['http://localhost:8080/engine-rest', 'http://localhost:8080/engine-rest'],
    ['http://localhost:8080/engine-rest/', 'http://localhost:8080/engine-rest'],
    ['https://example.com/engine-rest///', 'https://example.com/engine-rest'],
    ['  https://example.com/rest  ', 'https://example.com/rest'],
    ['HTTP://EXAMPLE.COM/', 'HTTP://EXAMPLE.COM'],
    ['http://[::1]:8080', 'http://[::1]:8080'],
  ])('accepts %s as %s', (input, output) => {
    expect(validateUrl(input)).toBe(output);
  });

  it.each(['', 'localhost', '/engine-rest', 'http://'])('rejects the malformed URL "%s"', (url) => {
    const error = failure(() => validateUrl(url));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe(`Invalid engine URL "${url.trim()}"`);
    expect(error.details.hint).toBe('Example: http://localhost:8080/engine-rest');
  });

  it.each(['ftp://example.com', 'file:///tmp', 'localhost:8080/engine-rest'])(
    'rejects the non-HTTP URL %s',
    (url) => {
      const error = failure(() => validateUrl(url));
      expect(error.message).toBe(`Engine URL must start with http:// or https://, got "${url}"`);
      expect(error.details.hint).toBe('Example: http://localhost:8080/engine-rest');
    },
  );

  it.each([
    ['user:SECRETPW@localhost:8080', '***@localhost:8080'],
    ['localhost:8080/rest?token=SECRET', 'localhost:8080/rest?…'],
    ['mailto:a:SECRET@host?x', '***@host?…'],
  ])('never repeats credentials of the rejected URL %s', (url, shown) => {
    const error = failure(() => validateUrl(url));
    expect(error.message).toBe(`Engine URL must start with http:// or https://, got "${shown}"`);
    expect(error.message).not.toContain('SECRET');
  });

  it.each(['http://user:secret@host/rest', 'http://user@host/rest', 'http://:pw@host'])(
    'rejects credentials in %s without repeating them',
    (url) => {
      const error = failure(() => validateUrl(url));
      expect(error.message).toBe('Engine URL must not contain credentials');
      expect(error.message).not.toContain('secret');
      expect(error.details.hint).toBe(
        'Remove the user info from the URL and use Basic auth: --auth basic --auth-user <name> with the password from --auth-password-stdin or OPERATE_PASSWORD.',
      );
    },
  );

  it.each([
    ['http://user:secret@:bad/rest', 'http://***@:bad/rest'],
    ['file://user:secret@host/x', 'file://***@host/x'],
    ['http://a@b:secret@/x', 'http://***@/x'],
  ])('hides the user info of the malformed URL %s', (url, shown) => {
    const error = failure(() => validateUrl(url));
    expect(error.message).toBe(`Invalid engine URL "${shown}"`);
  });

  it.each(['ftp://user:secret@host', 'ws://user:secret@host/x', 'http://user:secret@host/r?q=1'])(
    'reports credentials in %s before any message that would repeat the URL',
    (url) => {
      const error = failure(() => validateUrl(url));
      expect(error.message).toBe('Engine URL must not contain credentials');
      expect(JSON.stringify(error.details)).not.toContain('secret');
    },
  );

  it.each(['http://host/rest?x=1', 'http://host/rest?', 'http://host/rest#top'])(
    'rejects the query or fragment in %s without repeating it',
    (url) => {
      const error = failure(() => validateUrl(url));
      expect(error.message).toBe(
        'Engine URL must not contain a query string or fragment, got "http://host/rest?…"',
      );
      expect(error.details.hint).toBe(
        'Pass credentials as a header (-H, OPERATE_HEADERS) instead. Example URL: http://localhost:8080/engine-rest',
      );
    },
  );

  it('redactUrl hides user info and everything after ? or #', () => {
    expect(redactUrl('http://h/x')).toBe('http://h/x');
    expect(redactUrl('http://a:b@h/x?t=1')).toBe('http://***@h/x?…');
    expect(redactUrl('a:b@c@h')).toBe('***@h');
    expect(redactUrl('?only')).toBe('?…');
  });
});

describe('validateOutput', () => {
  it('accepts json and table', () => {
    expect(validateOutput('json')).toBe('json');
    expect(validateOutput('table')).toBe('table');
  });

  it('rejects other formats with the list of choices', () => {
    const error = failure(() => validateOutput('JSON'));
    expect(error.message).toBe('Unknown output format "JSON"');
    expect(error.details.hint).toBe('Use one of: json, table');
  });
});

describe('validatePlatform', () => {
  it('accepts every engine with an adapter, trimmed', () => {
    for (const platform of PLATFORMS) expect(validatePlatform(` ${platform} `)).toBe(platform);
  });

  it('rejects other values with the list of known engines', () => {
    const error = failure(() => validatePlatform('camunda8'));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe('Unknown platform "camunda8"');
    expect(error.details.hint).toBe('Use one of: operaton, cibseven, camunda7');
  });
});

describe('resolvePlatform', () => {
  it('takes the flag, then OPERATE_PLATFORM, then the profile, else camunda7', () => {
    const env = { OPERATE_PLATFORM: 'cibseven' };
    const profile: Profile = { platform: 'operaton' };
    expect(resolvePlatform({ platform: 'camunda7' }, env, profile)).toEqual({
      value: 'camunda7',
      source: 'flag',
    });
    expect(resolvePlatform({}, env, profile)).toEqual({ value: 'cibseven', source: 'env' });
    expect(resolvePlatform({}, {}, profile)).toEqual({ value: 'operaton', source: 'profile' });
    expect(resolvePlatform({}, {}, undefined)).toEqual({ value: 'camunda7', source: 'default' });
  });

  it('fails on an unknown value of the environment', () => {
    const error = failure(() => resolvePlatform({}, { OPERATE_PLATFORM: 'zeebe' }, undefined));
    expect(error.message).toBe('Unknown platform "zeebe"');
  });
});

describe('parseTimeout', () => {
  it.each([
    ['1', 1],
    ['250', 250],
    [' 60000 ', 60000],
    [1, 1],
    [MAX_TIMEOUT_MS, MAX_TIMEOUT_MS],
    [String(MAX_TIMEOUT_MS), MAX_TIMEOUT_MS],
  ])('parses %j as %i', (input, output) => {
    expect(parseTimeout(input)).toBe(output);
  });

  it.each(['0', '-1', '1.5', '1e3', '0x10', '', ' ', 'abc', '10ms', 0, -5, 1.5, Number.NaN])(
    'rejects %j',
    (input) => {
      const error = failure(() => parseTimeout(input));
      expect(error.code).toBe('CONFIG');
      expect(error.message).toBe(
        `Timeout must be a positive number of milliseconds, got "${String(input)}"`,
      );
      expect(error.details.hint).toBe(
        'Use a whole number between 1 and 2147483647, e.g. 60000 for one minute.',
      );
    },
  );

  it('rejects timeouts above the timer limit', () => {
    expect(() => parseTimeout(MAX_TIMEOUT_MS + 1)).toThrow(OperateError);
    expect(() => parseTimeout(String(MAX_TIMEOUT_MS + 1))).toThrow(OperateError);
  });

  it('isTimeout only accepts whole numbers in range', () => {
    expect(isTimeout(1)).toBe(true);
    expect(isTimeout(MAX_TIMEOUT_MS)).toBe(true);
    expect(isTimeout(0)).toBe(false);
    expect(isTimeout(MAX_TIMEOUT_MS + 1)).toBe(false);
    expect(isTimeout(2.5)).toBe(false);
    expect(isTimeout('5')).toBe(false);
    expect(isTimeout(undefined)).toBe(false);
  });
});

describe('parseHeader', () => {
  it.each([
    ['X-Tenant-Id: acme', ['X-Tenant-Id', 'acme']],
    ['  X-A :  b c  ', ['X-A', 'b c']],
    ['Authorization: Bearer a:b:c', ['Authorization', 'Bearer a:b:c']],
    ['X-Empty:', ['X-Empty', '']],
    ["x!#$%&'*+.^_`|~1: v", ["x!#$%&'*+.^_`|~1", 'v']],
  ])('parses %j', (input, output) => {
    expect(parseHeader(input)).toEqual(output);
  });

  const hint = 'Use the form "Name: value", e.g. "X-Tenant-Id: acme".';

  it('rejects a header without a colon and does not repeat it', () => {
    const error = failure(() => parseHeader('Authorization Bearer secret'));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe('Invalid header: expected "Name: value"');
    expect(error.details.hint).toBe(hint);
  });

  it.each([
    [': value', ''],
    ['X Y: value', 'X Y'],
    ['X(Y): value', 'X(Y)'],
    ['Ä: value', 'Ä'],
  ])('rejects the header name in %j', (input, name) => {
    const error = failure(() => parseHeader(input));
    expect(error.message).toBe(`Invalid header name "${name}"`);
    expect(error.details.hint).toBe(hint);
  });

  it.each(['X: a\nb', 'X: a\rb', 'X: a\0b', 'X: a\u0001b', 'X: a\u007fb', 'X: \u001b[2J'])(
    'rejects control characters in %j',
    (input) => {
      const error = failure(() => parseHeader(input));
      expect(error.message).toBe(
        'Invalid value for header "X": control characters (line breaks, NUL, ESC, DEL, ...) are not allowed',
      );
    },
  );

  it.each(['Connection', 'content-length', 'Expect', 'Keep-Alive', 'TRANSFER-ENCODING', 'Upgrade'])(
    'rejects the client managed header %s',
    (name) => {
      const error = failure(() => parseHeader(`${name}: x`));
      expect(error.message).toBe(`Header "${name}" cannot be set: the HTTP client manages it`);
      expect(error.details.hint).toBe(
        'Remove it. Not allowed: connection, content-length, expect, keep-alive, transfer-encoding, upgrade.',
      );
      expect(isHeaderName(name)).toBe(false);
    },
  );

  it.each(['X: 日本', 'X: \u0100', 'X: emoji 😀', 'X: \ud800'])(
    'rejects characters beyond ISO-8859-1 in %j without repeating the value',
    (input) => {
      const error = failure(() => parseHeader(input));
      expect(error.code).toBe('CONFIG');
      expect(error.message).toBe(
        'Invalid value for header "X": only ISO-8859-1 (Latin-1) characters are allowed',
      );
      expect(error.details.hint).toBe(
        'Encode other characters, e.g. with percent-encoding or Base64.',
      );
    },
  );

  it('accepts tabs and every printable ISO-8859-1 character', () => {
    expect(parseHeader('X: Jos\u00e9 M\u00fcller \u00ff\tb\u00a0c')).toEqual([
      'X',
      'Jos\u00e9 M\u00fcller \u00ff\tb\u00a0c',
    ]);
  });

  it('isHeaderValue checks line breaks, NUL and the Latin-1 range', () => {
    expect(isHeaderValue('')).toBe(true);
    expect(isHeaderValue('Bearer a.b-c_d~e+f/g=')).toBe(true);
    expect(isHeaderValue('\u00ff')).toBe(true);
    expect(isHeaderValue('\u0100')).toBe(false);
    expect(isHeaderValue('a\rb')).toBe(false);
    expect(isHeaderValue('a\nb')).toBe(false);
    expect(isHeaderValue('a\0b')).toBe(false);
    expect(isHeaderValue('a\u0085b')).toBe(false);
    expect(isHeaderValue('a\tb')).toBe(true);
  });

  it('round-trips valid "Name: value" headers', () => {
    const name = fc.stringMatching(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/);
    const latin1 = fc.integer({ min: 0, max: 0xff }).map((code) => String.fromCharCode(code));
    const value = fc
      .string({ unit: latin1 })
      .map((text) => text.replace(/[^\P{Cc}\t]/gu, '').trim());
    const allowed = name.filter((candidate) => isHeaderName(candidate));
    fc.assert(
      fc.property(allowed, value, (headerName, headerValue) => {
        expect(parseHeader(`${headerName}: ${headerValue}`)).toEqual([headerName, headerValue]);
        expect(parseHeader(`${headerName}:${headerValue}`)).toEqual([headerName, headerValue]);
      }),
    );
  });

  it('parseHeaders merges into one map, later headers win', () => {
    expect(parseHeaders(['A: 1', 'B: 2', 'a: 3'])).toEqual({ B: '2', a: '3' });
    expect(parseHeaders([])).toEqual({});
  });
});

describe('parseReadOnly', () => {
  it.each(['1', 'true', 'TRUE', ' yes ', 'Yes', 'on'])('reads %j as true', (value) => {
    expect(parseReadOnly(value)).toBe(true);
  });

  it.each(['0', 'false', 'False', 'no', ' off '])('reads %j as false', (value) => {
    expect(parseReadOnly(value)).toBe(false);
  });

  it.each([undefined, '', '   '])('treats %j as unset', (value) => {
    expect(parseReadOnly(value)).toBeUndefined();
  });

  it('rejects other values instead of silently disabling read-only mode', () => {
    const error = failure(() => parseReadOnly('Enabled'));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe('Invalid OPERATE_READ_ONLY value "enabled"');
    expect(error.details.hint).toBe('Use one of: 1, true, yes, on, 0, false, no, off.');
  });

  it('keeps a read-only profile read-only when OPERATE_READ_ONLY is empty', () => {
    const resolved = resolveConfig({}, { OPERATE_READ_ONLY: '' }, file({ readOnly: true }));
    expect(resolved.readOnly).toBe(true);
    expect(resolved.sources.readOnly).toBe('profile');
  });
});
