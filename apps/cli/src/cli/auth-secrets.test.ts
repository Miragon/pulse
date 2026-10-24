/**
 * Property: no rendered output (config show, dry-run previews and curl, the verbose trace, every
 * error) contains the Basic auth password or the Base64 form of the credentials, unless
 * --show-secrets is given.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
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
  const fake = fakeServer()
    .on('GET', '/version', json({ version: '7.24.0' }))
    .on('GET', '/engine', json([{ name: 'default' }]))
    .on('GET', '/task', () =>
      status === undefined
        ? json([])
        : new Response('{"type":"AuthenticationException","message":"Unauthorized"}', {
            status: Number(status),
            headers: { 'content-type': 'application/json' },
          }),
    );
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

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** The password as written, as JSON writes it, and the credentials as the header sends them. */
function secretForms(user: string, password: string): string[] {
  return [password, JSON.stringify(password).slice(1, -1), base64(`${user}:${password}`)];
}

/** Every way the credentials reach operate, and every command that renders something. */
function scenarios(user: string, password: string): Scenario[] {
  const env = { OPERATE_USERNAME: user, OPERATE_PASSWORD: password };
  const stdin = ['--auth-user', user, '--auth-password-stdin'];
  const stored = JSON.stringify({
    defaultProfile: 'p',
    profiles: { p: { auth: { type: 'basic', username: user, password } } },
  });
  return [
    { args: ['config', 'show'], env },
    { args: ['config', 'show', '-o', 'table'], env },
    { args: ['config', 'show', ...stdin], stdin: `${password}\n` },
    { args: ['config', 'show'], files: { [CONFIG_PATH]: stored } },
    { args: ['config', 'set', 'p', ...stdin], stdin: `${password}\r\n` },
    { args: ['config', 'list'], files: { [CONFIG_PATH]: stored } },
    { args: ['task', 'list', '--dry-run'], env },
    { args: ['task', 'list', '--dry-run', '-o', 'table'], env },
    { args: ['task', 'list', '--dry-run', ...stdin], stdin: password },
    { args: ['api', 'GET', '/task', '--dry-run'], files: { [CONFIG_PATH]: stored } },
    { args: ['ping', '--dry-run', '-o', 'table'], env },
    { args: ['task', 'list', '--verbose'], env },
    { args: ['ping', '--verbose'], env },
    { args: ['task', 'list', '--verbose'], env, status: 401 },
    { args: ['task', 'list', '-o', 'table', '--verbose'], env, status: 401 },
    { args: ['task', 'list', '--verbose'], env, status: 'down' },
    { args: ['task', 'list', '--verbose', '-H', 'Authorization: Bearer x'], env },
    { args: ['task', 'list', '--verbose', '--auth-user', `${user}:x`], env },
    { args: ['task', 'list', '--auth', 'basic'], env: { OPERATE_PASSWORD: password } },
    { args: ['task', 'list'], env: { ...env, OPERATE_PASSWORD: `${password}\n` } },
    { args: ['task', 'list', '--body', '-', ...stdin], stdin: password },
    // mistyped password flags: the usage error must not echo the value
    { args: ['task', 'list', '--auth-user', user, `--auth-password=${password}`] },
    { args: ['task', 'list', '--auth-user', user, `--auth-password-stdin=${password}`] },
    { args: ['task', 'list', ...stdin, password], stdin: password },
    { args: ['api', 'GET', '/task', ...stdin, password], stdin: password },
    { args: ['config', 'set', 'p', `--auth-password=${password}`] },
    { args: ['ping', `--password=${password}`] },
  ];
}

/** Usernames: no ":" and no control characters (operate refuses them). */
const users = fc
  .string({ unit: 'binary', minLength: 1, maxLength: 12 })
  .map((value) => `u${value.replace(/[\p{Cc}:\s]/gu, '')}`);

/** Distinctive passwords with ":", quotes, backslashes and non-ASCII characters. */
const passwords = fc
  .tuple(
    fc.string({ unit: 'binary', minLength: 6, maxLength: 16 }),
    fc.constantFrom('', ':', '"', '\\', "'", ' ', 'äß', '\u{1f511}'),
  )
  .map(([value, extra]) => `Pw#${value.replace(/\p{Cc}/gu, '')}${extra}`);

describe('Basic auth secrets', () => {
  it('scenarios reach the outputs they are meant for', async () => {
    const codes = [];
    for (const scenario of scenarios('demo', 'Pw#s3cr:t'))
      codes.push((await outcome(scenario)).code);
    // config show x4, config set, config list, dry-runs x5, verbose x2, 401 x2, network,
    // header conflict, ":" in the username, missing username, control character, stdin twice,
    // mistyped password flags x6
    expect(codes).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 8, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2,
    ]);
  });

  it('never appear in any output without --show-secrets', async () => {
    await fc.assert(
      fc.asyncProperty(users, passwords, async (user, password) => {
        for (const scenario of scenarios(user, password)) {
          const text = await output(scenario);
          for (const form of secretForms(user, password)) {
            expect(text, scenario.args.join(' ')).not.toContain(form);
          }
        }
      }),
      { numRuns: 25 },
    );
  });

  it('appear with --show-secrets', async () => {
    await fc.assert(
      fc.asyncProperty(users, passwords, async (user, password) => {
        const env = { OPERATE_USERNAME: user, OPERATE_PASSWORD: password };
        const [, escaped, header] = secretForms(user, password);
        const show = await output({ args: ['config', 'show', '--show-secrets'], env });
        expect(show).toContain(escaped);
        const dryRun = await output({ args: ['task', 'list', '--dry-run', '--show-secrets'], env });
        expect(dryRun).toContain(`Basic ${header}`);
        const verbose = await output({
          args: ['task', 'list', '--verbose', '--show-secrets'],
          env,
        });
        expect(verbose).toContain(`> Authorization: Basic ${header}\n`);
      }),
      { numRuns: 10 },
    );
  });
});
