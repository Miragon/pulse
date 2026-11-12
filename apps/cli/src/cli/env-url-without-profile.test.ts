/**
 * PULSE_CLI_URL without `--profile` through `run()`, as a `--url` (url-without-profile.test.ts):
 * the profile the CLI would select otherwise (a defaultProfile, PULSE_CLI_PROFILE) sends nothing,
 * neither its headers nor its engine name, its read-only flag refuses nothing and a broken one fails
 * nothing; the environment's own headers and OAuth login still go, and the auth commands reach that
 * login under the same variable. `--profile p` keeps p with the variable's URL, an empty variable is
 * none, and `config show` and a 401 say why no profile applies.
 */

import { describe, expect, it } from "vitest"
import { errorOf as lastErrorOf, T0 } from "../../test/support/cli-auth.js"
import { errorOf, workflowSetup } from "../../test/support/cli-workflow.js"
import { BASE_URL, fakeServer } from "../../test/support/fake-fetch.js"
import { fakeIdp, ISSUER, routeFetch } from "../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime } from "../../test/support/fake-runtime.js"
import { ADVANCE, expectBare, PROFILE_FILE } from "../../test/support/no-profile.js"
import { oauthProfiles } from "../../test/support/oauth.js"
import { ENGINE_URL, WorkflowEngine } from "../../test/support/workflow-engine.js"
import { run } from "./run.js"

const LEFT_OUT = "PULSE_CLI_URL without --profile selects no profile, so"

function setup(env: Record<string, string> = {}, file = PROFILE_FILE) {
  return workflowSetup(run, "approve", {
    env: { ORDERS_PASSWORD: "profile-password", PULSE_CLI_URL: ENGINE_URL, ...env },
    files: { [CONFIG_PATH]: file },
  })
}

describe("PULSE_CLI_URL without --profile", () => {
  it("sends nothing of the default profile, and its read-only flag refuses nothing", async () => {
    const { cli, engine } = setup()
    expect(await cli(ADVANCE)).toMatchObject({ code: 0, stderr: "" })
    expect(engine.stage).toBe("book")
    expectBare(engine.requests)
  })

  it("sends nothing of the profile PULSE_CLI_PROFILE names, and fails on none it skips", async () => {
    for (const name of ["basic", "orders", "gone"]) {
      const { cli, engine } = setup({ PULSE_CLI_PROFILE: name })
      expect(await cli(ADVANCE)).toMatchObject({ code: 0 })
      expectBare(engine.requests)
    }
  })

  it("fails on no broken default profile, which fails a command without it", async () => {
    for (const defaultProfile of ["gone", "no name!"]) {
      const file = JSON.stringify({ defaultProfile, profiles: { orders: { url: ENGINE_URL } } })
      const { cli, engine } = setup({}, file)
      expect(await cli(ADVANCE)).toMatchObject({ code: 0 })
      expectBare(engine.requests)
      const without = setup({ PULSE_CLI_URL: "" }, file)
      expect(errorOf((await without.cli(ADVANCE)).stderr)).toMatchObject({ code: "CONFIG" })
    }
  })

  it("sends the environment's own headers", async () => {
    const { cli, engine } = setup({ PULSE_CLI_HEADERS: "X-Shell: s" })
    expect(await cli(ADVANCE)).toMatchObject({ code: 0 })
    expectBare(engine.requests)
    expect(engine.requests.every(({ headers }) => headers["x-shell"] === "s")).toBe(true)
  })

  it("renders an early error without the profile's output format", async () => {
    const { cli } = setup()
    expect(errorOf((await cli([...ADVANCE, "--nope"])).stderr)).toMatchObject({ code: "USAGE" })
    const without = setup({ PULSE_CLI_URL: "" })
    expect((await without.cli([...ADVANCE, "--nope"])).stderr).toMatch(/^Error: /)
  })
})

describe("PULSE_CLI_URL beside --profile, and an empty one", () => {
  it("replaces the profile's URL only: its engine name and headers go, its read-only refuses", async () => {
    const { cli, engine } = setup()
    expect(await cli(["inspect", "pi-1", "--profile", "orders"])).toMatchObject({ code: 0 })
    expect(engine.requests.length).toBeGreaterThan(0)
    for (const { url, headers } of engine.requests) {
      expect(url.startsWith(`${ENGINE_URL}/engine/orders/`)).toBe(true)
      expect(headers).toMatchObject({
        authorization: "Bearer profile-token",
        "x-api-key": "profile-key",
      })
    }
    const refused = await cli([...ADVANCE, "--profile", "orders", "-o", "json"])
    expect(errorOf(refused.stderr)).toMatchObject({ code: "READ_ONLY" })
    expect(engine.stage).toBe("approve")
  })

  it("an empty or blank PULSE_CLI_URL is none: the default profile applies", async () => {
    for (const blank of ["", " "]) {
      const { cli, engine } = setup({ PULSE_CLI_URL: blank })
      const refused = await cli([...ADVANCE, "-o", "json"])
      expect(errorOf(refused.stderr)).toMatchObject({ code: "READ_ONLY" })
      expect(engine.requests).toEqual([])
    }
  })
})

describe("config show and a 401 with PULSE_CLI_URL without --profile", () => {
  it("config show says that no profile applies and why", async () => {
    const { cli } = setup({ PULSE_CLI_PROFILE: "basic" })
    const json = await cli(["config", "show", "-o", "json"])
    expect(JSON.parse(json.stdout)).toMatchObject({
      profile: null,
      noProfile: `${LEFT_OUT} PULSE_CLI_PROFILE does not apply`,
      values: { url: { value: ENGINE_URL, source: "env" }, auth: { value: "none" } },
    })
    const table = await cli(["config", "show", "-o", "table"])
    expect(table.stdout).toContain(
      `\nProfile: (none: ${LEFT_OUT} PULSE_CLI_PROFILE does not apply)\n`,
    )
    const named = await cli(["config", "show", "--profile", "basic", "-o", "json"])
    expect(JSON.parse(named.stdout)).toMatchObject({
      profile: "basic",
      values: { url: { source: "env" } },
    })
    expect(JSON.parse(named.stdout)).not.toHaveProperty("noProfile")
    const flag = await cli(["config", "show", "--url", ENGINE_URL, "-o", "json"])
    expect(JSON.parse(flag.stdout)).toMatchObject({
      noProfile: "--url without --profile selects no profile, so PULSE_CLI_PROFILE does not apply",
    })
  })

  it("a 401 without credentials names the profile PULSE_CLI_URL leaves out", async () => {
    const server = fakeServer().on(
      "GET",
      "/process-instance/pi-1",
      new Response("", { status: 401 }),
    )
    const runtime = fakeRuntime({
      fetch: server.fetch,
      env: { PULSE_CLI_URL: BASE_URL },
      files: { [CONFIG_PATH]: PROFILE_FILE },
    })
    const result = await execute(run, ["process-instance", "get", "pi-1"], runtime)
    expect(lastErrorOf(result.stderr).hint).toMatch(
      /^The engine requires authentication and pulse sent no credentials: PULSE_CLI_URL without --profile selects no profile, so the default profile of the config file does not apply\. Use Basic auth/,
    )
  })
})

describe("an OAuth login from the environment beside PULSE_CLI_URL", () => {
  it("is the environment's, which the hint and the auth commands reach", async () => {
    const idp = fakeIdp()
    const engine = new WorkflowEngine("approve")
    const runtime = fakeRuntime({
      fetch: routeFetch(idp, engine.fetch),
      now: () => T0,
      onSleep: () => {
        engine.tick()
      },
      env: {
        PULSE_CLI_URL: ENGINE_URL,
        PULSE_CLI_AUTH: "oauth",
        PULSE_CLI_OAUTH_ISSUER: ISSUER,
        PULSE_CLI_OAUTH_CLIENT_ID: "pulse-cli",
      },
      files: { [CONFIG_PATH]: PROFILE_FILE },
      browser: async (url, fake) => {
        await fake.loopback.request("/callback", idp.authorize(url))
        return true
      },
    })
    const cli = async (args: readonly string[]) => {
      runtime.stdout.chunks.length = 0
      runtime.stderr.chunks.length = 0
      return execute(run, args, runtime)
    }
    const before = lastErrorOf((await cli(ADVANCE)).stderr)
    expect(before).toMatchObject({
      code: "LOGIN_REQUIRED",
      message: "Not logged in: the environment configuration has no OAuth login",
    })
    expect(before.hint).toContain("Run `pulse auth login --url <url>` in a terminal with")
    // the default profile's Authorization header no longer refuses OAuth: it does not apply
    const status = lastErrorOf((await cli(["auth", "status"])).stderr)
    expect(status).toMatchObject({ code: "LOGIN_REQUIRED", hint: before.hint })
    expect((await cli(["auth", "login"])).stderr).toContain("(no profile)")
    expect(await cli(ADVANCE)).toMatchObject({ code: 0 })
    expect(engine.stage).toBe("book")
    expect(engine.requests.at(-1)?.headers.authorization).toMatch(/^Bearer \S+$/)
    expect((await cli(["auth", "status"])).code).toBe(0)
    const logout = await cli(["auth", "logout"])
    expect(JSON.parse(logout.stdout)).toMatchObject({ profile: null, removed: true })
  })
})

/** The way to OAuth the auth commands name when a URL selects no profile. */
const WAY_TO_OAUTH =
  "pass --profile <profile>, a profile with OAuth (pulse config set <profile> --url <url> --auth oauth --oauth-issuer <url> --oauth-client-id <id> sets one up), or set PULSE_CLI_AUTH=oauth with PULSE_CLI_OAUTH_ISSUER and PULSE_CLI_OAUTH_CLIENT_ID"

describe("the auth commands beside a default OAuth profile", () => {
  it("say that the URL leaves it out and how to log in instead", async () => {
    const runtime = fakeRuntime({
      env: { PULSE_CLI_URL: ENGINE_URL },
      files: { [CONFIG_PATH]: oauthProfiles() },
    })
    const how = `selects no profile, so the default profile of the config file does not apply: ${WAY_TO_OAUTH}`
    for (const command of [["login"], ["status"], ["logout"], ["login", "--url", ENGINE_URL]]) {
      runtime.stderr.chunks.length = 0
      const error = lastErrorOf((await execute(run, ["auth", ...command], runtime)).stderr)
      const by = command.includes("--url") ? "--url" : "PULSE_CLI_URL"
      expect(error).toMatchObject({ code: "CONFIG" })
      expect(String(error.hint).startsWith(`${by} without --profile ${how}`)).toBe(true)
    }
  })

  it("name the command that sets up a profile with OAuth when there is no profile", async () => {
    for (const command of [["login"], ["login", "--url", ENGINE_URL]]) {
      const env: Record<string, string> = command.includes("--url")
        ? {}
        : { PULSE_CLI_URL: ENGINE_URL }
      const runtime = fakeRuntime({ env })
      const error = lastErrorOf((await execute(run, ["auth", ...command], runtime)).stderr)
      const by = command.includes("--url") ? "--url" : "PULSE_CLI_URL"
      expect(error).toMatchObject({
        code: "CONFIG",
        message: "pulse auth login needs OAuth, but the configuration uses none",
        hint: `${by} without --profile selects no profile: ${WAY_TO_OAUTH}`,
      })
    }
  })

  it("say why no profile applies when Basic auth from the environment does not resolve", async () => {
    // PULSE_CLI_USERNAME without a password fails the resolution, so the hint comes from the
    // selection alone, as for a Basic profile whose password is not set
    const runtime = fakeRuntime({
      env: { PULSE_CLI_URL: ENGINE_URL, PULSE_CLI_USERNAME: "u" },
      files: { [CONFIG_PATH]: PROFILE_FILE },
    })
    const how = `PULSE_CLI_URL without --profile selects no profile, so the default profile of the config file does not apply: ${WAY_TO_OAUTH}`
    for (const command of ["login", "status"]) {
      runtime.stderr.chunks.length = 0
      const result = await execute(run, ["auth", command], runtime)
      const error = lastErrorOf(result.stderr)
      expect(result.code).toBe(3)
      expect(error).toMatchObject({ code: "CONFIG" })
      expect(String(error.message)).toMatch(/but the configuration uses basic$/)
      expect(String(error.hint).startsWith(how)).toBe(true)
    }
  })
})
