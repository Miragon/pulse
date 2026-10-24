/**
 * OAuth 2.0 authorization code + PKCE (GitHub issue #2, design §16) of the built CLI against
 * Keycloak and an unmodified engine behind an Envoy JWT gateway (support/oauth.ts, design
 * §16.14.1). A person logs in once with `operate auth login`; the test plays the browser over HTTP
 * (support/keycloak.ts). Every other command only reads the token cache, refreshes silently and
 * fails with LOGIN_REQUIRED (exit 4) instead of ever starting an interactive login (AI first).
 *
 * Every test that needs a login runs its own (0.1–0.6 s): several end their session on purpose.
 * Expiry is reached by rewriting the token cache where that is enough; the 5 s access tokens of
 * `operate-cli-short` cover the real expiry paths (proactive refresh, 401 from the gateway).
 * Every CLI run is checked against every token, code and client secret seen so far.
 */

import { existsSync } from "node:fs"
import { readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { networkInterfaces } from "node:os"
import { basename, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { argv, globalFlag } from "./support/catalog.js"
import {
  assertCliBuilt,
  bindCli,
  bindStartCli,
  type Cli,
  type CliOptions,
  type CliResult,
  type StartCli,
} from "./support/cli.js"
import { ENGINES } from "./support/engines.js"
import { expectError, expectSuccess, required } from "./support/expect.js"
import { claimsOf } from "./support/jwt.js"
import {
  adminLogout,
  CLIENT_SECRET,
  CLIENTS,
  directLogin,
  endpointsOf,
  openAuthorizationUrl,
  refreshRequest,
  USER,
} from "./support/keycloak.js"
import { completeLogin, killRunningLogins, startLogin } from "./support/login.js"
import {
  type OAuthTopology,
  oauthEngine,
  startOAuthTopology,
  TOPOLOGY_START_TIMEOUT_MS,
} from "./support/oauth.js"
import { SecretLedger } from "./support/secrets.js"
import { makeTempDir, removeTempDir } from "./support/temp.js"
import {
  type CachedLogin,
  envCacheFileName,
  loginCacheFile,
  loginKeyOf,
  readCache,
  tokenDirectory,
  writeCache,
} from "./support/token-cache.js"
import { MASKED_BEARER, SENT_REQUEST, tokenRequests, traceOf, URL_LINE } from "./support/trace.js"
import type {
  ConfigShowOutput,
  Count,
  DryRunOutput,
  LoginOutput,
  LogoutOutput,
  PingOutput,
  ProcessDefinition,
} from "./support/types.js"

const engine = oauthEngine()

/** Profiles of the suite's config file (design §16.14.2). */
const PROFILE = {
  /** operate-cli, audience engine-rest (sent, ignored by Keycloak), offline token */
  it: "it",
  /** operate-cli-short: 5 s access tokens */
  short: "short",
  /** operate-cli-short with scopes ["openid"]: an online session, which an admin logout ends */
  online: "online",
  /** operate-cli-confidential, secret from IT_CLIENT_SECRET */
  conf: "conf",
  /** operate-cli-noaud: Envoy answers 403 */
  noaud: "noaud",
  /** a client id Keycloak does not know */
  wrongClient: "wrong-client",
  /** operate-cli with the issuer spelled http://127.0.0.1:<port>/... (only with Docker on localhost) */
  loopbackIp: "loopback-ip",
  /** operate-cli like "it" with the email scope: two profiles that share a login, names differ in case */
  caseLower: "case-it",
  caseUpper: "Case-It",
} as const

const CLIENT_SECRET_ENV = "IT_CLIENT_SECRET"
const UNKNOWN_CLIENT = "operate-cli-unknown"
const AUDIENCE = "engine-rest"
const DEFAULT_SCOPES = ["openid", "offline_access"]
/** The scopes of the profiles that share a login: other than those of "it", so a login of their own. */
const SHARED = ["openid", "offline_access", "email"]
/** Generous: once, with ~25 unrelated containers running, a Keycloak login took 40 s. */
const RUN_TIMEOUT_MS = 90_000
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/
const IGNORED_STATE = /Ignored a login callback without the right state/g

function loginArgs(profile: string, ...extra: string[]): string[] {
  return ["auth", "login", "--profile", profile, "--no-browser", ...extra]
}

function authArgs(command: "status" | "logout", profile: string, ...extra: string[]): string[] {
  return ["auth", command, "--profile", profile, ...extra]
}

/** `operate process-definition count --profile <profile> [flags...]`, a read the gateway guards. */
function countArgs(profile: string, ...flags: string[]): string[] {
  return [...argv("process-definition count"), globalFlag("profile"), profile, ...flags]
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
}

/** A non-loopback IPv4 address of this machine, if it has one. */
function externalIpv4(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((info) => info?.family === "IPv4" && !info.internal)?.address
}

/** Whether an HTTP server answers at `url` (any status); false when the connection fails. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5_000) })
    return true
  } catch {
    return false
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() > deadline) return value
    await sleep(50)
  }
}

function profilesOf({ url, issuer, host, keycloakPort }: OAuthTopology) {
  const oauth = (auth: Readonly<Record<string, unknown>>) => ({
    url,
    auth: { type: "oauth", issuer, ...auth },
  })
  const loopbackIssuer = `http://127.0.0.1:${keycloakPort}/realms/operate`
  return {
    [PROFILE.it]: oauth({ clientId: CLIENTS.public, audience: AUDIENCE }),
    [PROFILE.short]: oauth({ clientId: CLIENTS.short }),
    [PROFILE.online]: oauth({ clientId: CLIENTS.short, scopes: ["openid"] }),
    [PROFILE.conf]: oauth({ clientId: CLIENTS.confidential, clientSecretEnv: CLIENT_SECRET_ENV }),
    [PROFILE.noaud]: oauth({ clientId: CLIENTS.noAudience }),
    [PROFILE.wrongClient]: oauth({ clientId: UNKNOWN_CLIENT, audience: AUDIENCE }),
    [PROFILE.caseLower]: oauth({ clientId: CLIENTS.public, audience: AUDIENCE, scopes: SHARED }),
    [PROFILE.caseUpper]: oauth({ clientId: CLIENTS.public, audience: AUDIENCE, scopes: SHARED }),
    // Keycloak issues tokens for whatever host name the client used; only "localhost" has a twin
    ...(host === "localhost"
      ? { [PROFILE.loopbackIp]: oauth({ clientId: CLIENTS.public, issuer: loopbackIssuer }) }
      : {}),
  }
}

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
  /** The login command of a hint: the suite's config file is named by --config (design §16.5). */
  const LOGIN_HINT = (profile: string) =>
    `operate auth login --config ${profilesFile} --profile ${profile}`
  const tokenEndpoint = () => endpointsOf(top().issuer).token
  /** The cache file of a profile's login (design §16.5): its config file and stored settings. */
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

  /** `operate auth login --profile <p> --no-browser` with the browser step done by the test. */
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
    workdir = await realpath(await makeTempDir("operate-it-oauth-"))
    profilesFile = join(workdir, "profiles.json")
    ledger = new SecretLedger(tokenDirectory(workdir))
    const basicCredentials = (secret: string) =>
      Buffer.from(`${CLIENTS.confidential}:${secret}`, "utf8").toString("base64")
    ledger.add(CLIENT_SECRET, basicCredentials(CLIENT_SECRET), USER.password)
    topology = await startOAuthTopology(required(engine, "an enabled engine"))
    // no defaultProfile: a run without --profile uses the OPERATE_OAUTH_* environment only
    await writeFile(
      profilesFile,
      `${JSON.stringify({ profiles: profilesOf(topology) }, null, 2)}\n`,
    )
    const defaults: CliOptions = {
      configFile: profilesFile,
      env: {
        // token caches land in <workdir>/operate/tokens, never in the real user config
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

  it("runs against a gateway that refuses bad tokens and a realm that rotates refresh tokens strictly", async () => {
    const { url, issuer } = top()
    const missing = await fetch(`${url}/version`)
    expect(missing.status).toBe(401)
    expect(await missing.text()).toBe("Jwt is missing")
    const garbage = await fetch(`${url}/version`, { headers: { authorization: "Bearer x.y.z" } })
    expect(garbage.status).toBe(401)

    // a login without the CLI, so this proves the environment, not the code under test
    const tokens = await directLogin(issuer, CLIENTS.public, DEFAULT_SCOPES.join(" "))
    const authorized = await fetch(`${url}/version`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(authorized.status).toBe(200)
    expect(await authorized.json()).toEqual({ version: ENGINES[top().engine].version })

    // an uncoordinated second use of a refresh token ends the session for everyone
    const first = await refreshRequest(issuer, CLIENTS.public, tokens.refreshToken)
    expect(first.status).toBe(200)
    const replay = await refreshRequest(issuer, CLIENTS.public, tokens.refreshToken)
    expect(replay).toMatchObject({
      status: 400,
      body: {
        error: "invalid_grant",
        error_description: "Maximum allowed refresh token reuse exceeded",
      },
    })
    const rotated = await refreshRequest(issuer, CLIENTS.public, String(first.body.refresh_token))
    expect(rotated).toMatchObject({ status: 400, body: { error: "invalid_grant" } })
  })

  it("fails with LOGIN_REQUIRED and never starts a login when nobody logged in", async () => {
    // a hanging login would hit this timeout instead of exiting
    const quick = { timeoutMs: 30_000 }
    const ping = await run(
      ["ping", globalFlag("profile"), PROFILE.it, globalFlag("verbose")],
      quick,
    )
    const error = expectError(ping, "LOGIN_REQUIRED", 4)
    expect(error.message).toBe('Not logged in: profile "it" has no OAuth login')
    expect(error.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(error.hint).toContain("in a terminal")
    expect(ping.stdout).toBe("")
    expect(ping.stderr).not.toMatch(SENT_REQUEST)
    expect(ping.stderr).not.toMatch(URL_LINE)

    const status = await run(authArgs("status", PROFILE.it), quick)
    expect(expectError(status, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(status.stdout).toBe("")

    const preview = await run(countArgs(PROFILE.it, globalFlag("dry-run")), quick)
    const request = expectSuccess(preview).json<DryRunOutput>()
    expect(headerValue(request.headers, "authorization")).toBeUndefined()
    expect(preview.stderr).toContain('Note: Not logged in with OAuth (profile "it")')
    expect(preview.stderr).toContain(LOGIN_HINT(PROFILE.it))
    expect(preview.stderr).not.toMatch(SENT_REQUEST)
    expect(existsSync(cacheFile(PROFILE.it))).toBe(false)
  })

  it("logs in with auth code + PKCE on a loopback port and caches the tokens with mode 0600", async () => {
    const { issuer } = top()
    const pending = startLogin(start, loginArgs(PROFILE.it), { timeoutMs: RUN_TIMEOUT_MS })
    const printedUrl = await pending.authorizationUrl()
    const printed = new URL(printedUrl)
    const { uri: redirectUri, port } = await pending.redirect()
    expect(`${printed.origin}${printed.pathname}`).toBe(endpointsOf(issuer).authorization)
    expect(Object.fromEntries(printed.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENTS.public,
      redirect_uri: redirectUri,
      scope: "openid offline_access",
      state: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
      audience: AUDIENCE,
    })
    expect(printed.searchParams.get("state")).not.toBe(printed.searchParams.get("code_challenge"))

    // the loopback server answers on 127.0.0.1 only, and only on GET /callback
    const probe = await fetch(`http://127.0.0.1:${port}/favicon.ico`)
    expect(probe.status).toBe(404)
    const post = await fetch(redirectUri, { method: "POST" })
    expect(post.status).toBe(405)
    const external = externalIpv4()
    if (external !== undefined) expect(await answers(`http://${external}:${port}/`)).toBe(false)

    const { browser, result } = await completeLogin(pending)
    ledger.add(browser.callback.get("code"))
    expect(browser.callback.get("iss")).toBe(issuer)
    expect(browser.answer.status).toBe(200)
    expect(browser.answer.html).toContain("Logged in")
    await ledger.expectHidden(result)
    expectSuccess(result)
    expect(result.stderr).toContain(
      `Logging in to ${issuer} as client ${CLIENTS.public} (profile "it").\n` +
        `Open this URL in a browser to log in:\n  ${printedUrl}\n`,
    )
    expect(result.stderr).toContain(
      `Waiting up to 300 s for the login at ${redirectUri} (Ctrl+C cancels).`,
    )
    expect(result.stderr).toContain('Logged in as operate-user (profile "it").')
    // --no-browser: neither browser line
    expect(result.stderr).not.toContain("Opened the system browser.")
    expect(result.stderr).not.toContain("Could not open a browser")
    expect(await answers(`http://127.0.0.1:${port}/`)).toBe(false)

    const view = result.json<LoginOutput>()
    expect(view).toEqual({
      profile: PROFILE.it,
      profiles: [PROFILE.it],
      issuer,
      clientId: CLIENTS.public,
      user: USER.username,
      subject: expect.stringMatching(/^[\w-]+$/),
      scopes: expect.arrayContaining(DEFAULT_SCOPES),
      accessTokenExpiresAt: expect.stringMatching(ISO_INSTANT),
      accessTokenValid: true,
      refreshTokenExpiresAt: expect.stringMatching(ISO_INSTANT),
      canRefresh: true,
      loggedInAt: expect.stringMatching(ISO_INSTANT),
      refreshedAt: null,
      tokenCache: cacheFile(PROFILE.it),
    })
    const loggedInAt = Date.parse(view.loggedInAt)
    const accessLifetime = Date.parse(view.accessTokenExpiresAt ?? "") - loggedInAt
    expect(accessLifetime).toBeGreaterThan(295_000)
    expect(accessLifetime).toBeLessThanOrEqual(300_000)
    // offline token: 30 days idle
    const refreshLifetime = Date.parse(view.refreshTokenExpiresAt ?? "") - loggedInAt
    expect(refreshLifetime).toBeGreaterThan(2_591_000_000)
    expect(refreshLifetime).toBeLessThanOrEqual(2_592_000_000)

    const cache = await readCache(cacheFile(PROFILE.it))
    expect(cache).toEqual({
      version: 1,
      identity: {
        issuer,
        tokenEndpoint: null,
        clientId: CLIENTS.public,
        audience: AUDIENCE,
        scopes: ["offline_access", "openid"],
      },
      endpoints: {
        token: tokenEndpoint(),
        revocation: endpointsOf(issuer).revocation,
        clientAuthMethod: "none",
      },
      tokenType: "Bearer",
      accessToken: expect.stringMatching(JWT),
      expiresAt: Date.parse(view.accessTokenExpiresAt ?? ""),
      refreshToken: expect.stringMatching(JWT),
      refreshExpiresAt: Date.parse(view.refreshTokenExpiresAt ?? ""),
      scope: expect.stringContaining("offline_access"),
      subject: view.subject,
      user: USER.username,
      loggedInAt,
      refreshedAt: null,
    })
    // the gateway accepts exactly this issuer and audience
    expect(claimsOf(cache.accessToken)).toMatchObject({
      iss: issuer,
      aud: expect.arrayContaining([AUDIENCE]),
      azp: CLIENTS.public,
    })
    if (process.platform !== "win32") {
      expect((await stat(cacheFile(PROFILE.it))).mode & 0o777).toBe(0o600)
      expect((await stat(tokenDirectory(workdir))).mode & 0o777).toBe(0o700)
    }
  })

  it("sends the Bearer token on every request and never prints it unless --show-secrets", async () => {
    const { cache, view } = await login(PROFILE.it)
    const count = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    expect(expectSuccess(count).json<Count>()).toEqual({ count: expect.any(Number) })
    // the fresh 300 s token is used as it is: no token request
    expect(trace(count)).toEqual([COUNT_REQUEST, "< 200"])
    expect(count.stderr).toMatch(MASKED_BEARER)

    const list = await run([...argv("process-definition list"), globalFlag("profile"), PROFILE.it])
    expect(expectSuccess(list).json<ProcessDefinition[]>()).toEqual(expect.any(Array))

    const ping = await run(["ping", globalFlag("profile"), PROFILE.it])
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
      url: top().url,
      reachable: true,
      auth: "oauth",
      user: USER.username,
    })

    const revealed = await run(
      countArgs(PROFILE.it, globalFlag("verbose"), globalFlag("show-secrets")),
    )
    expect(expectSuccess(revealed).stderr).toMatch(
      new RegExp(`^> authorization: Bearer ${cache.accessToken.replaceAll(".", "\\.")}$`, "im"),
    )
    // the ledger knows the cached tokens, so its checks of every other run are not vacuous
    await expect(ledger.expectHidden(revealed)).rejects.toThrow(/stderr reveals a secret/)

    const preview = await run(countArgs(PROFILE.it, globalFlag("dry-run")))
    const request = expectSuccess(preview).json<DryRunOutput>()
    expect(headerValue(request.headers, "authorization")).toBe("Bearer ***")
    expect(request.curl).toMatch(/'authorization: Bearer \*\*\*'/i)
    expect(preview.stderr).not.toMatch(SENT_REQUEST)
    expect(preview.stderr).not.toContain("Note:")

    const show = await run(["config", "show", globalFlag("profile"), PROFILE.it])
    expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
      profile: PROFILE.it,
      values: {
        auth: { value: "oauth", source: "profile" },
        issuer: { value: top().issuer, source: "profile" },
        clientId: { value: CLIENTS.public, source: "profile" },
        audience: { value: AUDIENCE, source: "profile" },
      },
    })

    const status = await run(authArgs("status", PROFILE.it))
    expect(expectSuccess(status).json<LoginOutput>()).toEqual(view)
    const table = await run(authArgs("status", PROFILE.it, "-o", "table"))
    expect(expectSuccess(table).stdout).toMatch(
      new RegExp(`^subject\\s+${view.subject ?? "missing"}\\s*$`, "m"),
    )
    expect(table.stdout).toMatch(
      new RegExp(`^accessTokenExpiresAt\\s+${view.accessTokenExpiresAt ?? "missing"}\\s*$`, "m"),
    )
    // nothing above needed a refresh
    expect((await readCache(cacheFile(PROFILE.it))).accessToken).toBe(cache.accessToken)
  })

  it("refreshes the access token before it expires and stores each rotated refresh token", async () => {
    let { cache } = await login(PROFILE.short)
    let spent = ""
    for (let round = 1; round <= 3; round += 1) {
      // a 5 s token needs a refresh from 2.5 s on (margin: half the lifetime, at most 60 s)
      await sleep(3_000)
      const result = await run(countArgs(PROFILE.short, globalFlag("verbose")))
      expectSuccess(result)
      expect(trace(result), `round ${round}`).toEqual([
        "> POST <token>",
        "< 200",
        COUNT_REQUEST,
        "< 200",
      ])
      const next = await readCache(cacheFile(PROFILE.short))
      expect(next.accessToken).not.toBe(cache.accessToken)
      expect(next.refreshToken).toEqual(expect.any(String))
      expect(next.refreshToken).not.toBe(cache.refreshToken)
      expect(next.refreshedAt).toBeGreaterThan(cache.refreshedAt ?? cache.loggedInAt)
      const lifetime = (next.expiresAt ?? 0) - (next.refreshedAt ?? 0)
      // Keycloak answers expires_in = exp - now in whole seconds: 4 when a second boundary passes
      expect(lifetime).toBeGreaterThanOrEqual(4_000)
      expect(lifetime).toBeLessThanOrEqual(5_000)
      spent = cache.refreshToken ?? ""
      cache = next
    }
    // operate really sent the previous refresh token: Keycloak treats a second use as a replay
    // (this ends the session, so it is the last step)
    const replay = await refreshRequest(top().issuer, CLIENTS.short, spent)
    expect(replay).toMatchObject({ status: 400, body: { error: "invalid_grant" } })
  })

  it("makes one token request for six parallel commands that all need a refresh", async () => {
    const { cache } = await login(PROFILE.it)
    // the 300 s token stays valid at the gateway, but every command now wants to refresh it
    await writeCache(cacheFile(PROFILE.it), { expiresAt: Date.now() - 1_000 })
    const results = await Promise.all(
      Array.from({ length: 6 }, () => run(countArgs(PROFILE.it, globalFlag("verbose")))),
    )
    for (const result of results) expectSuccess(result)
    // one leader refreshes under the lock; the others adopt its token from the file
    expect(
      tokenRequests(
        results.map((result) => result.stderr),
        tokenEndpoint(),
      ),
    ).toBe(1)
    const refreshed = await readCache(cacheFile(PROFILE.it))
    expect(refreshed.refreshToken).not.toBe(cache.refreshToken)
    expect(refreshed.refreshedAt).toEqual(expect.any(Number))

    // the session is alive (a second refresh with the same token would have ended it)
    const after = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    expect(trace(expectSuccess(after))).toEqual([COUNT_REQUEST, "< 200"])
  })

  it("refreshes once after the gateway rejects an expired access token with 401", async () => {
    const { cache } = await login(PROFILE.short)
    // the gateway's clock decides; wait until the token is expired there (1 s skew allowed)
    const expiry = Math.max(Number(claimsOf(cache.accessToken).exp) * 1_000, cache.expiresAt ?? 0)
    await sleep(Math.max(0, expiry + 2_500 - Date.now()))
    const expired = await fetch(`${top().url}/version`, {
      headers: { authorization: `Bearer ${cache.accessToken}` },
    })
    expect(expired.status).toBe(401)
    expect(await expired.text()).toBe("Jwt is expired")
    // operate believes the token is good for another hour and sends it
    await writeCache(cacheFile(PROFILE.short), { expiresAt: Date.now() + 3_600_000 })

    const result = await run(countArgs(PROFILE.short, globalFlag("verbose")))
    expect(expectSuccess(result).json<Count>()).toEqual({ count: expect.any(Number) })
    expect(trace(result)).toEqual([
      COUNT_REQUEST,
      "< 401",
      "> POST <token>",
      "< 200",
      COUNT_REQUEST,
      "< 200",
    ])
    const refreshed = await readCache(cacheFile(PROFILE.short))
    expect(refreshed.accessToken).not.toBe(cache.accessToken)
    expect(refreshed.refreshToken).not.toBe(cache.refreshToken)
    expect(refreshed.expiresAt).toBeLessThan(Date.now() + 60_000)
  })

  it("asks for a new login when the refresh token is expired, missing or rejected", async () => {
    const { cache } = await login(PROFILE.it)
    const file = cacheFile(PROFILE.it)
    const past = Date.now() - 60_000
    const pastIso = new Date(past).toISOString()

    await writeCache(file, { expiresAt: past, refreshExpiresAt: past })
    const expired = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    const expiredError = expectError(expired, "LOGIN_REQUIRED", 4)
    expect(expiredError.message).toBe(`The OAuth login of profile "it" expired at ${pastIso}`)
    expect(expiredError.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(expired.stderr).not.toMatch(SENT_REQUEST)
    expectError(await run(authArgs("status", PROFILE.it)), "LOGIN_REQUIRED", 4)

    await writeCache(file, { expiresAt: past, refreshToken: null, refreshExpiresAt: null })
    const missing = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    const missingError = expectError(missing, "LOGIN_REQUIRED", 4)
    expect(missingError.message).toBe(
      `The access token of profile "it" expired at ${pastIso} and there is no refresh token`,
    )
    expect(missingError.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(missingError.hint).toContain("offline_access")
    expect(missing.stderr).not.toMatch(SENT_REQUEST)

    const garbage = "not-a-refresh-token-it"
    ledger.add(garbage)
    await writeCache(file, {
      expiresAt: past,
      refreshToken: garbage,
      refreshExpiresAt: cache.refreshExpiresAt,
    })
    const before = await readCache(file)
    const rejected = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    const rejectedError = expectError(rejected, "LOGIN_REQUIRED", 4)
    expect(rejectedError.message).toContain("invalid_grant")
    expect(rejectedError.message).toContain("Invalid refresh token")
    expect(rejectedError.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(trace(rejected)).toEqual(["> POST <token>", "< 400"])
    // a refused refresh keeps the tokens and records the refusal: only login and logout
    // replace a login, and auth status and later commands know without asking again
    expect(await readCache(file)).toEqual({
      ...before,
      refreshRejected: {
        at: expect.any(Number) as number,
        error: "invalid_grant: Invalid refresh token",
      },
    })
    const status = await run(authArgs("status", PROFILE.it))
    expect(expectError(status, "LOGIN_REQUIRED", 4).message).toMatch(
      /^The authorization server rejected the refresh token of profile "it" at \S+ \(invalid_grant: Invalid refresh token\)$/,
    )
    const again = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    expect(expectError(again, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(again.stderr).not.toMatch(SENT_REQUEST)
  })

  it("asks for a new login when the session ended at the authorization server", async () => {
    await login(PROFILE.online)
    await adminLogout(top().keycloakUrl, USER.username)
    await writeCache(cacheFile(PROFILE.online), { expiresAt: Date.now() - 1_000 })
    const result = await run(countArgs(PROFILE.online, globalFlag("verbose")))
    const error = expectError(result, "LOGIN_REQUIRED", 4)
    expect(error.message).toContain("invalid_grant")
    expect(error.message).toContain("Session not active")
    expect(error.hint).toContain(LOGIN_HINT(PROFILE.online))
    expect(trace(result)).toEqual(["> POST <token>", "< 400"])
  })

  it("logs out: revokes the refresh token and removes the cache", async () => {
    const { cache } = await login(PROFILE.it)
    const logout = await run(authArgs("logout", PROFILE.it))
    expect(expectSuccess(logout).json<LogoutOutput>()).toEqual({
      profile: PROFILE.it,
      profiles: [PROFILE.it],
      tokenCache: cacheFile(PROFILE.it),
      removed: true,
      revoked: true,
    })
    expect(logout.stderr).toContain(
      `Note: the access token issued before stays valid until ${new Date(cache.expiresAt ?? 0).toISOString()} at gateways that check tokens offline.`,
    )
    expect(existsSync(cacheFile(PROFILE.it))).toBe(false)

    const refresh = await refreshRequest(top().issuer, CLIENTS.public, cache.refreshToken ?? "")
    expect(refresh).toMatchObject({
      status: 400,
      body: { error: "invalid_grant", error_description: "Offline user session not found" },
    })
    // Envoy checks JWTs offline: the issued access token works until it expires (documented)
    const stillValid = await fetch(`${top().url}/version`, {
      headers: { authorization: `Bearer ${cache.accessToken}` },
    })
    expect(stillValid.status).toBe(200)

    const after = await run(countArgs(PROFILE.it))
    expect(expectError(after, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(PROFILE.it))
    const again = await run(authArgs("logout", PROFILE.it))
    expect(expectSuccess(again).json<LogoutOutput>()).toMatchObject({
      removed: false,
      revoked: null,
    })
  })

  it("shares one login between profiles with the same settings, also names that differ in case", async () => {
    const { caseLower, caseUpper } = PROFILE
    const lower = await login(caseLower)
    expect(lower.view).toMatchObject({
      profile: caseLower,
      profiles: [caseLower, caseUpper],
      tokenCache: cacheFile(caseUpper),
    })
    expect(lower.result.stderr).toContain(
      `The login also serves another profile with the same issuer, client, audience and scopes:\n  ${caseUpper}  ${top().url}\n`,
    )
    expect(cacheFile(caseLower)).not.toBe(cacheFile(PROFILE.it))

    // the other profile uses the login and its refresh, and the first one the rotated token
    await writeCache(cacheFile(caseUpper), { expiresAt: Date.now() - 1_000 })
    const refreshed = await run(countArgs(caseUpper, globalFlag("verbose")))
    expect(expectSuccess(refreshed).json<Count>()).toEqual({ count: expect.any(Number) })
    expect(trace(refreshed)).toEqual(["> POST <token>", "< 200", COUNT_REQUEST, "< 200"])
    const rotated = await readCache(cacheFile(caseLower))
    expect(rotated.refreshToken).not.toBe(lower.cache.refreshToken)
    const reused = await run(countArgs(caseLower, globalFlag("verbose")))
    expect(trace(expectSuccess(reused))).toEqual([COUNT_REQUEST, "< 200"])

    // a logout of either ends it for both
    const logout = await run(authArgs("logout", caseUpper))
    expect(expectSuccess(logout).json<LogoutOutput>()).toMatchObject({
      profile: caseUpper,
      profiles: [caseLower, caseUpper],
      removed: true,
      revoked: true,
    })
    expect(logout.stderr).toContain(
      `Note: the login was shared; profile "${caseLower}" needs a new login, too.`,
    )
    const status = await run(authArgs("status", caseLower))
    expect(expectError(status, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(caseLower))
  })

  it("no longer reads a login that operate 0.7.0 cached under the file name of the profile", async () => {
    const { caseLower } = PROFILE
    await login(caseLower)
    const old = join(tokenDirectory(workdir), `profile-${caseLower}.json`)
    await rename(cacheFile(caseLower), old)
    const status = await run(authArgs("status", caseLower))
    expect(expectError(status, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(caseLower))
    expect(await readdir(tokenDirectory(workdir))).toContain(basename(old))
  })

  it("reports a token of the wrong audience as FORBIDDEN without refreshing", async () => {
    await login(PROFILE.noaud)
    const result = await run(countArgs(PROFILE.noaud, globalFlag("verbose")))
    const error = expectError(result, "FORBIDDEN", 4)
    expect(error.status).toBe(403)
    expect(error.message).toContain("Audiences in Jwt are not allowed")
    expect(error.hint).toContain("audience")
    expect(trace(result)).toEqual([COUNT_REQUEST, "< 403"])
  })

  it("reports a token of a differently spelled issuer as UNAUTHORIZED after one refresh", async (context) => {
    const { host, keycloakPort, url } = top()
    if (host !== "localhost") context.skip("the 127.0.0.1 spelling needs Docker on localhost")
    const loopbackIssuer = `http://127.0.0.1:${keycloakPort}/realms/operate`
    const { cache } = await login(PROFILE.loopbackIp)
    expect(claimsOf(cache.accessToken).iss).toBe(loopbackIssuer)

    const result = await run(countArgs(PROFILE.loopbackIp, globalFlag("verbose")))
    const error = expectError(result, "UNAUTHORIZED", 4)
    expect(error.status).toBe(401)
    expect(error.message).toContain("Jwt issuer is not configured")
    expect(error.hint).toContain("also after refreshing it")
    expect(error.hint).toContain("localhost and 127.0.0.1 are different issuers")
    expect(
      traceOf(result.stderr, { engine: url, token: endpointsOf(loopbackIssuer).token }),
    ).toEqual([COUNT_REQUEST, "< 401", "> POST <token>", "< 200", COUNT_REQUEST, "< 401"])
  })

  it("ignores callbacks without the right state and still completes the login", async () => {
    const pending = startLogin(start, loginArgs(PROFILE.it), { timeoutMs: RUN_TIMEOUT_MS })
    const forged = [
      { code: "forged-code-1" },
      { state: "wrong-state", code: "forged-code-2", iss: top().issuer },
      { state: "a", code: "forged-code-3" },
    ]
    for (const query of forged) {
      const answer = await fetch(await pending.callbackUrl(query))
      expect(answer.status).toBe(400)
      const html = await answer.text()
      expect(html).toContain("This is not the callback of the running login.")
      expect(html).not.toContain(query.code)
    }
    await pending.cli.waitForStderr(IGNORED_STATE)
    const { browser, result } = await completeLogin(pending)
    ledger.add(browser.callback.get("code"))
    expect(browser.answer.status).toBe(200)
    expect(expectSuccess(result).stderr.match(IGNORED_STATE)).toHaveLength(1)
    expect(result.json<LoginOutput>()).toMatchObject({ profile: PROFILE.it, user: USER.username })
  })

  it("fails the login on an error callback and on a response from another issuer", async () => {
    const callbacks = [
      {
        query: { error: "access_denied", error_description: "The user cancelled" },
        message: "access_denied",
      },
      {
        query: { iss: "http://127.0.0.1:1/realms/evil", code: "forged-code-4" },
        message: "The login response came from another issuer (possible mix-up attack)",
      },
    ]
    for (const { query, message } of callbacks) {
      const pending = startLogin(start, loginArgs(PROFILE.it), { timeoutMs: RUN_TIMEOUT_MS })
      const state = new URL(await pending.authorizationUrl()).searchParams.get("state") ?? ""
      const answer = await fetch(await pending.callbackUrl({ state, iss: top().issuer, ...query }))
      expect(await answer.text()).toContain("Login failed")
      const error = expectError(await pending.result(), "LOGIN_FAILED", 4)
      expect(error.message).toContain(message)
    }
  })

  it("gives up waiting for the callback after --login-timeout and names the redirect URI", async () => {
    const started = Date.now()
    const pending = startLogin(start, loginArgs(PROFILE.it, "--login-timeout", "1000"), {
      timeoutMs: RUN_TIMEOUT_MS,
    })
    const result = await pending.result()
    const error = expectError(result, "LOGIN_FAILED", 4)
    expect(error.message).toContain("No login arrived within 1 s")
    expect(error.hint).toContain("http://127.0.0.1/callback")
    expect(error.hint).toContain(CLIENTS.public)
    expect(Date.now() - started).toBeLessThan(30_000)
  })

  it('shows Keycloak\'s "Client not found" for an unknown client id and names it on timeout', async () => {
    const pending = startLogin(start, loginArgs(PROFILE.it, "--login-timeout", "3000"), {
      timeoutMs: RUN_TIMEOUT_MS,
      env: { OPERATE_OAUTH_CLIENT_ID: UNKNOWN_CLIENT },
    })
    const url = await pending.authorizationUrl()
    expect(new URL(url).searchParams.get("client_id")).toBe(UNKNOWN_CLIENT)
    // the browser shows the error; the authorization server never redirects to operate
    const page = await openAuthorizationUrl(url)
    expect(page.status).toBe(400)
    expect(page.html).toContain("Client not found")
    const error = expectError(await pending.result(), "LOGIN_FAILED", 4)
    expect(error.message).toContain("No login arrived within 3 s")
    expect(error.hint).toContain(UNKNOWN_CLIENT)
  })

  it("names an unknown client at the token endpoint and a login made for another client", async () => {
    const { cache } = await login(PROFILE.it)
    // the login of a profile whose client id Keycloak does not know, due for a refresh
    const foreign = {
      ...cache,
      identity: { ...cache.identity, clientId: UNKNOWN_CLIENT },
      expiresAt: Date.now() - 1_000,
    }
    await writeFile(cacheFile(PROFILE.wrongClient), `${JSON.stringify(foreign, null, 2)}\n`, {
      mode: 0o600,
    })
    const rejected = await run(countArgs(PROFILE.wrongClient, globalFlag("verbose")))
    const error = expectError(rejected, "CONFIG", 3)
    expect(error.message).toContain(`The authorization server rejected client ${UNKNOWN_CLIENT}`)
    expect(error.message).toContain("invalid_client")
    expect(trace(rejected)).toEqual(["> POST <token>", "< 401"])

    const other = await run(countArgs(PROFILE.it, globalFlag("verbose")), {
      env: { OPERATE_OAUTH_CLIENT_ID: CLIENTS.short },
    })
    const mismatch = expectError(other, "LOGIN_REQUIRED", 4)
    expect(mismatch.message).toBe(
      `The OAuth login of profile "it" was made for another issuer, client, audience or scopes: client "${CLIENTS.public}" (the configuration asks for "${CLIENTS.short}")`,
    )
    expect(mismatch.hint).toContain(
      "OPERATE_OAUTH_CLIENT_ID of this environment makes the difference",
    )
    expect(mismatch.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(other.stderr).not.toMatch(SENT_REQUEST)
  })

  it("fails the login with CONFIG or NETWORK before waiting when it cannot start", async () => {
    // a login that wrongly starts waiting ends after 5 s instead of the 300 s default
    const BOUNDED = ["--login-timeout", "5000"]
    const blocker = createServer()
    const port = await listen(blocker)
    try {
      const busy = await run(loginArgs(PROFILE.it, ...BOUNDED), {
        env: { OPERATE_OAUTH_REDIRECT_PORT: String(port) },
      })
      const error = expectError(busy, "CONFIG", 3)
      expect(error.message).toContain(`Port ${port} for the login callback is in use`)
      // the variable overrides the profile, so the hint names the variable
      expect(error.hint).toContain("OPERATE_OAUTH_REDIRECT_PORT=<port>")
      expect(busy.stderr).not.toMatch(URL_LINE)
    } finally {
      blocker.close()
    }

    const unknownRealm = await run(loginArgs(PROFILE.it, ...BOUNDED), {
      env: { OPERATE_OAUTH_ISSUER: `${top().keycloakUrl}/realms/nope` },
    })
    expect(expectError(unknownRealm, "CONFIG", 3).message).toContain("OAuth discovery failed")
    expect(unknownRealm.stderr).not.toMatch(URL_LINE)

    const closed = await run(loginArgs(PROFILE.it, ...BOUNDED), {
      env: { OPERATE_OAUTH_ISSUER: "http://127.0.0.1:1/realms/operate" },
    })
    expect(expectError(closed, "NETWORK", 8).message).toContain(
      "Cannot reach the authorization server at http://127.0.0.1:1",
    )
  })

  it("authenticates a confidential client with client_secret_basic and masks the secret", async () => {
    const env = { [CLIENT_SECRET_ENV]: CLIENT_SECRET }
    const pending = startLogin(start, loginArgs(PROFILE.conf, globalFlag("verbose")), {
      timeoutMs: RUN_TIMEOUT_MS,
      env,
    })
    const { browser, result } = await completeLogin(pending)
    ledger.add(browser.callback.get("code"))
    await ledger.expectHidden(result)
    expectSuccess(result)
    expect(trace(result)).toEqual([
      "> GET <issuer>/.well-known/openid-configuration",
      "< 200",
      "> POST <token>",
      "< 200",
    ])
    expect(result.stderr).toMatch(/^> authorization: Basic \*\*\*$/im)

    const count = await run(countArgs(PROFILE.conf), { env })
    expect(expectSuccess(count).json<Count>()).toEqual({ count: expect.any(Number) })
    const show = await run(["config", "show", globalFlag("profile"), PROFILE.conf], { env })
    expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
      values: { clientId: { value: CLIENTS.confidential }, clientSecret: { value: "***" } },
    })
    expect((await readCache(cacheFile(PROFILE.conf))).endpoints.clientAuthMethod).toBe(
      "client_secret_basic",
    )
    // the login of the same issuer and client is revoked with its secret (Keycloak checks it)
    const logout = await run(authArgs("logout", PROFILE.conf, globalFlag("verbose")), { env })
    await ledger.expectHidden(logout)
    expect(expectSuccess(logout).json<LogoutOutput>()).toMatchObject({
      removed: true,
      revoked: true,
    })
    expect(logout.stderr).toContain(`> POST ${endpointsOf(top().issuer).revocation}\n`)
    expect(logout.stderr).toMatch(/^> authorization: Basic \*\*\*$/im)

    const wrongSecret = "wrong-client-secret-it"
    ledger.add(
      wrongSecret,
      Buffer.from(`${CLIENTS.confidential}:${wrongSecret}`, "utf8").toString("base64"),
    )
    const rejected = startLogin(start, loginArgs(PROFILE.conf), {
      timeoutMs: RUN_TIMEOUT_MS,
      env: { [CLIENT_SECRET_ENV]: wrongSecret },
    })
    const failed = await completeLogin(rejected)
    ledger.add(failed.browser.callback.get("code"))
    await ledger.expectHidden(failed.result)
    expect(failed.browser.answer.html).toContain("Login failed")
    expect(expectError(failed.result, "CONFIG", 3).message).toContain("unauthorized_client")
  })

  it("refuses OAuth together with an explicit Authorization header before any request", async () => {
    const result = await run([
      "ping",
      globalFlag("profile"),
      PROFILE.it,
      globalFlag("header"),
      "Authorization: x",
      globalFlag("verbose"),
    ])
    const error = expectError(result, "CONFIG", 3)
    expect(error.message).toContain("OAuth and an Authorization header are both configured")
    expect(result.stderr).not.toMatch(SENT_REQUEST)
  })

  it("logs in from OPERATE_OAUTH_* alone into a cache named after the identity", async () => {
    const { issuer, url } = top()
    const env = {
      OPERATE_AUTH: "oauth",
      OPERATE_OAUTH_ISSUER: issuer,
      OPERATE_OAUTH_CLIENT_ID: CLIENTS.public,
      OPERATE_URL: url,
    }
    const pending = startLogin(start, ["auth", "login", "--no-browser"], {
      timeoutMs: RUN_TIMEOUT_MS,
      env,
    })
    const { browser, result } = await completeLogin(pending)
    ledger.add(browser.callback.get("code"))
    await ledger.expectHidden(result)
    expect(expectSuccess(result).stderr).toContain(
      `Logging in to ${issuer} as client ${CLIENTS.public} (no profile).`,
    )
    const file = join(
      tokenDirectory(workdir),
      envCacheFileName({
        issuer,
        tokenEndpoint: null,
        clientId: CLIENTS.public,
        audience: null,
        scopes: DEFAULT_SCOPES,
      }),
    )
    expect(result.json<LoginOutput>()).toMatchObject({
      profile: null,
      clientId: CLIENTS.public,
      user: USER.username,
      tokenCache: file,
    })
    expect(existsSync(file)).toBe(true)

    const ping = await run(["ping"], { env })
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
      url,
      auth: "oauth",
      user: USER.username,
    })
  })

  it.skipIf(process.platform === "win32")(
    "starts the browser named by BROWSER with the authorization URL",
    async () => {
      const record = join(workdir, "browser-urls.txt")
      const browser = join(workdir, "browser.cjs")
      const script = `require('node:fs').appendFileSync(${JSON.stringify(record)}, process.argv[2] + '\\n');\n`
      await writeFile(browser, `#!${process.execPath}\n${script}`, { mode: 0o755 })
      const pending = startLogin(start, ["auth", "login", "--profile", PROFILE.it], {
        timeoutMs: RUN_TIMEOUT_MS,
        env: { BROWSER: browser },
      })
      const url = await pending.authorizationUrl()
      await pending.cli.waitForStderr(/^Opened the system browser\.$/m)
      const recorded = await eventually(
        () => readFile(record, "utf8").catch(() => ""),
        (text) => text.endsWith("\n"),
      )
      expect(recorded).toBe(`${url}\n`)

      const { browser: page, result } = await completeLogin(pending)
      ledger.add(page.callback.get("code"))
      await ledger.expectHidden(result)
      expect(expectSuccess(result).json<LoginOutput>()).toMatchObject({ user: USER.username })
    },
  )
})
