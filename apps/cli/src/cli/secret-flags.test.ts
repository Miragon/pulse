import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { authFlagFor, mentionsSecret, optionName, secretHint, stdinHint } from './secret-flags.js';

describe('optionName', () => {
  it.each([
    ['--auth-password=S3:cr=t', '--auth-password'],
    ['--dry-run', '--dry-run'],
    ['--x=', '--x'],
    ['=value', ''],
  ])('reads %j as %j', (token, name) => {
    expect(optionName(token)).toBe(name);
  });

  it('never keeps anything of the value', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^--[a-z-]{1,12}$/),
        fc.string({ unit: 'binary' }),
        (name, value) => {
          expect(optionName(`${name}=${value}`)).toBe(name);
        },
      ),
    );
  });
});

describe('authFlagFor', () => {
  const known = ['--auth', '--auth-user', '--auth-password-stdin'];

  it('names the --auth-* flag of a renamed name when the command has it', () => {
    expect(authFlagFor('--username', known)).toEqual(['--auth-user']);
    expect(authFlagFor('--User', known)).toEqual(['--auth-user']);
    expect(authFlagFor('--password-stdin', known)).toEqual(['--auth-password-stdin']);
    expect(authFlagFor('--auth-password-file', known)).toEqual(['--auth-password-stdin']);
    expect(authFlagFor('--auth-type', known)).toEqual(['--auth']);
    expect(authFlagFor('--password-env', known)).toEqual([]);
    expect(authFlagFor('--password-env', ['--auth-password-env'])).toEqual(['--auth-password-env']);
    expect(authFlagFor('--assignee', known)).toEqual([]);
    expect(authFlagFor('--constructor', known)).toEqual([]);
  });
});

describe('secretHint', () => {
  it('is given for names that ask for a secret only', () => {
    for (const name of ['--password', '--PASSWD', '--pwd', '--client-secret', '--token']) {
      expect(secretHint(name)).toMatch(
        /^Secrets are never flag values: .* OPERATE_TOKEN or --auth-token-stdin; an OAuth token comes from `operate auth login`\. $/,
      );
    }
    for (const name of ['--pass', '--pass-word', '--auth-pass']) {
      expect(secretHint(name)).not.toBe('');
    }
    for (const name of ['--compass', '--passive', '--bypass-x', '--assignee', '']) {
      expect(secretHint(name)).toBe('');
    }
  });

  it('says where --show-secrets works instead of the secret hint', () => {
    for (const name of ['--show-secrets', '--Show-Secrets']) {
      expect(secretHint(name)).toBe(
        '--show-secrets works where operate prints credentials: --dry-run and --verbose of API and workflow commands, api and ping, and config show. `operate auth` commands never print a token. ',
      );
    }
    expect(secretHint('--show-secret')).toMatch(/^Secrets are never flag values/);
  });
});

describe('mentionsSecret', () => {
  it('looks at option names, not at values or positional arguments', () => {
    expect(mentionsSecret(['ping', '--auth-password-stdin', 'x'])).toBe(true);
    expect(mentionsSecret(['ping', '--password=x'])).toBe(true);
    expect(mentionsSecret(['identity', 'verify-user', '--password', 'x'])).toBe(true);
    expect(mentionsSecret(['ping', 'password', 'token'])).toBe(false);
    expect(mentionsSecret(['ping', '--auth-user=password'])).toBe(false);
    expect(mentionsSecret([])).toBe(false);
  });

  it('counts --auth bearer: the word after it is most likely the token', () => {
    expect(mentionsSecret(['ping', '--auth', 'bearer', 'x'])).toBe(true);
    expect(mentionsSecret(['ping', '--auth', 'Bearer', 'x'])).toBe(true);
    expect(mentionsSecret(['ping', '--auth=BEARER', 'x'])).toBe(true);
    expect(mentionsSecret(['ping', '--auth', 'basic', 'x'])).toBe(false);
    expect(mentionsSecret(['ping', '--auth=basic', 'bearer'])).toBe(false);
    expect(mentionsSecret(['ping', 'bearer', '--auth'])).toBe(false);
  });
});

describe('stdinHint', () => {
  it('explains --auth-password-stdin only when it is on the command line', () => {
    expect(stdinHint(['ping', '--auth-password-stdin', 'x'])).toBe(
      `--auth-password-stdin takes no value: pipe the password into it, e.g. printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin. `,
    );
    expect(stdinHint(['ping', '--auth-password-stdin=x'])).not.toBe('');
    expect(stdinHint(['ping', '--auth-password-stdinx', 'x'])).toBe('');
    expect(stdinHint(['ping', 'x'])).toBe('');
  });

  it('says that --auth takes only the type after --auth bearer', () => {
    const bearer =
      '--auth takes only the type: the token goes into OPERATE_TOKEN or --auth-token-stdin, not after --auth bearer. ';
    expect(stdinHint(['ping', '--auth', 'bearer', 'x'])).toBe(bearer);
    expect(stdinHint(['--auth=bearer', '--auth-token-stdin', 'x', 'ping'])).toBe(
      `--auth-token-stdin takes no value: pipe the token into it, e.g. printf '%s\\n' "$TOKEN" | operate ... --auth-token-stdin. ${bearer}`,
    );
    expect(stdinHint(['ping', '--auth', 'oauth', 'x'])).toBe('');
  });
});
