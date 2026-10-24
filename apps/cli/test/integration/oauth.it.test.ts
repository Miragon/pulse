/**
 * OAuth 2.0 authorization code + PKCE (issue 2 of the archived operate repository) of the built
 * CLI against Keycloak and an unmodified engine behind an Envoy JWT gateway (support/oauth.ts). A
 * person logs in once with `pulse-cli auth login`; the test plays the browser over HTTP
 * (support/keycloak.ts). Every other command only reads the token cache, refreshes silently and
 * fails with LOGIN_REQUIRED (exit 4) instead of ever starting an interactive login (AI first).
 *
 * Every test that needs a login runs its own (0.1–0.6 s): several end their session on purpose.
 * Expiry is reached by rewriting the token cache where that is enough; the 5 s access tokens of
 * `operate-cli-short` cover the real expiry paths (proactive refresh, 401 from the gateway).
 * Every CLI run is checked against every token, code and client secret seen so far.
 */

import { realpath, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { registerFailures } from "./oauth/failures.js"
import { registerLogin } from "./oauth/login.js"
import { registerRefresh } from "./oauth/refresh.js"
import {
  CLIENT_SECRET_ENV,
  loginArgs,
  profilesOf,
  RUN_TIMEOUT_MS,
  type OAuthSuite,
} from "./oauth/suite.js"
import { globalFlag } from "./support/catalog.js"
import {
  assertCliBuilt,
  bindCli,
  bindStartCli,
  type Cli,
  type CliOptions,
  type CliResult,
  type StartCli,
} from "./support/cli.js"
import { expectSuccess, required } from "./support/expect.js"
import { CLIENT_SECRET, CLIENTS, endpointsOf, USER } from "./support/keycloak.js"
import { completeLogin, killRunningLogins, startLogin } from "./support/login.js"
import {
  oauthEngine,
  startOAuthTopology,
  TOPOLOGY_START_TIMEOUT_MS,
  type OAuthTopology,
} from "./support/oauth.js"
import { SecretLedger } from "./support/secrets.js"
import { makeTempDir, removeTempDir } from "./support/temp.js"
import {
  loginCacheFile,
  loginKeyOf,
  readCache,
  tokenDirectory,
  type CachedLogin,
} from "./support/token-cache.js"
import { traceOf } from "./support/trace.js"
import type { LoginOutput } from "./support/types.js"

const engine = oauthEngine()

describe.skipIf(engine === undefined)(`OAuth login and tokens against ${engine ?? ""}`, () => {
  let topology: OAuthTopology | undefined
  let workdir = ""
  let profilesFile = ""
  let ledger = new SecretLedger("")
  let cli: Cli = () => Promise.reject(new Error("the OAuth topology did not start"))
  let start: StartCli = () => {
    throw new Error("the OAuth topology did not start")
  }

  const top = () => required(topology, "the OAuth topology")
  /** The login command of a hint: the suite's config file is named by --config. */
  const LOGIN_HINT = (profile: string) =>
    `pulse-cli auth login --config ${profilesFile} --profile ${profile}`
  const tokenEndpoint = () => endpointsOf(top().issuer).token
  /** The cache file of a profile's login: its config file and stored settings. */
  const cacheFile = (profile: string) => {
    const profiles: Readonly<
      Record<string, { readonly auth: Record<string, unknown> } | undefined>
    > = profilesOf(top())
    const stored = required(profiles[profile]?.auth, profile)
    return loginCacheFile(workdir, loginKeyOf(profilesFile, stored))
  }
  /** Requests and answers of a run; `<engine>` is the gateway URL, `<token>` the token endpoint. */
  const trace = (result: CliResult) =>
    traceOf(result.stderr, { engine: top().url, token: tokenEndpoint(), issuer: top().issuer })
  const COUNT_REQUEST = "> GET <engine>/process-definition/count"

  /** Runs the CLI and checks that the output contains no secret. */
  async function run(args: readonly string[], options: CliOptions = {}): Promise<CliResult> {
    const result = await cli(args, { timeoutMs: RUN_TIMEOUT_MS, ...options })
    await ledger.expectHidden(result, args.includes(globalFlag("show-secrets")))
    return result
  }

  /** `pulse-cli auth login --profile <p> --no-browser` with the browser step done by the test. */
  async function login(profile: string, options: CliOptions = {}) {
    const pending = startLogin(start, loginArgs(profile), {
      timeoutMs: RUN_TIMEOUT_MS,
      ...options,
    })
    const done = await completeLogin(pending)
    ledger.add(done.browser.callback.get("code"))
    await ledger.expectHidden(done.result)
    expectSuccess(done.result)
    expect(done.browser.answer, done.result.diagnostics).toMatchObject({ status: 200 })
    expect(done.browser.answer.html).toContain("Logged in")
    const cache: CachedLogin = await readCache(cacheFile(profile))
    return { ...done, view: done.result.json<LoginOutput>(), cache }
  }

  beforeAll(async () => {
    assertCliBuilt()
    // resolved, so paths printed by the CLI compare equal (macOS: /var → /private/var)
    workdir = await realpath(await makeTempDir("pulse-cli-it-oauth-"))
    profilesFile = join(workdir, "profiles.json")
    ledger = new SecretLedger(tokenDirectory(workdir))
    const basicCredentials = (secret: string) =>
      Buffer.from(`${CLIENTS.confidential}:${secret}`, "utf8").toString("base64")
    ledger.add(CLIENT_SECRET, basicCredentials(CLIENT_SECRET), USER.password)
    topology = await startOAuthTopology(required(engine, "an enabled engine"))
    // no defaultProfile: a run without --profile uses the PULSE_CLI_OAUTH_* environment only
    await writeFile(
      profilesFile,
      `${JSON.stringify({ profiles: profilesOf(topology) }, null, 2)}\n`,
    )
    const defaults: CliOptions = {
      configFile: profilesFile,
      env: {
        // token caches land in <workdir>/pulse-cli/tokens, never in the real user config
        XDG_CONFIG_HOME: workdir,
        APPDATA: workdir,
        // only the BROWSER test may start a "browser"; every other login uses --no-browser
        BROWSER: undefined,
        DISPLAY: undefined,
        WAYLAND_DISPLAY: undefined,
        [CLIENT_SECRET_ENV]: undefined,
      },
    }
    cli = bindCli(defaults)
    start = bindStartCli(defaults)
  }, TOPOLOGY_START_TIMEOUT_MS)

  afterAll(async () => {
    killRunningLogins()
    await topology?.stop()
    await removeTempDir(workdir === "" ? undefined : workdir)
  })

  const suite: OAuthSuite = {
    cli: (args, options) => cli(args, options),
    start: (args, options) => start(args, options),
    top,
    get workdir() {
      return workdir
    },
    get ledger() {
      return ledger
    },
    LOGIN_HINT,
    tokenEndpoint,
    cacheFile,
    trace,
    COUNT_REQUEST,
    run,
    login,
  }
  registerLogin(suite)
  registerRefresh(suite)
  registerFailures(suite)
})
