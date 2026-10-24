/**
 * HTTP Basic authentication (issue 1 of the archived operate repository) of the built CLI against one engine whose
 * REST API requires it: credentials from flags, stdin, environment and profile, the errors before
 * and after sending, and that no output ever contains a password or its base64 token.
 *
 * The engines delay the next login of a user after a failed one (3 s, growing; locked after 10
 * failures), so every rejected login uses {@link REJECTED_USER}, which no other test logs in as.
 */

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { basicToken, createUser, type Credentials } from "./support/basic-auth.js"
import { argv, globalFlag } from "./support/catalog.js"
import { assertCliBuilt, bindCli, type Cli, type CliError, type CliResult } from "./support/cli.js"
import {
  ADMIN,
  ENGINE_START_TIMEOUT_MS,
  type EngineName,
  ENGINES,
  isEngineEnabled,
  type RunningEngine,
  startEngine,
} from "./support/engines.js"
import { expectError, expectSuccess, required } from "./support/expect.js"
import type { EnvOverrides } from "./support/process.js"
import { makeTempDir, removeTempDir } from "./support/temp.js"
import type {
  ConfigShowOutput,
  Count,
  DryRunOutput,
  PingOutput,
  ProcessDefinition,
} from "./support/types.js"

/** Logs in through the profile; the non-ASCII password proves the UTF-8 encoding of the token. */
const PROFILE_USER: Credentials = { username: "operateit", password: "Pässwörd-€-it" }
/** The only user that ever gets a wrong password (see the file comment). */
const REJECTED_USER: Credentials = { username: "operaterejected", password: "right-pw-1" }
const WRONG_PASSWORD = "wrong-pw-2"
/** Variable named by the profile's `passwordEnv`. */
const PASSWORD_ENV = "IT_PW"
const PROFILE = "it"
/** Profile with a literal password (`config set --auth-password-stdin`). */
const LITERAL_PROFILE = "it-literal"

/** A request line of the `--verbose` trace: the request was sent. */
const SENT_REQUEST = /^> (?:GET|POST|PUT|DELETE) /m
const MASKED_TRACE = /^> authorization: Basic \*\*\*$/im
const MASKED_CURL = /'authorization: Basic \*\*\*'/i

/** Complete Basic auth credentials from the environment. */
function basicEnv({ username, password }: Credentials): EnvOverrides {
  return { OPERATE_AUTH: "basic", OPERATE_USERNAME: username, OPERATE_PASSWORD: password }
}

/** The password and the base64 token of the credentials. */
function secretsOf(credentials: Credentials): string[] {
  return [credentials.password, basicToken(credentials)]
}

/** Neither stdout nor stderr contains any of the secrets. */
function expectHidden(result: CliResult, secrets: readonly string[]): void {
  for (const secret of secrets) {
    expect(result.stdout, result.diagnostics).not.toContain(secret)
    expect(result.stderr, result.diagnostics).not.toContain(secret)
  }
}

/** Message and hint of an error, for checks that do not care which of the two says it. */
function explanation(error: CliError): string {
  return `${error.message}\n${error.hint ?? ""}`
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
}

/** A profile as the config file stores it. */
interface StoredProfile {
  readonly url?: string
  readonly auth?: unknown
}

interface SourcedValue {
  readonly value: unknown
  readonly source: string
}

/** Every `{value, source}` entry of a `config show` view, however deeply it is nested. */
function sourcedValues(view: unknown): SourcedValue[] {
  if (typeof view !== "object" || view === null) return []
  const nested = Object.values(view).flatMap(sourcedValues)
  if (!("value" in view) || !("source" in view) || typeof view.source !== "string") return nested
  return [{ value: view.value, source: view.source }, ...nested]
}

export function registerAuthScenario(engineName: EngineName): void {
  describe.skipIf(!isEngineEnabled(engineName))(`Basic auth against ${engineName}`, () => {
    let engine: RunningEngine | undefined
    let workdir: string | undefined
    let configFile = ""
    /** Config file of the profile tests; their first profile becomes the default profile. */
    let profilesFile = ""
    let cli: Cli = () => Promise.reject(new Error("the engine did not start"))
    const profileCli: Cli = (args, options = {}) =>
      cli(args, { configFile: profilesFile, ...options })

    const engineUrl = () => required(engine, "the engine").url

    async function readProfiles(): Promise<Readonly<Record<string, StoredProfile | undefined>>> {
      const stored = JSON.parse(await readFile(profilesFile, "utf8")) as {
        profiles: Record<string, StoredProfile>
      }
      return stored.profiles
    }

    beforeAll(async () => {
      assertCliBuilt()
      workdir = await makeTempDir(`operate-it-${engineName}-auth-`)
      configFile = join(workdir, "config.json")
      profilesFile = join(workdir, "profiles.json")
      // OPERATE_CONFIG names the file explicitly, so it must exist (an empty one: no profiles)
      await writeFile(configFile, '{"profiles":{}}\n')
      await writeFile(profilesFile, '{"profiles":{}}\n')
      engine = await startEngine(engineName, { basicAuth: true })
      await createUser(engine.url, ADMIN, PROFILE_USER)
      await createUser(engine.url, ADMIN, REJECTED_USER)
      cli = bindCli({
        url: engine.url,
        configFile,
        // keep the real user config out of reach even if OPERATE_CONFIG is removed
        env: {
          XDG_CONFIG_HOME: workdir,
          OPERATE_PLATFORM: engine.platform,
          [PASSWORD_ENV]: undefined,
        },
      })
    }, ENGINE_START_TIMEOUT_MS)

    afterAll(async () => {
      await engine?.stop()
      await removeTempDir(workdir)
    })

    it("refuses requests without credentials and explains how to send them", async () => {
      const result = await cli(argv("process-definition list"))
      const error = expectError(result, "UNAUTHORIZED", 4)
      expect(error.status).toBe(401)
      expect(error.hint).toMatch(/sent no credentials/)
      expect(error.hint).toContain("--auth basic --auth-user")
      expect(error.hint).toContain("OPERATE_USERNAME")
      expect(error.hint).not.toContain("issues/1")
      expect(result.stdout).toBe("")
    })

    it("switches Basic auth off with --auth none", async () => {
      const result = await cli(["ping", globalFlag("auth"), "none"], { env: basicEnv(ADMIN) })
      expect(expectError(result, "UNAUTHORIZED", 4).hint).toMatch(/sent no credentials/)
    })

    it("authenticates with OPERATE_AUTH, OPERATE_USERNAME and OPERATE_PASSWORD", async () => {
      const ping = expectSuccess(await cli(["ping"], { env: basicEnv(ADMIN) }))
      expect(ping.json<PingOutput>()).toMatchObject({
        url: engineUrl(),
        reachable: true,
        version: ENGINES[engineName].version,
        auth: "basic",
        user: ADMIN.username,
      })

      const count = await cli(argv("process-definition count"), { env: basicEnv(ADMIN) })
      expect(expectSuccess(count).json<Count>()).toEqual({ count: expect.any(Number) })
    })

    it("reads the password from the first line of stdin with --auth-password-stdin", async () => {
      const flags = { auth: "basic", "auth-user": ADMIN.username, "auth-password-stdin": true }
      for (const stdin of [`${ADMIN.password}\n`, `${ADMIN.password}\r\nsecond line\n`]) {
        const result = await cli(argv("process-definition list", [], flags), { stdin })
        expect(expectSuccess(result).json<ProcessDefinition[]>()).toEqual(expect.any(Array))
      }
    })

    it("refuses an empty password on stdin and a second reader of stdin", async () => {
      const flags = { auth: "basic", "auth-user": ADMIN.username, "auth-password-stdin": true }
      for (const stdin of ["", "\n"]) {
        const empty = await cli(argv("process-definition list", [], flags), { stdin })
        expectError(empty, "USAGE", 2)
      }
      const both = await cli(argv("process-instance query", [], { ...flags, body: "-" }), {
        stdin: `${ADMIN.password}\n`,
      })
      expectError(both, "USAGE", 2)
    })

    it("infers Basic auth from a username alone", async () => {
      const result = await cli(["ping", globalFlag("auth-user"), ADMIN.username], {
        env: { OPERATE_PASSWORD: ADMIN.password },
      })
      expect(expectSuccess(result).json<PingOutput>()).toMatchObject({
        reachable: true,
        auth: "basic",
        user: ADMIN.username,
      })
    })

    it("uses the credentials of a profile written by config set", async () => {
      const set = await profileCli([
        "config",
        "set",
        PROFILE,
        globalFlag("url"),
        engineUrl(),
        globalFlag("auth"),
        "basic",
        globalFlag("auth-user"),
        PROFILE_USER.username,
        "--auth-password-env",
        PASSWORD_ENV,
      ])
      expectSuccess(set)
      expect((await readProfiles())[PROFILE]?.auth).toEqual({
        type: "basic",
        username: PROFILE_USER.username,
        passwordEnv: PASSWORD_ENV,
      })

      const env = { OPERATE_URL: undefined, [PASSWORD_ENV]: PROFILE_USER.password }
      const ping = await profileCli(["ping", globalFlag("profile"), PROFILE], { env })
      expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
        url: engineUrl(),
        reachable: true,
        auth: "basic",
        user: PROFILE_USER.username,
      })

      const off = await profileCli(["ping", globalFlag("profile"), PROFILE], {
        env: { ...env, OPERATE_AUTH: "none" },
      })
      expect(expectError(off, "UNAUTHORIZED", 4).hint).toMatch(
        /sent no credentials: Basic auth is switched off by OPERATE_AUTH=none\./,
      )
    })

    it("masks the profile password in config show unless --show-secrets", async () => {
      const env = { OPERATE_URL: undefined, [PASSWORD_ENV]: PROFILE_USER.password }
      const show = await profileCli(["config", "show", globalFlag("profile"), PROFILE], { env })
      const values = sourcedValues(expectSuccess(show).json<ConfigShowOutput>().values)
      expect(values).toContainEqual({ value: "basic", source: "profile" })
      expect(values).toContainEqual({ value: PROFILE_USER.username, source: "profile" })
      expect(values).toContainEqual(expect.objectContaining({ value: "***" }))
      expectHidden(show, secretsOf(PROFILE_USER))

      const revealed = await profileCli(
        ["config", "show", globalFlag("profile"), PROFILE, globalFlag("show-secrets")],
        { env },
      )
      expect(sourcedValues(expectSuccess(revealed).json<ConfigShowOutput>().values)).toContainEqual(
        expect.objectContaining({ value: PROFILE_USER.password }),
      )
    })

    it("fails with CONFIG naming the unset variable of passwordEnv", async () => {
      const result = await profileCli(
        ["ping", globalFlag("profile"), PROFILE, globalFlag("verbose")],
        {
          env: { OPERATE_URL: undefined },
        },
      )
      expect(explanation(expectError(result, "CONFIG", 3))).toContain(PASSWORD_ENV)
      expect(result.stderr).not.toMatch(SENT_REQUEST)
    })

    it("refuses a password given as the name of its variable, never storing or repeating it", async () => {
      // a password that happens to be a valid variable name, typed instead of the name
      const typed = "Pw_never_printed_4"
      const set = await profileCli([
        "config",
        "set",
        "it-misnamed",
        globalFlag("url"),
        engineUrl(),
        globalFlag("auth"),
        "basic",
        globalFlag("auth-user"),
        PROFILE_USER.username,
        "--auth-password-env",
        typed,
      ])
      expect(explanation(expectError(set, "CONFIG", 3))).toContain("--auth-password-env")
      expectHidden(set, [typed])
      expect((await readProfiles())["it-misnamed"]).toBeUndefined()

      // a hand-edited profile with the same mistake: not repeated, nothing sent
      const handEdited = join(required(workdir, "the work directory"), "misnamed.json")
      const auth = { type: "basic", username: PROFILE_USER.username, passwordEnv: typed }
      await writeFile(handEdited, JSON.stringify({ profiles: { x: { url: engineUrl(), auth } } }))
      const ping = await cli(["ping", globalFlag("profile"), "x", globalFlag("verbose")], {
        configFile: handEdited,
        env: { OPERATE_URL: undefined },
      })
      expect(expectError(ping, "CONFIG", 3).message).toBe(
        'The password variable named by auth.passwordEnv of profile "x" is not set or empty',
      )
      expect(ping.stderr).not.toMatch(SENT_REQUEST)
      expectHidden(ping, [typed])
    })

    it("stores a literal password from stdin with a warning", async () => {
      const set = await profileCli(
        [
          "config",
          "set",
          LITERAL_PROFILE,
          globalFlag("url"),
          engineUrl(),
          globalFlag("auth"),
          "basic",
          globalFlag("auth-user"),
          PROFILE_USER.username,
          globalFlag("auth-password-stdin"),
        ],
        { stdin: `${PROFILE_USER.password}\n` },
      )
      expect(expectSuccess(set).stderr).toContain("--auth-password-env")
      expectHidden(set, secretsOf(PROFILE_USER))
      expect((await readProfiles())[LITERAL_PROFILE]?.auth).toEqual({
        type: "basic",
        username: PROFILE_USER.username,
        password: PROFILE_USER.password,
      })

      const ping = await profileCli(["ping", globalFlag("profile"), LITERAL_PROFILE], {
        env: { OPERATE_URL: undefined },
      })
      expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
        auth: "basic",
        user: PROFILE_USER.username,
      })
    })

    it("removes every auth setting with config unset <profile> auth", async () => {
      expectSuccess(await profileCli(["config", "unset", LITERAL_PROFILE, "auth"]))
      const profile = (await readProfiles())[LITERAL_PROFILE]
      expect(profile).toMatchObject({ url: engineUrl() })
      expect(profile).not.toHaveProperty("auth")

      const ping = await profileCli(["ping", globalFlag("profile"), LITERAL_PROFILE], {
        env: { OPERATE_URL: undefined },
      })
      expect(expectError(ping, "UNAUTHORIZED", 4).hint).toMatch(/sent no credentials/)
    })

    it("names the user and source of rejected credentials but never the password", async () => {
      const wrong = { ...REJECTED_USER, password: WRONG_PASSWORD }
      const result = await cli([...argv("process-definition list"), globalFlag("verbose")], {
        env: basicEnv(wrong),
      })
      const error = expectError(result, "UNAUTHORIZED", 4)
      expect(error.status).toBe(401)
      expect(error.hint).toMatch(
        new RegExp(`rejected the credentials of user\\W+${REJECTED_USER.username}\\b`),
      )
      expect(error.hint).toContain("source: env")
      expect(result.stderr).toMatch(MASKED_TRACE)
      expectHidden(result, secretsOf(wrong))
    })

    it("masks the Authorization header in the --verbose trace unless --show-secrets", async () => {
      const args = [...argv("process-definition count"), globalFlag("verbose")]
      const masked = await cli(args, { env: basicEnv(ADMIN) })
      expect(expectSuccess(masked).stderr).toMatch(MASKED_TRACE)
      expect(masked.stderr).not.toContain(basicToken(ADMIN))

      const revealed = await cli([...args, globalFlag("show-secrets")], { env: basicEnv(ADMIN) })
      expect(expectSuccess(revealed).stderr).toContain(`Basic ${basicToken(ADMIN)}`)
    })

    it("previews the masked Authorization header with --dry-run", async () => {
      const preview = await cli(argv("process-definition count", [], { "dry-run": true }), {
        env: basicEnv(ADMIN),
      })
      const request = expectSuccess(preview).json<DryRunOutput>()
      expect(headerValue(request.headers, "authorization")).toBe("Basic ***")
      expect(request.curl).toMatch(MASKED_CURL)
      expect(preview.stdout).not.toContain(basicToken(ADMIN))

      const revealed = await cli(
        argv("process-definition count", [], { "dry-run": true, "show-secrets": true }),
        { env: basicEnv(ADMIN) },
      )
      const { headers } = expectSuccess(revealed).json<DryRunOutput>()
      expect(headerValue(headers, "authorization")).toBe(`Basic ${basicToken(ADMIN)}`)
    })

    it("fails with CONFIG before any request when a credential is missing", async () => {
      const noPassword = await cli([
        "ping",
        globalFlag("auth"),
        "basic",
        globalFlag("auth-user"),
        ADMIN.username,
        globalFlag("verbose"),
      ])
      const passwordError = explanation(expectError(noPassword, "CONFIG", 3))
      expect(passwordError).toContain("--auth-password-stdin")
      expect(passwordError).toContain("OPERATE_PASSWORD")
      expect(noPassword.stderr).not.toMatch(SENT_REQUEST)

      const lonePassword = "never-printed-3"
      const noUser = await cli(["ping", globalFlag("verbose")], {
        env: { OPERATE_AUTH: "basic", OPERATE_PASSWORD: lonePassword },
      })
      expect(explanation(expectError(noUser, "CONFIG", 3))).toContain("OPERATE_USERNAME")
      expect(noUser.stderr).not.toMatch(SENT_REQUEST)
      expectHidden(noUser, [lonePassword])
    })

    it("refuses Basic auth together with an explicit Authorization header", async () => {
      const result = await cli(
        [
          "ping",
          globalFlag("auth"),
          "basic",
          globalFlag("auth-user"),
          ADMIN.username,
          globalFlag("header"),
          "Authorization: x",
          globalFlag("verbose"),
        ],
        { env: { OPERATE_PASSWORD: ADMIN.password } },
      )
      expect(explanation(expectError(result, "CONFIG", 3))).toContain("Authorization")
      expect(result.stderr).not.toMatch(SENT_REQUEST)
    })
  })
}
