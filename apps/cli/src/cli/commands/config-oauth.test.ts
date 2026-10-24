/** `pulse-cli config set|show|list|delete` with OAuth through `run()`. */

import { describe, expect, it } from "vitest"
import { ISSUER } from "../../../test/support/fake-idp.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../../test/support/fake-runtime.js"
import { cachedLogin, cacheText, oauthProfiles, TOKEN_FILE } from "../../../test/support/oauth.js"
import { run } from "../run.js"

const T0 = 1_700_000_000_000

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  const runtime = fakeRuntime({ now: () => T0, ...options })
  const result = await execute(run, args, runtime)
  const file = fileText(runtime, CONFIG_PATH)
  return {
    ...result,
    file:
      file === undefined
        ? undefined
        : (JSON.parse(file) as { profiles: Record<string, { auth?: Record<string, unknown> }> }),
  }
}

function errorOf(stderr: string): Record<string, unknown> {
  const line = stderr.trim().split("\n").at(-1) ?? ""
  return (JSON.parse(line) as { error: Record<string, unknown> }).error
}

const NEXT = "Next: run `pulse-cli auth login --profile p` in a terminal to log in.\n"

describe("config set with OAuth options", () => {
  it("stores the OAuth settings, selects oauth and says what comes next", async () => {
    const result = await cli([
      "config",
      "set",
      "p",
      "--oauth-issuer",
      ISSUER,
      "--oauth-client-id",
      "pulse-cli",
      "--oauth-scopes",
      "openid offline_access profile",
      "--oauth-audience",
      "engine-rest",
      "--oauth-redirect-port",
      "8765",
    ])
    expect(result.code).toBe(0)
    expect(result.file?.profiles.p?.auth).toEqual({
      type: "oauth",
      issuer: ISSUER,
      clientId: "pulse-cli",
      scopes: ["openid", "offline_access", "profile"],
      audience: "engine-rest",
      redirectPort: 8765,
    })
    expect(result.stderr).toBe(NEXT)
    expect(JSON.parse(result.stdout)).toMatchObject({ name: "p", auth: { type: "oauth" } })
  })

  it("stores explicit endpoints and no scopes", async () => {
    const result = await cli([
      "config",
      "set",
      "p",
      "--auth",
      "oauth",
      "--oauth-authorization-endpoint",
      "https://as/a",
      "--oauth-token-endpoint",
      "https://as/t",
      "--oauth-client-id",
      "c",
      "--oauth-scopes",
      "",
    ])
    expect(result.file?.profiles.p?.auth).toEqual({
      type: "oauth",
      authorizationEndpoint: "https://as/a",
      tokenEndpoint: "https://as/t",
      clientId: "c",
      scopes: [],
    })
  })

  it("stores a client secret from stdin with a warning and masks it in the output", async () => {
    const result = await cli(
      [
        "config",
        "set",
        "p",
        "--oauth-issuer",
        ISSUER,
        "--oauth-client-id",
        "c",
        "--oauth-client-secret-stdin",
      ],
      {
        stdin: "very-secret\n",
      },
    )
    expect(result.code).toBe(0)
    expect(result.file?.profiles.p?.auth?.clientSecret).toBe("very-secret")
    expect(result.stdout).not.toContain("very-secret")
    expect(JSON.parse(result.stdout)).toMatchObject({ auth: { clientSecret: "***" } })
    expect(result.stderr).toBe(
      `Warning: the client secret is stored in plain text in ${CONFIG_PATH} (mode 0600). Prefer --oauth-client-secret-env <VAR>.\n${NEXT}`,
    )
  })

  it("refuses an empty client secret from stdin and two stdin readers", async () => {
    const empty = await cli(["config", "set", "p", "--oauth-client-secret-stdin"], { stdin: "\n" })
    expect(errorOf(empty.stderr)).toMatchObject({
      code: "USAGE",
      message: "--oauth-client-secret-stdin read an empty client secret",
      hint: `Pipe the client secret into the command, e.g. printf '%s\\n' "$CLIENT_SECRET" | pulse-cli config set <profile> --oauth-client-secret-stdin.`,
    })
    const both = await cli(
      ["config", "set", "p", "--oauth-client-secret-stdin", "--auth-password-stdin"],
      { stdin: "x\n" },
    )
    expect(errorOf(both.stderr)).toMatchObject({
      code: "USAGE",
      message: "--auth-password-stdin and --oauth-client-secret-stdin both read stdin",
    })
    expect(both.file).toBeUndefined()
  })

  it("warns when the secret variable is not set, without naming it", async () => {
    const result = await cli([
      "config",
      "set",
      "p",
      "--oauth-issuer",
      ISSUER,
      "--oauth-client-id",
      "c",
      "--oauth-client-secret-env",
      "PULSE_CLI_SECRET_X",
    ])
    expect(result.file?.profiles.p?.auth?.clientSecretEnv).toBe("PULSE_CLI_SECRET_X")
    expect(result.stderr).toBe(
      `Warning: the variable named by --oauth-client-secret-env is not set in this environment. Pass the name of a variable that holds the client secret (e.g. PULSE_CLI_CLIENT_SECRET), never the client secret itself; commands read it when they run.\n${NEXT}`,
    )
    expect(result.stderr).not.toContain("PULSE_CLI_SECRET_X")
    const set = await cli(["config", "set", "p", "--oauth-client-secret-env", "S"], {
      env: { S: "v" },
    })
    expect(set.stderr).toBe(NEXT)
  })

  it("refuses a client secret given to --oauth-client-secret-env without storing or repeating it", async () => {
    const secret = "kc8Zr2mPq9TfX4vB7nL1sD6hJ3gW5yA0"
    const set = ["config", "set", "p", "--oauth-issuer", ISSUER, "--oauth-client-id", "c"]
    const result = await cli([...set, "--oauth-client-secret-env", secret])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message:
        "--oauth-client-secret-env names a variable that is not set and does not look like a variable name: it may be the client secret itself, so it is neither stored nor repeated",
    })
    expect(result.stdout + result.stderr).not.toContain(secret)
    expect(result.file).toBeUndefined()
    // a hand-edited file: an unusual unset name is not repeated by any command either
    const files = {
      [CONFIG_PATH]: JSON.stringify({
        defaultProfile: "p",
        profiles: {
          p: { auth: { type: "oauth", issuer: ISSUER, clientId: "c", clientSecretEnv: secret } },
        },
      }),
      [TOKEN_FILE]: cacheText(cachedLogin(T0)),
    }
    for (const args of [
      ["process-definition", "count"],
      ["config", "show"],
      ["auth", "status"],
    ]) {
      const run = await cli(args, { files })
      expect(errorOf(run.stderr)).toMatchObject({
        code: "CONFIG",
        message:
          'The client secret variable named by auth.clientSecretEnv of profile "p" is not set or empty',
      })
      expect(run.stdout + run.stderr).not.toContain(secret)
    }
    const logout = await cli(["auth", "logout"], { files })
    expect(logout.code).toBe(0)
    expect(logout.stdout + logout.stderr).not.toContain(secret)
  })

  it("replaces Basic auth settings with a notice", async () => {
    const files = {
      [CONFIG_PATH]: JSON.stringify({
        profiles: { p: { auth: { type: "basic", username: "u", passwordEnv: "PW" } } },
      }),
    }
    const result = await cli(
      ["config", "set", "p", "--oauth-issuer", ISSUER, "--oauth-client-id", "c"],
      { files },
    )
    expect(result.file?.profiles.p?.auth).toEqual({ type: "oauth", issuer: ISSUER, clientId: "c" })
    expect(result.stderr).toBe(
      `Notice: removed the Basic auth settings of the profile; OAuth replaces them.\n${NEXT}`,
    )
  })

  it("replaces OAuth settings with Basic auth and removes their login", async () => {
    const args = ["config", "set", "p", "--auth-user", "demo", "--auth-password-env", "PW"]
    const result = await cli(args, {
      files: { [CONFIG_PATH]: oauthProfiles(), [TOKEN_FILE]: cacheText(cachedLogin(T0)) },
      env: { PW: "x" },
    })
    expect(result.file?.profiles.p?.auth).toEqual({
      type: "basic",
      username: "demo",
      passwordEnv: "PW",
    })
    expect(result.stderr).toBe(
      `Notice: removed the OAuth settings of the profile; Basic auth replaces them.\nRemoved the OAuth login of profile "p" for its previous settings (${TOKEN_FILE}); it was not revoked.\n`,
    )
  })

  it("replaces a stored Authorization header, naming OAuth", async () => {
    const files = {
      [CONFIG_PATH]: JSON.stringify({
        profiles: { p: { headers: { Authorization: "Bearer old" } } },
      }),
    }
    const result = await cli(
      ["config", "set", "p", "--oauth-issuer", ISSUER, "--oauth-client-id", "c"],
      { files },
    )
    expect(result.stderr).toBe(
      `Notice: removed the Authorization header of the profile; OAuth replaces it.\n${NEXT}`,
    )
  })

  it("keeps the settings switched off with --auth none and says nothing about a login", async () => {
    const result = await cli(["config", "set", "p", "--auth", "none"], {
      files: { [CONFIG_PATH]: oauthProfiles() },
    })
    expect(result.file?.profiles.p?.auth).toEqual({
      type: "none",
      issuer: ISSUER,
      clientId: "pulse-cli",
    })
    expect(result.stderr).toBe("")
  })

  it.each([
    [
      ["--auth", "basic", "--oauth-client-id", "c"],
      "OAuth options need --auth oauth, not --auth basic",
    ],
    [
      ["--auth-user", "u", "--oauth-client-id", "c"],
      "Basic auth options and OAuth options exclude each other",
    ],
    [
      ["--oauth-token-endpoint", "https://as/t"],
      "--oauth-authorization-endpoint and --oauth-token-endpoint must be given together",
    ],
    [
      ["--oauth-issuer", "http://as.example.com"],
      'The OAuth issuer (from --oauth-issuer) must use https:// (http:// only for localhost, 127.0.0.1 or [::1]), got "http://as.example.com"',
    ],
    [
      ["--oauth-redirect-port", "70000"],
      'The OAuth redirect port (from --oauth-redirect-port) must be a whole number between 0 and 65535, got "70000"',
    ],
  ])("refuses %j", async (options, message) => {
    const result = await cli(["config", "set", "p", ...options])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({ code: "CONFIG", message })
    expect(result.file).toBeUndefined()
  })

  it("guesses the OAuth flags of mistyped options", async () => {
    const issuer = await cli(["config", "set", "p", "--issuer", ISSUER])
    expect(errorOf(issuer.stderr)).toMatchObject({
      message: 'Unknown option "--issuer"',
      hint: expect.stringContaining("--oauth-issuer") as string,
    })
    const secret = await cli(["config", "set", "p", "--client-secret=abc123"])
    expect(secret.stderr).not.toContain("abc123")
    expect(errorOf(secret.stderr).hint).toContain("--oauth-client-secret-env")
    const token = await cli(["ping", "--token=abc123"])
    expect(token.stderr).not.toContain("abc123")
    expect(errorOf(token.stderr).hint).toContain("an OAuth token comes from `pulse-cli auth login`")
  })
})

describe("config show and list with OAuth", () => {
  it("shows the OAuth rows with sources and masks the client secret", async () => {
    const files = { [CONFIG_PATH]: oauthProfiles({ clientSecretEnv: "S" }) }
    const result = await cli(["config", "show"], { files, env: { S: "the-secret" } })
    expect(result.code).toBe(0)
    const view = JSON.parse(result.stdout) as { values: Record<string, unknown> }
    expect(view.values).toMatchObject({
      auth: { value: "oauth", source: "profile" },
      issuer: { value: ISSUER, source: "profile" },
      clientId: { value: "pulse-cli", source: "profile" },
      clientSecret: { value: "***", source: "profile" },
      scopes: { value: ["openid", "offline_access"], source: "default" },
      redirectPort: { value: 0, source: "default" },
    })
    expect(result.stdout).not.toContain("the-secret")
    const shown = await cli(["config", "show", "--show-secrets"], {
      files,
      env: { S: "the-secret" },
    })
    expect(shown.stdout).toContain('"value":"the-secret"')
  })

  it("space-joins the scopes in the table and reads no token file", async () => {
    const runtime = fakeRuntime({
      files: { [CONFIG_PATH]: oauthProfiles(), [TOKEN_FILE]: cacheText(cachedLogin(T0)) },
    })
    const reads: string[] = []
    const readFile = runtime.fs.readFile.bind(runtime.fs)
    runtime.fs.readFile = (path) => {
      reads.push(path)
      return readFile(path)
    }
    const result = await execute(run, ["config", "show", "-o", "table"], runtime)
    expect(result.stdout).toMatch(/\nscopes\s+openid offline_access\s+default\n/)
    expect(result.stdout).toMatch(/\nclientSecret\s+default\n/)
    expect(reads).toEqual([CONFIG_PATH, CONFIG_PATH])
  })

  it("lists oauth profiles", async () => {
    const result = await cli(["config", "list"], { files: { [CONFIG_PATH]: oauthProfiles() } })
    expect(JSON.parse(result.stdout)).toEqual([
      {
        name: "p",
        default: true,
        url: null,
        engine: null,
        auth: "oauth",
        readOnly: false,
        scope: "user",
      },
    ])
  })
})

describe("config unset with OAuth settings", () => {
  it("removes a single OAuth setting, as the audience hint says", async () => {
    const files = {
      [CONFIG_PATH]: oauthProfiles({ audience: "engine-rest", clientSecretEnv: "SECRET" }),
    }
    const result = await cli(["config", "unset", "p", "audience", "clientSecret"], { files })
    expect(result.code).toBe(0)
    expect(result.file?.profiles.p?.auth).toEqual({
      type: "oauth",
      issuer: ISSUER,
      clientId: "pulse-cli",
    })
    const blank = await cli(["config", "set", "p", "--oauth-audience", " "], { files })
    expect(errorOf(blank.stderr).hint).toContain("`pulse-cli config unset <profile> audience`")
  })

  it("lists the OAuth settings in the help and in the hint of an unknown key", async () => {
    const help = await cli(["config", "unset", "--help"])
    expect(help.stdout.replace(/\s+/g, " ")).toContain(
      "OAuth settings: issuer, endpoints, clientId, clientSecret, scopes, audience, redirectPort",
    )
    const unknown = await cli(["config", "unset", "p", "secret"], {
      files: { [CONFIG_PATH]: oauthProfiles() },
    })
    expect(errorOf(unknown.stderr).hint).toBe(
      "Valid keys: url, cockpitUrl, engine, platform, auth, output, timeout, headers, readOnly; OAuth settings: issuer, endpoints, clientId, clientSecret, scopes, audience, redirectPort; bearer token: token, tokenEnv.",
    )
  })
})

describe("config delete with an OAuth login", () => {
  it("removes the token cache file under the lock, without revoking", async () => {
    const runtime = fakeRuntime({
      files: { [CONFIG_PATH]: oauthProfiles(), [TOKEN_FILE]: cacheText(cachedLogin(T0)) },
    })
    const result = await execute(run, ["config", "delete", "p"], runtime)
    expect(result.code).toBe(0)
    expect(runtime.files.has(TOKEN_FILE)).toBe(false)
    expect(runtime.locks).toEqual([{ path: `${TOKEN_FILE}.lock`, holdMs: 40_000 }])
    expect(result.stderr).toBe(
      `Deleted profile "p" from ${CONFIG_PATH}\nRemoved the OAuth login of profile "p" (${TOKEN_FILE}); it was not revoked.\n`,
    )
  })

  it("says nothing about a login when there is none", async () => {
    const runtime = fakeRuntime({ files: { [CONFIG_PATH]: oauthProfiles() } })
    const result = await execute(run, ["config", "delete", "p"], runtime)
    expect(result.stderr).toBe(`Deleted profile "p" from ${CONFIG_PATH}\n`)
    expect(runtime.locks).toEqual([])
  })

  it("keeps the login when config unset leaves the OAuth settings, else removes it", async () => {
    const runtime = fakeRuntime({
      files: {
        [CONFIG_PATH]: oauthProfiles({}, { engine: "e" }),
        [TOKEN_FILE]: cacheText(cachedLogin(T0)),
      },
    })
    const engine = await execute(run, ["config", "unset", "p", "engine"], runtime)
    expect(engine.code).toBe(0)
    expect(runtime.files.has(TOKEN_FILE)).toBe(true)
    runtime.stderr.chunks.length = 0
    expect((await execute(run, ["config", "unset", "p", "auth"], runtime)).code).toBe(0)
    expect(runtime.files.has(TOKEN_FILE)).toBe(false)
    expect(runtime.stderr.text()).toBe(
      `Removed the OAuth login of profile "p" for its previous settings (${TOKEN_FILE}); it was not revoked.\n`,
    )
  })
})
