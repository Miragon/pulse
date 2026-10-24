/**
 * `operate auth login` as a child process whose browser step the test performs over HTTP: the CLI
 * prints the authorization URL on stderr (the only line indented by two spaces, design §16.4) and
 * waits on its loopback server; the test reads the URL and logs in at Keycloak, whose redirect
 * delivers the code to that server.
 */

import type { CliOptions, CliResult, RunningCli, StartCli } from './cli.js';
import { type BrowserLogin, type Credentials, keycloakLogin, USER } from './keycloak.js';

/** The authorization URL line of `operate auth login` (design §16.4 step 6). */
const URL_LINE = /^ {2}(https?:\/\/\S+)$/m;
/** The redirect URI of every login: the loopback interface, any port, path `/callback`. */
const REDIRECT_URI = /^http:\/\/127\.0\.0\.1:(\d+)\/callback$/;

/** Logins still running; a failed test may leave one behind, `killRunningLogins` ends them. */
const running = new Set<RunningCli>();

export interface PendingLogin {
  readonly cli: RunningCli;
  /** The authorization URL exactly as printed; resolves as soon as the line arrives. */
  authorizationUrl(): Promise<string>;
  /** The `redirect_uri` of the authorization URL and its port. */
  redirect(): Promise<{ readonly uri: string; readonly port: number }>;
  /** The loopback callback URL with these query parameters (to send forged callbacks). */
  callbackUrl(query: Readonly<Record<string, string>>): Promise<string>;
  /** Waits for the CLI to end. */
  result(): Promise<CliResult>;
}

/** Starts `operate <args>` (an `auth login` command line) and tracks it until it ends. */
export function startLogin(
  start: StartCli,
  args: readonly string[],
  options: CliOptions = {},
): PendingLogin {
  const cli = start(args, options);
  running.add(cli);
  const done = cli.result().finally(() => running.delete(cli));
  // the test awaits `result()`; a test that fails earlier must not cause an unhandled rejection
  done.catch(() => undefined);
  const authorizationUrl = async () => (await cli.waitForStderr(URL_LINE))[1] ?? '';
  const redirect = async () => {
    const uri = new URL(await authorizationUrl()).searchParams.get('redirect_uri') ?? '';
    const port = REDIRECT_URI.exec(uri)?.[1];
    if (port === undefined) throw new Error(`Unexpected redirect_uri "${uri}"`);
    return { uri, port: Number(port) };
  };
  return {
    cli,
    authorizationUrl,
    redirect,
    callbackUrl: async (query) => {
      const url = new URL((await redirect()).uri);
      url.search = new URLSearchParams(query).toString();
      return url.toString();
    },
    result: () => done,
  };
}

export interface CompletedLogin {
  /** The authorization URL as printed. */
  readonly url: string;
  readonly browser: BrowserLogin;
  readonly result: CliResult;
}

/** Performs the browser step of a pending login with the user's credentials and waits for the CLI. */
export async function completeLogin(
  login: PendingLogin,
  credentials: Credentials = USER,
): Promise<CompletedLogin> {
  const url = await login.authorizationUrl();
  const browser = await keycloakLogin(url, credentials);
  return { url, browser, result: await login.result() };
}

/** Kills every login child that is still running (afterAll; Ryuk only reaps containers). */
export function killRunningLogins(): void {
  for (const cli of running) cli.kill();
  running.clear();
}
