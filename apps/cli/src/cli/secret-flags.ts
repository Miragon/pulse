/**
 * Mistyped auth flags in commander errors (design §15, §16.2.2, §18). Secrets are never flags, so
 * the most likely mistakes (`--auth-password=...`, `--auth-password-stdin <password>`,
 * `--auth-token=<token>`) must not echo them on stderr, into CI logs and agent transcripts. The
 * flag names proposed in issues #1 and #2 point to the `--auth-*` / `--oauth-*` flags they became.
 */

/** Flag names that were renamed to the `--auth-*` / `--oauth-*` flags, or are guessed for them. */
const AUTH_FLAGS: Readonly<Record<string, string>> = {
  '--username': '--auth-user',
  '--user': '--auth-user',
  '--auth-username': '--auth-user',
  '--password-stdin': '--auth-password-stdin',
  '--password-env': '--auth-password-env',
  '--auth-password-file': '--auth-password-stdin',
  '--auth-type': '--auth',
  '--issuer': '--oauth-issuer',
  '--client-id': '--oauth-client-id',
  '--client-secret': '--oauth-client-secret-env',
  '--oauth-client-secret': '--oauth-client-secret-env',
  '--scope': '--oauth-scopes',
  '--scopes': '--oauth-scopes',
  '--auth-token': '--auth-token-stdin',
  '--token-stdin': '--auth-token-stdin',
  '--auth-token-file': '--auth-token-stdin',
  '--token-env': '--auth-token-env',
};

/** Option names that ask for a secret as their value. */
const SECRET_NAME = /password|passwd|pwd|secret|token|-pass(?:$|-)/i;

const SECRET_HINT =
  'Secrets are never flag values: pipe the password into --auth-password-stdin, or set OPERATE_PASSWORD (a profile stores the name of a variable: config set --auth-password-env <VAR>); pass a bearer token with OPERATE_TOKEN or --auth-token-stdin; an OAuth token comes from `operate auth login`. ';

/** The stdin flags, and what an extra argument next to them most likely is. */
const STDIN_HINTS: readonly (readonly [flag: string, hint: string])[] = [
  [
    '--auth-password-stdin',
    `--auth-password-stdin takes no value: pipe the password into it, e.g. printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin. `,
  ],
  [
    '--auth-token-stdin',
    `--auth-token-stdin takes no value: pipe the token into it, e.g. printf '%s\\n' "$TOKEN" | operate ... --auth-token-stdin. `,
  ],
];

/**
 * The option name of an unknown option token without its `=value`: commander quotes the whole
 * token, and `--auth-password=<password>` must not end up in the error.
 */
export function optionName(token: string): string {
  const equals = token.indexOf('=');
  return equals < 0 ? token : token.slice(0, equals);
}

/** The `--auth-*` flag meant by a renamed or guessed name, if the command has it. */
export function authFlagFor(name: string, known: readonly string[]): string[] {
  const flag = AUTH_FLAGS[name.toLowerCase()];
  return known.filter((candidate) => candidate === flag);
}

/** `--show-secrets` is no secret, but only some commands print credentials at all. */
const SHOW_SECRETS_HINT =
  '--show-secrets works where operate prints credentials: --dry-run and --verbose of API and workflow commands, api and ping, and config show. `operate auth` commands never print a token. ';

/**
 * A hint (with a trailing space) for an unknown option that looks like it wants a secret, or for
 * `--show-secrets` on a command without it.
 */
export function secretHint(name: string): string {
  if (name.toLowerCase() === '--show-secrets') return SHOW_SECRETS_HINT;
  return SECRET_NAME.test(name) ? SECRET_HINT : '';
}

/**
 * True when the command line selects bearer auth with `--auth bearer` or `--auth=bearer`: the
 * word after it is most likely the token (`--auth bearer $TOKEN`, as httpie's `--auth-type`).
 */
function selectsBearer(argv: readonly string[]): boolean {
  return argv.some(
    (token, index) =>
      /^--auth=bearer$/i.test(token) ||
      (token === '--auth' && argv[index + 1]?.toLowerCase() === 'bearer'),
  );
}

/**
 * True when the command line has an option about a secret, or `--auth bearer`: an extra argument
 * or an unknown command may then be the secret itself.
 */
export function mentionsSecret(argv: readonly string[]): boolean {
  return (
    argv.some((token) => token.startsWith('-') && SECRET_NAME.test(optionName(token))) ||
    selectsBearer(argv)
  );
}

const BEARER_TYPE_HINT =
  '--auth takes only the type: the token goes into OPERATE_TOKEN or --auth-token-stdin, not after --auth bearer. ';

/**
 * The hint for extra arguments next to `--auth-password-stdin`, `--auth-token-stdin` or
 * `--auth bearer`.
 */
export function stdinHint(argv: readonly string[]): string {
  const names = argv.map(optionName);
  const stdin = STDIN_HINTS.filter(([flag]) => names.includes(flag)).map(([, hint]) => hint);
  return [...stdin, selectsBearer(argv) ? BEARER_TYPE_HINT : ''].join('');
}
