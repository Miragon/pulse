/**
 * Bearer tokens from elsewhere (`--auth bearer`) of the built CLI against the OAuth
 * topology of support/oauth.ts: Keycloak issues the tokens without pulse-cli (a CI pipeline's client
 * credentials grant, a person's login through another tool), and Envoy's `jwt_authn` gateway
 * checks them in front of an unmodified engine. pulse-cli only sends `Authorization: Bearer
 * <token>`: no login, no refresh, no token cache.
 *
 * Token commands fetch such tokens for pulse-cli: PULSE_CLI_TOKEN_COMMAND runs a script
 * that runs the client credentials grant, also for the profiles of a project file,
 * whose directories share the cached token.
 *
 * The 5 s token of `pulse-cli-short` is issued first, in `beforeAll`, so the 30 s expiry grace of
 * the TOKEN_EXPIRED test mostly passes while the other tests run. Every CLI run is checked against
 * every token the suite has seen (and each JWT's signature on its own); only `--show-secrets` runs
 * may print the one token they send.
 */

import { readFile, realpath, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { registerErrors } from "./bearer/errors.js"
import { registerProfiles } from "./bearer/profiles.js"
import { registerSources } from "./bearer/sources.js"
import {
  GARBAGE,
  PROFILE,
  RUN_TIMEOUT_MS,
  STRAY_PASSWORD,
  TOKEN_ENV,
  type BearerSuite,
  type StoredConfig,
  type StoredProfile,
} from "./bearer/suite.js"
import { registerTokenCommands } from "./bearer/token-commands.js"
import {
  assertCliBuilt,
  bindCli,
  type Cli,
  type CliOptions,
  type CliResult,
} from "./support/cli.js"
import { required } from "./support/expect.js"
import { isJwt, signatureOf } from "./support/jwt.js"
import {
  CI_CLIENT_SECRET,
  clientCredentialsToken,
  CLIENTS,
  directLogin,
} from "./support/keycloak.js"
import {
  oauthEngine,
  startOAuthTopology,
  TOPOLOGY_START_TIMEOUT_MS,
  type OAuthTopology,
} from "./support/oauth.js"
import type { EnvOverrides } from "./support/process.js"
import { makeTempDir, removeTempDir } from "./support/temp.js"
import { traceOf } from "./support/trace.js"

const engine = oauthEngine()

describe.skipIf(engine === undefined)(`Bearer tokens from elsewhere at ${engine ?? ""}`, () => {
  let topology: OAuthTopology | undefined
  let workdir: string | undefined
  /** Config file of the runs without a profile: empty, so only the environment counts. */
  let configFile = ""
  /** Config file of the profile tests. */
  let profilesFile = ""
  /** A CI pipeline's token: client credentials grant of `pulse-ci`, a JWT valid for 300 s. */
  let ciToken = ""
  /** A person's 5 s token (`pulse-cli-short`), issued first; it expires while the suite runs. */
  let staleToken = ""
  /** Everything no output may contain (tokens, their signatures, stray credentials). */
  const secrets = new Set<string>()
  let cli: Cli = () => Promise.reject(new Error("the OAuth topology did not start"))

  const top = () => required(topology, "the OAuth topology")
  /** Requests and answers of a `--verbose` run; `<engine>` is the gateway URL. */
  const trace = (result: CliResult) => traceOf(result.stderr, { engine: top().url })

  /** Records tokens (for a JWT also its signature) that no output may contain. */
  function remember(...values: readonly string[]): void {
    for (const value of values) {
      secrets.add(value)
      if (isJwt(value)) secrets.add(signatureOf(value))
    }
  }

  /** Neither stdout nor stderr contains a secret; `revealed` (a `--show-secrets` run) may show. */
  function expectHidden(result: CliResult, revealed?: string): void {
    const allowed = revealed === undefined ? [] : [revealed, signatureOf(revealed)]
    for (const secret of secrets) {
      if (allowed.includes(secret)) continue
      const where = `${result.command}\nexit code ${result.code}`
      expect(result.stdout.includes(secret), `stdout reveals a secret\n${where}`).toBe(false)
      expect(result.stderr.includes(secret), `stderr reveals a secret\n${where}`).toBe(false)
    }
  }

  /** Runs the CLI and checks that the output contains no secret except `revealed`. */
  async function run(
    args: readonly string[],
    options: CliOptions = {},
    revealed?: string,
  ): Promise<CliResult> {
    const result = await cli(args, { timeoutMs: RUN_TIMEOUT_MS, ...options })
    expectHidden(result, revealed)
    return result
  }

  async function readProfiles(): Promise<StoredConfig["profiles"]> {
    return (JSON.parse(await readFile(profilesFile, "utf8")) as StoredConfig).profiles
  }

  /** Adds or replaces a profile in the profiles file directly (not through `config set`). */
  async function writeProfile(name: string, profile: StoredProfile): Promise<void> {
    const next = { profiles: { ...(await readProfiles()), [name]: profile } }
    await writeFile(profilesFile, `${JSON.stringify(next, null, 2)}\n`)
  }

  /** Options of a run with the profiles file: the profile's URL counts, not PULSE_CLI_URL. */
  function profiles(env: EnvOverrides = {}, options: CliOptions = {}): CliOptions {
    return { ...options, configFile: profilesFile, env: { PULSE_CLI_URL: undefined, ...env } }
  }

  beforeAll(async () => {
    assertCliBuilt()
    // resolved, so paths printed by the CLI compare equal (macOS: /var → /private/var)
    workdir = await realpath(await makeTempDir("pulse-cli-it-bearer-"))
    configFile = join(workdir, "config.json")
    profilesFile = join(workdir, "profiles.json")
    // PULSE_CLI_CONFIG names the file explicitly, so it must exist (an empty one: no profiles)
    await writeFile(configFile, '{"profiles":{}}\n')
    await writeFile(profilesFile, '{"profiles":{}}\n')
    topology = await startOAuthTopology(required(engine, "an enabled engine"))
    // first: its expiry and the 30 s grace pass while the other tests run
    staleToken = (await directLogin(topology.issuer, CLIENTS.short, "openid")).accessToken
    ciToken = await clientCredentialsToken(topology.issuer, CLIENTS.ci, CI_CLIENT_SECRET)
    remember(staleToken, ciToken, CI_CLIENT_SECRET, GARBAGE, STRAY_PASSWORD)
    await writeProfile(PROFILE.fixed, {
      url: topology.url,
      auth: { type: "bearer", tokenEnv: TOKEN_ENV },
    })
    cli = bindCli({
      url: topology.url,
      configFile,
      env: {
        // no token cache or user config may be read or written outside the suite's directory
        XDG_CONFIG_HOME: workdir,
        APPDATA: workdir,
        [TOKEN_ENV]: undefined,
      },
    })
  }, TOPOLOGY_START_TIMEOUT_MS)

  afterAll(async () => {
    await topology?.stop()
    await removeTempDir(workdir)
  })

  const suite: BearerSuite = {
    cli: (args, options) => cli(args, options),
    top,
    get workdir() {
      return workdir
    },
    get configFile() {
      return configFile
    },
    get profilesFile() {
      return profilesFile
    },
    get ciToken() {
      return ciToken
    },
    get staleToken() {
      return staleToken
    },
    trace,
    remember,
    expectHidden,
    run,
    readProfiles,
    writeProfile,
    profiles,
  }
  registerSources(suite)
  registerProfiles(suite)
  registerErrors(suite)
  registerTokenCommands(suite)
})
