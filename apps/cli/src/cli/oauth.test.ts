/**
 * OAuth in the operation commands, `api`, `ping` and the workflow commands through `run()`: Bearer
 * tokens from the cache, proactive and reactive refresh, 401 and 403 hints, dry-run notes, the
 * verbose trace of token requests and the guarantee that no command but `auth login` starts a
 * login.
 */

import { describe, expect, it } from "vitest"
import { fakeServer, json } from "../../test/support/fake-fetch.js"
import {
  fakeIdp,
  type FakeIdpOptions,
  oauthError,
  routeFetch,
} from "../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime, fileText } from "../../test/support/fake-runtime.js"
import {
  cachedLogin,
  cacheText,
  oauthProfiles,
  TOKEN_ENDPOINT,
  TOKEN_FILE,
} from "../../test/support/oauth.js"
import type { CachedLogin } from "../auth/oauth/types.js"
import { run } from "./run.js"

const T0 = 1_700_000_000_000

function rejected(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain", "www-authenticate": "Bearer" },
  })
}

interface Options {
  readonly login?: CachedLogin | null
  readonly now?: number
  readonly engine?: (authorization: string | undefined) => Response
  readonly env?: Record<string, string>
  readonly lockTimeout?: boolean
  readonly idp?: FakeIdpOptions
}

function setup(options: Options = {}) {
  const idp = fakeIdp(options.idp)
  idp.seed("cached-refresh")
  const engine = options.engine ?? (() => json({ count: 3 }))
  const server = fakeServer()
    .on("GET", "/process-definition/count", (request) => engine(request.headers.authorization))
    .on("GET", "/version", (request) =>
      request.headers.authorization === undefined
        ? rejected(401, "Jwt is missing")
        : json({ version: "7.24.0" }),
    )
    .on("GET", "/engine", json([{ name: "default" }]))
  const login = options.login === undefined ? cachedLogin(T0) : options.login
  const runtime = fakeRuntime({
    fetch: routeFetch(idp, server.fetch),
    now: () => options.now ?? T0,
    env: options.env ?? {},
    files: {
      [CONFIG_PATH]: oauthProfiles(),
      ...(login === null ? {} : { [TOKEN_FILE]: cacheText(login) }),
    },
    ...(options.lockTimeout === true ? { lockTimeout: true } : {}),
  })
  const cli = async (args: readonly string[]) => {
    const result = await execute(run, args, runtime)
    // no command but `auth login` may start a login
    expect(runtime.loopback.listens).toEqual([])
    expect(runtime.browserUrls).toEqual([])
    return result
  }
  return { idp, server, runtime, cli }
}

function errorOf(stderr: string): Record<string, unknown> {
  const line = stderr.trim().split("\n").at(-1) ?? ""
  return (JSON.parse(line) as { error: Record<string, unknown> }).error
}

const authorizations = (server: ReturnType<typeof fakeServer>) =>
  server.requests.map((request) => request.headers.authorization)

describe("OAuth on operation commands", () => {
  it("sends the cached Bearer token", async () => {
    const { cli, server, idp } = setup()
    const result = await cli(["process-definition", "count"])
    expect(result).toMatchObject({ code: 0, stdout: '{"count":3}\n', stderr: "" })
    expect(authorizations(server)).toEqual(["Bearer cached-access"])
    expect(idp.requests).toEqual([])
  })

  it("fails with LOGIN_REQUIRED (exit 4) before any request when not logged in", async () => {
    const { cli, server } = setup({ login: null })
    const result = await cli(["process-definition", "count", "--verbose"])
    expect(result.code).toBe(4)
    expect(server.requests).toEqual([])
    expect(result.stderr).not.toMatch(/^> /m)
    expect(result.stderr).not.toMatch(/^ {2}https?:/m)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "LOGIN_REQUIRED",
      exitCode: 4,
      message: 'Not logged in: profile "p" has no OAuth login',
      hint: "One login serves every OAuth profile of the same config file, project file or repository that stores the same issuer, client, audience and scopes. Run `operate auth login --profile p` in a terminal: a person logs in once in the browser, operate refreshes the token afterwards. Agents cannot log in themselves.",
    })
  })

  it("refreshes proactively and traces the token request with --verbose", async () => {
    const { cli, server, runtime } = setup({ now: T0 + 250_000 })
    const result = await cli(["process-definition", "count", "--verbose"])
    expect(result.code).toBe(0)
    const lines = result.stderr.split("\n")
    expect(lines.filter((line) => line === `> POST ${TOKEN_ENDPOINT}`)).toHaveLength(1)
    expect(lines).toContain("> Content-Type: application/x-www-form-urlencoded")
    expect(lines.indexOf(`> POST ${TOKEN_ENDPOINT}`)).toBeLessThan(
      lines.findIndex((line) => line.startsWith("> GET ")),
    )
    expect(result.stderr).toContain("> Authorization: Bearer ***\n")
    expect(authorizations(server)).toEqual(["Bearer access-1"])
    expect(JSON.parse(fileText(runtime, TOKEN_FILE) ?? "{}")).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    })
  })

  it("shows the Bearer token with --show-secrets, never the client credentials", async () => {
    const idpSecret = "client-secret-value"
    const { cli } = setup({
      now: T0 + 250_000,
      env: { OPERATE_OAUTH_CLIENT_SECRET: idpSecret },
      idp: { clients: { "operate-cli": { secret: idpSecret } } },
    })
    const result = await cli(["process-definition", "count", "--verbose", "--show-secrets"])
    expect(result.stderr).toContain("> Authorization: Bearer access-1\n")
    expect(result.stderr).toContain("> Authorization: Basic ***\n")
    expect(result.stderr).not.toContain(Buffer.from(`operate-cli:${idpSecret}`).toString("base64"))
  })

  it("refreshes once after a 401 and retries", async () => {
    const { cli, server, idp } = setup({
      engine: (authorization) =>
        authorization === "Bearer cached-access"
          ? rejected(401, "Jwt is expired")
          : json({ count: 1 }),
    })
    const result = await cli(["process-definition", "count", "--verbose"])
    expect(result.code).toBe(0)
    expect(authorizations(server)).toEqual(["Bearer cached-access", "Bearer access-1"])
    expect(idp.tokenRequests()).toHaveLength(1)
    expect(result.stderr).toMatch(/< 401 Unauthorized[^\n]*\n> POST [^\n]*token\n[\s\S]*< 200 OK/)
  })

  it("gives the OAuth 401 hint after exactly one refresh", async () => {
    const { cli, server, idp } = setup({
      engine: () => rejected(401, "Jwt issuer is not configured"),
    })
    const result = await cli(["process-definition", "count"])
    expect(result.code).toBe(4)
    expect(server.requests).toHaveLength(2)
    expect(idp.tokenRequests()).toHaveLength(1)
    const error = errorOf(result.stderr)
    expect(error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "HTTP 401 Unauthorized: Jwt issuer is not configured",
      engineMessage: "Jwt issuer is not configured",
    })
    expect(error.hint).toContain(
      'rejected the OAuth access token of alice (profile "p"), also after refreshing it.',
    )
  })

  it("answers a 403 with FORBIDDEN and the audience hint, without a refresh", async () => {
    const { cli, server, idp } = setup({
      engine: () => rejected(403, "Audiences in Jwt are not allowed"),
    })
    const result = await cli(["process-definition", "count", "--verbose"])
    expect(result.code).toBe(4)
    expect(server.requests).toHaveLength(1)
    expect(idp.requests).toEqual([])
    expect(result.stderr).not.toContain("> POST")
    const error = errorOf(result.stderr)
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      message: "HTTP 403 Forbidden: Audiences in Jwt are not allowed",
    })
    expect(error.hint).toContain(
      "A JWT gateway answers 403 when the token's audience or scopes do not fit",
    )
  })

  it("fails with the refresh error instead of the 401 when the login was revoked", async () => {
    const { cli, idp, runtime } = setup({ engine: () => rejected(401, "Jwt is expired") })
    idp.queue("token", oauthError(400, "invalid_grant", "Session not active"))
    const before = JSON.parse(fileText(runtime, TOKEN_FILE) ?? "") as object
    const result = await cli(["process-definition", "count"])
    expect(result.code).toBe(4)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "LOGIN_REQUIRED",
      message:
        'The authorization server rejected the refresh token of profile "p" (invalid_grant: Session not active)',
    })
    // the tokens stay; the refusal is recorded, so auth status and later commands know it
    expect(JSON.parse(fileText(runtime, TOKEN_FILE) ?? "")).toEqual({
      ...before,
      refreshRejected: { at: T0, error: "invalid_grant: Session not active" },
    })
    const status = await cli(["auth", "status"])
    expect(status.code).toBe(4)
    expect(status.stdout).toBe("")
    expect(errorOf(status.stderr).message).toBe(
      'The authorization server rejected the refresh token of profile "p" at 2023-11-14T22:13:20.000Z (invalid_grant: Session not active)',
    )
    const again = await cli(["process-definition", "count"])
    expect(errorOf(again.stderr).message).toBe(errorOf(status.stderr).message)
    expect(idp.tokenRequests()).toHaveLength(1)
  })

  it("uses the valid token when the lock cannot be taken", async () => {
    const { cli, server } = setup({ now: T0 + 250_000, lockTimeout: true })
    expect((await cli(["process-definition", "count"])).code).toBe(0)
    expect(authorizations(server)).toEqual(["Bearer cached-access"])
  })

  it("refreshes at most once for all pages of --all", async () => {
    const idp = fakeIdp()
    idp.seed("cached-refresh")
    const server = fakeServer().on("GET", "/process-definition", (request) =>
      request.headers.authorization === "Bearer cached-access"
        ? rejected(401, "Jwt is expired")
        : json(request.query.get("firstResult") === "0" ? [{ id: "a" }] : []),
    )
    const runtime = fakeRuntime({
      fetch: routeFetch(idp, server.fetch),
      now: () => T0,
      files: { [CONFIG_PATH]: oauthProfiles(), [TOKEN_FILE]: cacheText(cachedLogin(T0)) },
    })
    const result = await execute(
      run,
      ["process-definition", "list", "--all", "--max-results", "1"],
      runtime,
    )
    expect(result.code).toBe(0)
    expect(idp.tokenRequests()).toHaveLength(1)
  })
})

describe("OAuth on dry-run, ping and api", () => {
  it("previews the cached token masked, without network or lock", async () => {
    const { cli, server, idp, runtime } = setup()
    const result = await cli(["process-definition", "count", "--dry-run"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ headers: { Authorization: "Bearer ***" } })
    expect(result.stdout).toContain("-H 'Authorization: Bearer ***'")
    expect(result.stderr).toBe("")
    expect(server.requests).toEqual([])
    expect(idp.requests).toEqual([])
    expect(runtime.locks).toEqual([])
    const shown = await cli(["process-definition", "count", "--dry-run", "--show-secrets"])
    expect(shown.stdout).toContain("Bearer cached-access")
  })

  it("notes a missing login on dry-run and exits 0", async () => {
    const { cli } = setup({ login: null })
    const result = await cli(["process-definition", "count", "--dry-run"])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe(
      'Note: Not logged in with OAuth (profile "p"); the request would fail with LOGIN_REQUIRED. Run `operate auth login --profile p` in a terminal.\n',
    )
    const api = await cli(["api", "GET", "/process-definition/count", "--dry-run", "-o", "table"])
    expect(api.stderr).toContain("Note: Not logged in with OAuth")
    const ping = await cli(["ping", "--dry-run"])
    expect(ping.stderr).toContain("Note: Not logged in with OAuth")
  })

  it("reports auth oauth and the user in ping", async () => {
    const { cli, server } = setup()
    const result = await cli(["ping"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ auth: "oauth", user: "alice" })
    expect(authorizations(server)).toEqual(["Bearer cached-access", "Bearer cached-access"])
    const anonymous = setup({ login: cachedLogin(T0, { user: null, subject: null }) })
    expect(JSON.parse((await anonymous.cli(["ping"])).stdout)).toMatchObject({
      auth: "oauth",
      user: null,
    })
  })

  it("sends the token with api", async () => {
    const { cli, server } = setup()
    expect((await cli(["api", "GET", "/process-definition/count"])).code).toBe(0)
    expect(authorizations(server)).toEqual(["Bearer cached-access"])
  })

  it("refuses an Authorization header next to OAuth before any request", async () => {
    const { cli, server } = setup()
    const result = await cli(["ping", "-H", "Authorization: x"])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr).message).toBe(
      "OAuth and an Authorization header are both configured",
    )
    expect(server.requests).toEqual([])
  })

  it("warns when the access token would travel over plain http beyond loopback", async () => {
    const warning =
      "Warning: operate sends the OAuth access token over plain http to 192.168.1.125:9198; anyone on the network path can read and reuse it. Use https:// for the engine URL (RFC 6750 §5.3).\n"
    const lan = setup({ env: { OPERATE_URL: "http://192.168.1.125:9198/engine-rest" } })
    const sent = await lan.cli(["process-definition", "count"])
    expect(sent.code).toBe(0)
    expect(sent.stderr).toBe(warning)
    const dryRun = setup({ env: { OPERATE_URL: "http://192.168.1.125:9198/engine-rest" } })
    const preview = await dryRun.cli(["process-definition", "count", "--dry-run"])
    expect(preview.stderr).not.toContain("plain http")
    for (const url of [
      "http://localhost:8080/engine-rest",
      "http://127.0.0.2:8080/engine-rest",
      "http://[::1]:8080/engine-rest",
      "https://camunda.example.com/engine-rest",
    ]) {
      const quiet = setup({ env: { OPERATE_URL: url } })
      expect((await quiet.cli(["process-definition", "count"])).stderr).toBe("")
    }
    const basic = setup({
      env: { OPERATE_URL: "http://10.0.0.1/engine-rest", OPERATE_AUTH: "none" },
    })
    expect((await basic.cli(["process-definition", "count"])).stderr).not.toContain("plain http")
  })

  it("adds operate auth status to the hint of a redirect", async () => {
    const { cli } = setup({
      engine: () => new Response(null, { status: 302, headers: { location: "https://login/x" } }),
    })
    const result = await cli(["process-definition", "count"])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr).hint).toContain(
      "`operate auth status --profile p` shows whether the OAuth login is usable.",
    )
  })
})

describe("OAuth on the workflow commands", () => {
  it("previews the cached token and notes a missing login once per dry-run", async () => {
    const { cli, server } = setup()
    const preview = await cli(["inspect", "pi-1", "--dry-run"])
    expect(preview.code).toBe(0)
    const { requests } = JSON.parse(preview.stdout) as {
      requests: { headers: Record<string, string> }[]
    }
    expect(requests.length).toBeGreaterThan(1)
    expect(requests.map((request) => request.headers.Authorization)).toEqual(
      requests.map(() => "Bearer ***"),
    )
    expect(preview.stderr).toBe("")
    const missing = await setup({ login: null }).cli(["status", "--dry-run"])
    expect(missing.code).toBe(0)
    expect(missing.stderr).toBe(
      'Note: Not logged in with OAuth (profile "p"); the request would fail with LOGIN_REQUIRED. Run `operate auth login --profile p` in a terminal.\n',
    )
    expect(server.requests).toEqual([])
  })

  it("fails with LOGIN_REQUIRED before any request and never starts a login", async () => {
    const { cli, server } = setup({ login: null })
    const result = await cli(["inspect", "pi-1"])
    expect(result.code).toBe(4)
    expect(result.stdout).toBe("")
    expect(errorOf(result.stderr)).toMatchObject({ code: "LOGIN_REQUIRED", exitCode: 4 })
    expect(server.requests).toEqual([])
  })
})
