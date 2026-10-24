/**
 * Bearer tokens from elsewhere end to end through `run()`: flag, environment and
 * profile sources, the header on the wire, JWT expiry, masking, the 401/403 hints and completion.
 * `auth status` and `auth login|logout` are in bearer-auth.test.ts, `config set|show|unset|list`
 * and mistyped flags in bearer-config.test.ts.
 */

import { describe, expect, it } from "vitest"
import { jwtWith, NOW_S, VALID_CLAIMS } from "../../test/support/bearer.js"
import { errorOf, profiles, server } from "../../test/support/cli-bearer.js"
import { BASE_URL, fakeServer, json } from "../../test/support/fake-fetch.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../test/support/fake-runtime.js"
import { usageError } from "../errors.js"
import { run } from "./run.js"

const JWT = jwtWith(VALID_CLAIMS)
const EXPIRED = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 31 })

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}, status = 200) {
  const fake = server(status)
  const outcome = await execute(run, args, fakeRuntime({ fetch: fake.fetch, ...options }))
  return { ...outcome, requests: fake.requests }
}

describe("bearer token sources", () => {
  it("sends OPERATE_TOKEN as Authorization: Bearer, and nothing else", async () => {
    const result = await cli(["task", "list"], { env: { OPERATE_TOKEN: "opaque-token" } })
    expect(result).toMatchObject({ code: 0, stdout: "[]\n", stderr: "" })
    expect(result.requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer opaque-token",
    ])
  })

  it('reads the first line of stdin for --auth-token-stdin, CR/LF and "Bearer " stripped', async () => {
    const result = await cli(["task", "list", "--auth-token-stdin"], {
      stdin: "Bearer abc.def\r\nsecond line\n",
    })
    expect(result.code).toBe(0)
    expect(result.requests[0]?.headers.authorization).toBe("Bearer abc.def")
    const before = await cli(["--auth-token-stdin", "task", "list"], { stdin: "xyz" })
    expect(before.requests[0]?.headers.authorization).toBe("Bearer xyz")
  })

  it("takes the token from the variable named by the profile, or the stored token", async () => {
    const files = {
      [CONFIG_PATH]: profiles({
        p: { auth: { type: "bearer", tokenEnv: "CI_TOKEN" } },
        lit: { auth: { type: "bearer", token: "stored" } },
      }),
    }
    const fromVariable = await cli(["task", "list"], { files, env: { CI_TOKEN: "ci" } })
    expect(fromVariable.requests[0]?.headers.authorization).toBe("Bearer ci")
    const stored = await cli(["task", "list", "--profile", "lit"], { files })
    expect(stored.requests[0]?.headers.authorization).toBe("Bearer stored")
    const unset = await cli(["task", "list"], { files })
    expect(unset.code).toBe(3)
    expect(errorOf(unset.stderr).message).toBe(
      'The token variable CI_TOKEN (auth.tokenEnv of profile "p") is not set or empty',
    )
    expect(unset.requests).toEqual([])
  })

  it("refuses an empty token, a terminal and a second reader of stdin before sending", async () => {
    const empty = await cli(["task", "list", "--auth-token-stdin"], { stdin: "  \n" })
    expect(empty.code).toBe(2)
    expect(errorOf(empty.stderr)).toMatchObject({
      code: "USAGE",
      message: "--auth-token-stdin read an empty token",
      hint: "Pipe the token into the command, e.g. gcloud auth print-access-token | operate ... --auth-token-stdin.",
    })
    // the Node runtime refuses a terminal with a USAGE error (src/bin/node-runtime.test.ts)
    const tty = fakeRuntime()
    const terminalRuntime = {
      ...tty,
      readStdin: () =>
        Promise.reject(usageError("stdin is a terminal; pipe the input into the command")),
    }
    const terminal = {
      ...(await execute(run, ["task", "list", "--auth-token-stdin"], terminalRuntime)),
      requests: [],
    }
    expect(terminal.code).toBe(2)
    expect(errorOf(terminal.stderr).message).toBe(
      "stdin is a terminal; pipe the input into the command",
    )
    const body = await cli(["message", "correlate", "--body", "-", "--auth-token-stdin"], {
      stdin: "{}",
    })
    expect(errorOf(body.stderr).message).toBe("--auth-token-stdin and --body - both read stdin")
    const both = await cli(["task", "list", "--auth-token-stdin", "--auth-password-stdin"], {
      stdin: "t",
    })
    expect(errorOf(both.stderr).message).toBe(
      "--auth-password-stdin and --auth-token-stdin both read stdin",
    )
    for (const result of [empty, terminal, body, both]) expect(result.requests).toEqual([])
  })

  it("refuses a token next to an Authorization header", async () => {
    const result = await cli(["task", "list", "-H", "Authorization: Bearer other"], {
      env: { OPERATE_TOKEN: "t" },
    })
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr).message).toBe(
      "Bearer auth and an Authorization header are both configured",
    )
    const env = await cli(["task", "list", "--auth", "bearer"], {
      env: { OPERATE_TOKEN: "t", OPERATE_HEADERS: "Authorization: Basic x" },
    })
    expect(errorOf(env.stderr).hint).toContain("from OPERATE_HEADERS")
  })

  it("refuses a username and a token without a type", async () => {
    const result = await cli(["task", "list", "--auth-user", "demo"], {
      env: { OPERATE_TOKEN: "t", OPERATE_PASSWORD: "pw" },
    })
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr).message).toBe(
      "Both Basic auth and a bearer token are configured, but no auth type says which one to use",
    )
    const basic = await cli(["task", "list", "--auth-user", "demo", "--auth", "basic"], {
      env: { OPERATE_TOKEN: "t", OPERATE_PASSWORD: "demo" },
    })
    expect(basic.requests[0]?.headers.authorization).toBe("Basic ZGVtbzpkZW1v")
    const none = await cli(["task", "list", "--auth", "none"], { env: { OPERATE_TOKEN: "t" } })
    expect(none.requests[0]?.headers.authorization).toBeUndefined()
  })
})

describe("JWT expiry", () => {
  it("fails with TOKEN_EXPIRED (exit 4) before sending an expired JWT", async () => {
    const result = await cli(["task", "list"], { env: { OPERATE_TOKEN: EXPIRED } })
    expect(result.code).toBe(4)
    expect(result.requests).toEqual([])
    expect(errorOf(result.stderr)).toEqual({
      code: "TOKEN_EXPIRED",
      exitCode: 4,
      message: "The bearer token from OPERATE_TOKEN expired at 2023-11-14T22:12:49.000Z",
      hint: "operate never refreshes bearer tokens: the bearer token from OPERATE_TOKEN expired at 2023-11-14T22:12:49.000Z; fetch a new one (e.g. with your identity provider's CLI) and set OPERATE_TOKEN.",
    })
    const ping = await cli(["ping", "--auth-token-stdin"], { stdin: EXPIRED })
    expect(errorOf(ping.stderr).hint).toContain("and pipe it into --auth-token-stdin.")
  })

  it("sends a JWT that expired less than 30 s ago (clock skew)", async () => {
    const recent = jwtWith({ exp: NOW_S - 30 })
    const result = await cli(["task", "list"], { env: { OPERATE_TOKEN: recent } })
    expect(result.code).toBe(0)
    expect(result.requests).toHaveLength(1)
  })
})

describe("bearer tokens in dry-run, verbose and ping", () => {
  it("masks the token in dry-run previews and curl unless --show-secrets", async () => {
    const env = { OPERATE_TOKEN: JWT }
    const preview = await cli(["task", "list", "--dry-run"], { env })
    expect(JSON.parse(preview.stdout)).toMatchObject({
      headers: { Authorization: "Bearer ***" },
    })
    expect(preview.stdout).not.toContain(JWT)
    const curl = await cli(["task", "list", "--dry-run", "-o", "table"], { env })
    expect(curl.stdout).toContain("-H 'Authorization: Bearer ***'")
    const shown = await cli(["task", "list", "--dry-run", "--show-secrets"], { env })
    expect(JSON.parse(shown.stdout)).toMatchObject({
      headers: { Authorization: `Bearer ${JWT}` },
    })
    expect(preview.requests).toEqual([])
  })

  it("notes in a dry-run that an expired JWT would fail", async () => {
    const result = await cli(["task", "list", "--dry-run"], { env: { OPERATE_TOKEN: EXPIRED } })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe(
      "Note: The bearer token from OPERATE_TOKEN expired at 2023-11-14T22:12:49.000Z: the request would fail with TOKEN_EXPIRED. Fetch a new one and set OPERATE_TOKEN.\n",
    )
  })

  it("masks the token in the verbose trace", async () => {
    const result = await cli(["task", "list", "--verbose"], { env: { OPERATE_TOKEN: "secret.t" } })
    expect(result.stderr).toContain("> Authorization: Bearer ***\n")
    expect(result.stderr).not.toContain("secret.t")
  })

  it("pings with auth bearer and the user and subject of a JWT", async () => {
    const jwt = await cli(["ping"], { env: { OPERATE_TOKEN: JWT } })
    expect(JSON.parse(jwt.stdout)).toMatchObject({
      auth: "bearer",
      user: "alice",
      subject: VALID_CLAIMS.sub,
    })
    const opaque = JSON.parse(
      (await cli(["ping"], { env: { OPERATE_TOKEN: "op" } })).stdout,
    ) as Record<string, unknown>
    expect(opaque.auth).toBe("bearer")
    expect(opaque).not.toHaveProperty("subject")
    expect(opaque).not.toHaveProperty("user")
  })

  it("warns about a token over plain http beyond loopback, not in a dry-run", async () => {
    const env = { OPERATE_TOKEN: "t", OPERATE_URL: "http://camunda.intranet:8080/engine-rest" }
    const fake = fakeServer("http://camunda.intranet:8080/engine-rest").on("GET", "/task", json([]))
    const result = await execute(run, ["task", "list"], fakeRuntime({ fetch: fake.fetch, env }))
    expect(result.stderr).toBe(
      "Warning: operate sends the bearer token over plain http to camunda.intranet:8080; anyone on the network path can read and reuse it. Use https:// for the engine URL (RFC 6750 §5.3).\n",
    )
    const dry = await execute(run, ["task", "list", "--dry-run"], fakeRuntime({ env }))
    expect(dry.stderr).toBe("")
  })
})

describe("a rejected bearer token", () => {
  it("explains a 401 without retrying", async () => {
    const result = await cli(["task", "list"], { env: { OPERATE_TOKEN: JWT } }, 401)
    expect(result.code).toBe(4)
    expect(result.requests).toHaveLength(1)
    const error = errorOf(result.stderr)
    expect(error).toMatchObject({ code: "UNAUTHORIZED", engineMessage: "Jwt is expired" })
    expect(error.hint).toContain(
      "the engine rejected the bearer token from OPERATE_TOKEN (a JWT: subject",
    )
    expect(error.hint).toContain(
      "fetch a new token (e.g. with your identity provider's CLI) and set OPERATE_TOKEN",
    )
  })

  it("explains a 403 with missing roles or scopes", async () => {
    const result = await cli(["task", "list"], { env: { OPERATE_TOKEN: "op" } }, 403)
    expect(result.code).toBe(4)
    expect(errorOf(result.stderr)).toMatchObject({ code: "FORBIDDEN" })
    expect(errorOf(result.stderr).hint).toContain("lacks the roles or scopes this operation needs")
  })
})

describe("a bearer token that the auth type does not use", () => {
  const sso = {
    [CONFIG_PATH]: profiles({
      p: { auth: { type: "oauth", issuer: "https://login.example.com/realms/x", clientId: "cli" } },
      b: { auth: { type: "basic", username: "demo", passwordEnv: "PW" } },
    }),
  }
  const note =
    'A bearer token is set (from OPERATE_TOKEN) but not used: OAuth is selected by the auth.type of profile "p"; send it with --auth bearer or OPERATE_AUTH=bearer.'

  it("is named by the LOGIN_REQUIRED hint and the dry-run note of an OAuth profile", async () => {
    const env = { OPERATE_TOKEN: JWT }
    const result = await cli(["task", "list"], { files: sso, env })
    expect(result.code).toBe(4)
    expect(errorOf(result.stderr).code).toBe("LOGIN_REQUIRED")
    expect(String(errorOf(result.stderr).hint).endsWith(` ${note}`)).toBe(true)
    const dryRun = await cli(["task", "list", "--dry-run"], { files: sso, env })
    expect(dryRun.code).toBe(0)
    expect(dryRun.stderr).toMatch(
      /^Note: Not logged in with OAuth .* in a terminal\. A bearer token is set/,
    )
    const sent = await cli(["task", "list", "--auth", "bearer"], { files: sso, env })
    expect(sent.requests[0]?.headers.authorization).toBe(`Bearer ${JWT}`)
    for (const output of [result, dryRun]) expect(output.stderr).not.toContain(JWT)
  })

  it("is named by the 401 and 403 hints of a Basic profile", async () => {
    const env = { OPERATE_TOKEN: JWT, PW: "pw" }
    const rejected = await cli(["task", "list", "--profile", "b"], { files: sso, env }, 401)
    expect(rejected.code).toBe(4)
    expect(errorOf(rejected.stderr).hint).toBe(
      'The engine rejected the credentials of user demo (source: profile). Check the username and the password; `operate config show` shows where each comes from. After a failed login the engine refuses the user for a few seconds (and locks it after repeated failures), so wait before retrying. A bearer token is set (from OPERATE_TOKEN) but not used: Basic auth is selected by the auth.type of profile "b"; send it with --auth bearer or OPERATE_AUTH=bearer.',
    )
    const forbidden = await cli(["task", "list", "--profile", "b"], { files: sso, env }, 403)
    expect(errorOf(forbidden.stderr).hint).toContain("A bearer token is set (from OPERATE_TOKEN)")
    // switched off explicitly: the 401 hint already says why nothing was sent
    const none = await cli(["task", "list", "--auth", "none"], { env: { OPERATE_TOKEN: JWT } }, 401)
    expect(errorOf(none.stderr).hint).not.toContain("A bearer token is set")
    expect(errorOf(none.stderr).hint).toContain("Bearer auth is switched off by --auth none")
  })
})

describe("completion of the bearer options", () => {
  async function values(words: readonly string[]): Promise<string[]> {
    const result = await execute(run, ["__complete", ...words], fakeRuntime())
    return result.stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.split("\t")[0] ?? "")
  }

  it("offers bearer and the token options", async () => {
    expect(await values(["ping", "--auth", "b"])).toEqual(["basic", "bearer"])
    expect(await values(["task", "list", "--auth-to"])).toEqual(["--auth-token-stdin"])
    expect(await values(["config", "set", "p", "--auth-token"])).toEqual([
      "--auth-token-env",
      "--auth-token-stdin",
    ])
    expect(await values(["config", "set", "p", "--auth", "be"])).toEqual(["bearer"])
    expect(await values(["config", "show", "--auth-t"])).toEqual(["--auth-token-stdin"])
  })

  it("documents the base URL of the fixtures", () => {
    expect(BASE_URL).toBe("http://localhost:8080/engine-rest")
  })
})
