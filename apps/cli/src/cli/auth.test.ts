/**
 * Basic auth end to end through `run()`: flags, environment and profiles, the header on the wire,
 * masking in dry-run, curl, verbose and config output, the errors and `config set`.
 */

import { describe, expect, it } from 'vitest';
import { BASE_URL, fakeServer, json } from '../../test/support/fake-fetch.js';
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from '../../test/support/fake-runtime.js';
import { run } from './run.js';

const DEMO = 'Basic ZGVtbzpkZW1v';

function server(status = 200) {
  const reply = () =>
    status === 200
      ? json([])
      : new Response('{"type":"AuthenticationException","message":"Unauthorized"}', {
          status,
          headers: { 'content-type': 'application/json' },
        });
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

describe('Basic auth credentials', () => {
  it('sends the header with the user from the flag and the password from stdin', async () => {
    const result = await cli(
      ['task', 'list', '--auth', 'basic', '--auth-user', 'demo', '--auth-password-stdin'],
      { stdin: 'demo\n' },
    );
    expect(result).toMatchObject({ code: 0, stdout: '[]\n', stderr: '' });
    expect(result.requests.map((request) => request.headers.authorization)).toEqual([DEMO]);
  });

  it('accepts the auth options before the command path', async () => {
    const result = await cli(
      ['--auth', 'basic', '--auth-password-stdin', '--auth-user', 'demo', 'task', 'list'],
      { stdin: 'demo' },
    );
    expect(result.code).toBe(0);
    expect(result.requests[0]?.headers.authorization).toBe(DEMO);
  });

  it('takes the credentials from OPERATE_USERNAME and OPERATE_PASSWORD', async () => {
    const env = { OPERATE_USERNAME: 'demo', OPERATE_PASSWORD: 'demo' };
    const result = await cli(['task', 'list'], { env });
    expect(result.code).toBe(0);
    expect(result.requests[0]?.headers.authorization).toBe(DEMO);
  });

  it('takes the credentials from the profile, the password from its variable', async () => {
    const file = profiles({
      p: { auth: { type: 'basic', username: 'demo', passwordEnv: 'CAMUNDA_PASSWORD' } },
    });
    const result = await cli(['task', 'list'], {
      files: { [CONFIG_PATH]: file },
      env: { CAMUNDA_PASSWORD: 'demo' },
    });
    expect(result.code).toBe(0);
    expect(result.requests[0]?.headers.authorization).toBe(DEMO);
  });

  it('sends no credentials with --auth none, even if the profile has Basic auth', async () => {
    const file = profiles({ p: { auth: { username: 'demo', password: 'demo' } } });
    const result = await cli(['task', 'list', '--auth', 'none'], {
      files: { [CONFIG_PATH]: file },
    });
    expect(result.code).toBe(0);
    expect(result.requests[0]?.headers).not.toHaveProperty('authorization');
  });

  it('reports user and auth in ping', async () => {
    const result = await cli(['ping', '--auth-user', 'demo'], {
      env: { OPERATE_PASSWORD: 'demo' },
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ auth: 'basic', user: 'demo' });
    expect(result.requests.map((request) => request.headers.authorization)).toEqual([DEMO, DEMO]);
    const none = await cli(['ping']);
    expect(JSON.parse(none.stdout)).not.toHaveProperty('user');
    expect(JSON.parse(none.stdout)).toMatchObject({ auth: 'none' });
  });

  it('fails with exit 3 before any request when the password is missing', async () => {
    const result = await cli(['task', 'list', '--auth', 'basic', '--auth-user', 'demo']);
    expect(result.code).toBe(3);
    expect(result.requests).toEqual([]);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'CONFIG',
      exitCode: 3,
      message: 'Basic auth is selected but the password is missing',
    });
    const dryRun = await cli(['ping', '--auth', 'basic', '--dry-run']);
    expect(errorOf(dryRun.stderr)).toMatchObject({
      message: 'Basic auth is selected but the username and the password are missing',
    });
  });

  it('refuses Basic auth together with an Authorization header', async () => {
    const result = await cli(['task', 'list', '-H', 'Authorization: Bearer t'], {
      env: { OPERATE_USERNAME: 'demo', OPERATE_PASSWORD: 'demo' },
    });
    expect(result.code).toBe(3);
    expect(result.requests).toEqual([]);
    expect(errorOf(result.stderr)).toMatchObject({
      message: 'Basic auth and an Authorization header are both configured',
    });
  });
});

describe('--auth-password-stdin', () => {
  it('refuses --body - on operation commands and api, before reading stdin', async () => {
    for (const args of [
      ['message', 'correlate', '--body', '-'],
      ['api', 'POST', '/message', '--body', '-'],
    ]) {
      const result = await cli([...args, '--auth-user', 'demo', '--auth-password-stdin'], {
        stdin: 'demo\n',
      });
      expect(result.code).toBe(2);
      expect(result.requests).toEqual([]);
      expect(errorOf(result.stderr)).toMatchObject({
        code: 'USAGE',
        message: '--auth-password-stdin and --body - both read stdin',
      });
    }
  });

  it('allows a body from a file', async () => {
    const result = await cli(
      [
        'api',
        'POST',
        '/message',
        '--body',
        '@m.json',
        '--auth-user',
        'demo',
        '--auth-password-stdin',
      ],
      { stdin: 'demo', files: { 'm.json': '{"messageName":"m"}' } },
    );
    expect(result.code).toBe(0);
    expect(result.requests[0]).toMatchObject({
      body: '{"messageName":"m"}',
      headers: { authorization: DEMO },
    });
  });

  it('refuses an empty password with exit 2', async () => {
    const result = await cli(['task', 'list', '--auth-user', 'demo', '--auth-password-stdin'], {
      stdin: '\n',
    });
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toMatchObject({
      message: '--auth-password-stdin read an empty password',
    });
  });
});

describe('masking', () => {
  const env = { OPERATE_USERNAME: 'demo', OPERATE_PASSWORD: 'demo' };

  it('shows Authorization: Basic *** in dry-run previews and curl', async () => {
    for (const args of [
      ['task', 'list', '--dry-run'],
      ['api', 'GET', '/task', '--dry-run'],
      ['ping', '--dry-run'],
    ]) {
      const result = await cli(args, { env });
      expect(result.code).toBe(0);
      expect(result.requests).toEqual([]);
      const preview = JSON.parse(result.stdout) as { headers: unknown; curl: string };
      expect(preview.headers).toMatchObject({ Authorization: 'Basic ***' });
      expect(preview.curl).toContain(`-H 'Authorization: Basic ***'`);
      expect(result.stdout).not.toContain('ZGVtbzpkZW1v');
    }
    const table = await cli(['task', 'list', '--dry-run', '-o', 'table'], { env });
    expect(table.stdout).toBe(
      `curl '${BASE_URL}/task' -H 'Accept: application/json' -H 'Authorization: Basic ***'\n`,
    );
  });

  it('shows the real header with --show-secrets', async () => {
    const result = await cli(['task', 'list', '--dry-run', '--show-secrets'], { env });
    expect(JSON.parse(result.stdout)).toMatchObject({ headers: { Authorization: DEMO } });
  });

  it('masks the header in the verbose trace', async () => {
    const result = await cli(['task', 'list', '--verbose'], { env });
    expect(result.stderr).toContain('\n> Authorization: Basic ***\n');
    expect(result.stderr).not.toContain('ZGVtbzpkZW1v');
    const shown = await cli(['task', 'list', '--verbose', '--show-secrets'], { env });
    expect(shown.stderr).toContain(`\n> Authorization: ${DEMO}\n`);
  });
});

describe('HTTP 401', () => {
  it('names the rejected user and the source of the credentials', async () => {
    const result = await cli(
      ['task', 'list'],
      { env: { OPERATE_USERNAME: 'demo', OPERATE_PASSWORD: 'wrong' } },
      401,
    );
    expect(result.code).toBe(4);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'UNAUTHORIZED',
      hint: 'The engine rejected the credentials of user demo (source: env). Check the username and the password; `operate config show` shows where each comes from. After a failed login the engine refuses the user for a few seconds (and locks it after repeated failures), so wait before retrying.',
    });
    expect(result.stderr).not.toContain('wrong');
  });

  it('says that operate sent no credentials and how to send them', async () => {
    const result = await cli(['task', 'list'], {}, 401);
    expect(result.code).toBe(4);
    const { hint } = errorOf(result.stderr) as { hint: string };
    expect(hint).toContain('operate sent no credentials');
    expect(hint).toContain('--auth basic --auth-user <name>');
    expect(hint).toContain('OPERATE_USERNAME and OPERATE_PASSWORD');
    expect(hint).toContain(
      '`operate config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>`',
    );
  });
});

describe('credentials that select nothing', () => {
  it('selects Basic auth for --auth-password-stdin and fails without a username', async () => {
    const result = await cli(['task', 'list', '--auth-password-stdin'], { stdin: 'demo\n' });
    expect(result.code).toBe(3);
    expect(result.requests).toEqual([]);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'CONFIG',
      message: 'Basic auth is selected but the username is missing',
    });
    expect((errorOf(result.stderr) as { hint: string }).hint).toMatch(
      /^Basic auth was selected by --auth-password-stdin without an auth type\. /,
    );
  });

  it('says in the 401 hint that OPERATE_AUTH=none switched Basic auth off', async () => {
    const result = await cli(
      ['task', 'list', '--auth-user', 'demo', '--auth-password-stdin'],
      { stdin: 'demo\n', env: { OPERATE_AUTH: 'none' } },
      401,
    );
    expect(result.code).toBe(4);
    expect(result.requests[0]?.headers.authorization).toBeUndefined();
    expect((errorOf(result.stderr) as { hint: string }).hint).toMatch(
      /^The engine requires authentication and operate sent no credentials: Basic auth is switched off by OPERATE_AUTH=none\. Use Basic auth: /,
    );
  });

  it('says in the 401 hint that a password without a username was not used', async () => {
    const result = await cli(['task', 'list'], { env: { OPERATE_PASSWORD: 'demo' } }, 401);
    expect((errorOf(result.stderr) as { hint: string }).hint).toMatch(
      /^The engine requires authentication and operate sent no credentials: a password is set \(from OPERATE_PASSWORD\), but no username\. /,
    );
    expect(result.stderr).not.toContain('"demo"');
  });
});

describe('config commands', () => {
  const setBasic = ['config', 'set', 'p', '--auth', 'basic', '--auth-user', 'demo'];
  const UNSET_WARNING =
    'Warning: the variable named by --auth-password-env is not set in this environment. Pass the name of a variable that holds the password (e.g. CAMUNDA_PASSWORD), never the password itself; commands read it when they run.\n';
  const REPLACED_NOTICE =
    'Notice: removed the Authorization header of the profile; Basic auth replaces it.\n';

  it('stores Basic auth with a password variable', async () => {
    const result = await cli([...setBasic, '--auth-password-env', 'CAMUNDA_PASSWORD'], {
      env: { CAMUNDA_PASSWORD: 'x' },
    });
    expect(result).toMatchObject({ code: 0, stderr: '' });
    const auth = { type: 'basic', username: 'demo', passwordEnv: 'CAMUNDA_PASSWORD' };
    expect(JSON.parse(result.stdout)).toEqual({ name: 'p', default: true, auth });
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? '')).toEqual({
      defaultProfile: 'p',
      profiles: { p: { auth } },
    });
  });

  it('stores a literal password from stdin with a warning, and masks it in the output', async () => {
    const result = await cli(
      ['config', 'set', 'p', '--auth-user', 'demo', '--auth-password-stdin'],
      {
        stdin: 'pa:ss wörd\n',
      },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      name: 'p',
      default: true,
      auth: { username: 'demo', password: '***' },
    });
    expect(result.stderr).toBe(
      `Warning: the password is stored in plain text in ${CONFIG_PATH} (mode 0600). Prefer --auth-password-env <VAR>, which stores only the name of an environment variable.\n`,
    );
    expect(result.runtime.files.get(CONFIG_PATH)?.mode).toBe(0o600);
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? '')).toMatchObject({
      profiles: { p: { auth: { username: 'demo', password: 'pa:ss wörd' } } },
    });
  });

  it('warns, without naming it, when the password variable is not set here', async () => {
    for (const env of [{}, { CAMUNDA_PW_2: ' ' }]) {
      const result = await cli([...setBasic, '--auth-password-env', ' CAMUNDA_PW_2 '], { env });
      expect(result.code).toBe(0);
      expect(result.stderr).toBe(UNSET_WARNING);
      expect(result.stderr).not.toContain('CAMUNDA_PW_2');
    }
    const other = await cli(['config', 'set', 'p', '--auth-user', 'demo'], { env: {} });
    expect(other.stderr).toBe('');
    const set = await cli([...setBasic, '--auth-password-env', ' PW '], { env: { PW: 'x' } });
    expect(set).toMatchObject({ code: 0, stderr: '' });
  });

  it('refuses a password given to --auth-password-env without storing or repeating it', async () => {
    const password = 'S3cr3tPW';
    for (const env of [{}, { S3cr3tPW: ' ' }]) {
      const result = await cli([...setBasic, '--auth-password-env', ` ${password} `], { env });
      expect(result.code).toBe(3);
      expect(errorOf(result.stderr)).toMatchObject({
        code: 'CONFIG',
        message:
          '--auth-password-env names a variable that is not set and does not look like a variable name: it may be the password itself, so it is neither stored nor repeated',
      });
      expect(result.stdout + result.stderr).not.toContain(password);
      expect(fileText(result.runtime, CONFIG_PATH)).toBeUndefined();
    }
    // a set variable in any form is stored without a warning
    const set = await cli([...setBasic, '--auth-password-env', password], {
      env: { [password]: 'x' },
    });
    expect(set).toMatchObject({ code: 0, stderr: '' });
    // a hand-edited file: an unusual unset name is not repeated either
    const files = {
      [CONFIG_PATH]: profiles({ p: { auth: { username: 'demo', passwordEnv: password } } }),
    };
    for (const args of [
      ['task', 'list'],
      ['config', 'show'],
      ['ping', '--dry-run'],
    ]) {
      const run = await cli(args, { files });
      expect(errorOf(run.stderr)).toMatchObject({
        code: 'CONFIG',
        message:
          'The password variable named by auth.passwordEnv of profile "p" is not set or empty',
      });
      expect(run.stdout + run.stderr).not.toContain(password);
    }
  });

  it('replaces a stored Authorization header with Basic auth, keeping other headers', async () => {
    const file = profiles({
      p: { url: 'http://x', headers: { authorization: 'Basic eDp5', 'X-Tenant': 'a' } },
    });
    const result = await cli([...setBasic, '--auth-password-env', 'PW'], {
      files: { [CONFIG_PATH]: file },
      env: { PW: 'x' },
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe(REPLACED_NOTICE);
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? '')).toEqual({
      defaultProfile: 'p',
      profiles: {
        p: {
          url: 'http://x',
          auth: { type: 'basic', username: 'demo', passwordEnv: 'PW' },
          headers: { 'X-Tenant': 'a' },
        },
      },
    });
    const ping = await cli(['ping', '--dry-run'], {
      files: { [CONFIG_PATH]: fileText(result.runtime, CONFIG_PATH) ?? '' },
      env: { PW: 'x' },
    });
    expect(ping.code).toBe(0);
  });

  it('refuses an Authorization header for a profile with Basic auth', async () => {
    const file = profiles({ p: { auth: { username: 'demo', passwordEnv: 'PW' } } });
    const result = await cli(['config', 'set', 'p', '-H', 'Authorization: Bearer t'], {
      files: { [CONFIG_PATH]: file },
    });
    expect(result.code).toBe(3);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'CONFIG',
      message: 'Profile "p" would have both Basic auth and an Authorization header',
    });
    expect(fileText(result.runtime, CONFIG_PATH)).toBe(file);
    const both = await cli([...setBasic, '-H', 'authorization: Bearer t'], {});
    expect(both.code).toBe(3);
    expect(both.runtime.files.has(CONFIG_PATH)).toBe(false);
    const off = await cli(
      ['config', 'set', 'p', '--auth', 'none', '-H', 'Authorization: Bearer t'],
      {
        files: { [CONFIG_PATH]: file },
      },
    );
    expect(off).toMatchObject({ code: 0, stderr: '' });
  });

  it('refuses a password variable and a password from stdin together', async () => {
    const result = await cli(
      ['config', 'set', 'p', '--auth-password-env', 'PW', '--auth-password-stdin'],
      { stdin: 'x\n' },
    );
    expect(result.code).toBe(3);
    expect(result.runtime.files.has(CONFIG_PATH)).toBe(false);
  });

  it('shows type, username and password with their sources, the password masked', async () => {
    const file = profiles({ p: { auth: { username: 'demo', passwordEnv: 'PW' } } });
    const options = { files: { [CONFIG_PATH]: file }, env: { PW: 'top-secret' } };
    const result = await cli(['config', 'show'], options);
    expect(JSON.parse(result.stdout)).toMatchObject({
      values: {
        auth: { value: 'basic', source: 'profile' },
        username: { value: 'demo', source: 'profile' },
        password: { value: '***', source: 'profile' },
      },
    });
    expect(result.stdout).not.toContain('top-secret');
    const shown = await cli(['config', 'show', '--show-secrets'], options);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      values: { password: { value: 'top-secret', source: 'profile' } },
    });
    const flags = await cli(['config', 'show', '--auth-user', 'cli', '--auth-password-stdin'], {
      ...options,
      stdin: 'from-stdin\n',
    });
    expect(JSON.parse(flags.stdout)).toMatchObject({
      values: {
        username: { value: 'cli', source: 'flag' },
        password: { value: '***', source: 'flag' },
      },
    });
  });

  it('removes all auth settings with unset auth', async () => {
    const file = profiles({ p: { url: 'http://x', auth: { username: 'demo', password: 'pw' } } });
    const result = await cli(['config', 'unset', 'p', 'auth'], { files: { [CONFIG_PATH]: file } });
    expect(result.code).toBe(0);
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? '')).toEqual({
      defaultProfile: 'p',
      profiles: { p: { url: 'http://x' } },
    });
  });
});
