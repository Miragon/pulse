/**
 * A `--url` without `--profile` through `run()`, by the requests the CLI sends: the profile the CLI
 * would select otherwise (a defaultProfile, PULSE_CLI_PROFILE) sends nothing, neither its headers
 * nor its login or token nor its engine name, and its read-only flag refuses nothing; the
 * environment's own headers and OAuth login still go, the auth commands reach that login with the
 * same `--url`. `--profile p --url X` of the origin of p stays per value (url-beside-profile.test.ts
 * refuses another origin), and `config show` and a 401 say why no profile applies.
 */

import { describe, expect, it } from "vitest"
import { errorOf as lastErrorOf, T0 } from "../../test/support/cli-auth.js"
import { errorOf, workflowSetup } from "../../test/support/cli-workflow.js"
import { BASE_URL, fakeServer } from "../../test/support/fake-fetch.js"
import { fakeIdp, ISSUER, routeFetch } from "../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime } from "../../test/support/fake-runtime.js"
import { ADVANCE, expectBare, PROFILE_FILE as FILE } from "../../test/support/no-profile.js"
import { ENGINE_URL, WorkflowEngine } from "../../test/support/workflow-engine.js"
import { run } from "./run.js"

/** The command Pulse for VS Code and Pulse for Orca show for their default engine. */
const EDITOR_COMMAND = [...ADVANCE, "--url", ENGINE_URL]

/** Another URL of the origin of the profile orders, spelled as the URL API normalises it away. */
const ORDERS_ORIGIN = "HTTPS://Orders.Example.com:443/engine-rest"

function setup(env: Record<string, string> = {}) {
  return workflowSetup(run, "approve", {
    env: { ORDERS_PASSWORD: "profile-password", ...env },
    files: { [CONFIG_PATH]: FILE },
  })
}

describe("a --url without --profile", () => {
  it("sends nothing of the default profile, and its read-only flag refuses nothing", async () => {
    for (const command of [EDITOR_COMMAND, [...EDITOR_COMMAND, "--auth", "none"]]) {
      const { cli, engine } = setup()
      expect(await cli(command)).toMatchObject({ code: 0, stderr: "" })
      expect(engine.stage).toBe("book")
      expectBare(engine.requests)
    }
  })

  it("sends nothing of the profile PULSE_CLI_PROFILE names, and fails on none it skips", async () => {
    for (const name of ["basic", "orders", "gone"]) {
      const { cli, engine } = setup({ PULSE_CLI_PROFILE: name })
      expect(await cli(EDITOR_COMMAND)).toMatchObject({ code: 0 })
      expectBare(engine.requests)
    }
    const { cli } = setup({ PULSE_CLI_PROFILE: "gone" })
    expect(errorOf((await cli(["inspect", "pi-1"])).stderr)).toMatchObject({ code: "CONFIG" })
  })

  it("sends the environment's own headers", async () => {
    const { cli, engine } = setup({ PULSE_CLI_HEADERS: "X-Shell: s" })
    expect(await cli([...EDITOR_COMMAND, "--auth", "none"])).toMatchObject({ code: 0 })
    expectBare(engine.requests)
    expect(engine.requests.every(({ headers }) => headers["x-shell"] === "s")).toBe(true)
  })

  it("takes no login or token of a default profile with OAuth or a bearer token", async () => {
    const auths = [
      { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" },
      { type: "bearer", tokenEnv: "ORDERS_TOKEN" },
    ]
    for (const auth of auths) {
      const profiles = { sso: { url: ENGINE_URL, auth } }
      const { cli, engine, runtime } = workflowSetup(run, "approve", {
        env: { ORDERS_TOKEN: "profile-token" },
        files: { [CONFIG_PATH]: JSON.stringify({ defaultProfile: "sso", profiles }) },
      })
      expect(await cli(EDITOR_COMMAND)).toMatchObject({ code: 0, stderr: "" })
      expectBare(engine.requests)
      expect(runtime.browserUrls).toEqual([])
      // without --url the profile applies: its login is missing, its token goes
      const own = await cli(["inspect", "pi-1"])
      if (auth.type === "oauth")
        expect(errorOf(own.stderr)).toMatchObject({ code: "LOGIN_REQUIRED" })
      else expect(engine.requests.at(-1)?.headers.authorization).toBe("Bearer profile-token")
    }
  })

  it("renders an early error without the profile's output format", async () => {
    const { cli } = setup()
    const withUrl = await cli(["advance", "pi-1", "--url", ENGINE_URL, "--nope"])
    expect(errorOf(withUrl.stderr)).toMatchObject({ code: "USAGE" })
    expect((await cli(["advance", "pi-1", "--nope"])).stderr).toMatch(/^Error: /)
  })
})

describe("--profile beside a --url of its origin", () => {
  it("replaces the profile's URL only: its engine name and headers go, its read-only refuses", async () => {
    const { cli, engine } = setup()
    expect(
      await cli(["inspect", "pi-1", "--profile", "orders", "--url", ORDERS_ORIGIN]),
    ).toMatchObject({ code: 0 })
    expect(engine.requests.length).toBeGreaterThan(0)
    for (const { url, headers } of engine.requests) {
      expect(url.startsWith("https://orders.example.com/engine-rest/engine/orders/")).toBe(true)
      expect(headers).toMatchObject({
        authorization: "Bearer profile-token",
        "x-api-key": "profile-key",
      })
    }
    const refused = await cli([
      ...ADVANCE,
      "--url",
      ORDERS_ORIGIN,
      "--profile",
      "orders",
      "-o",
      "json",
    ])
    expect(errorOf(refused.stderr)).toMatchObject({ code: "READ_ONLY" })
    expect(engine.stage).toBe("approve")
  })
})

describe("config show with a --url without --profile", () => {
  it("says that no profile applies and why", async () => {
    const { cli } = setup({ PULSE_CLI_PROFILE: "basic" })
    const json = await cli(["config", "show", "--url", ENGINE_URL, "-o", "json"])
    expect(JSON.parse(json.stdout)).toMatchObject({
      profile: null,
      profileFile: null,
      noProfile: "--url without --profile selects no profile, so PULSE_CLI_PROFILE does not apply",
      values: { url: { value: ENGINE_URL, source: "flag" }, auth: { value: "none" } },
    })
    const table = await cli(["config", "show", "--url", ENGINE_URL, "-o", "table"])
    expect(table.stdout).toContain(
      "\nProfile: (none: --url without --profile selects no profile, so PULSE_CLI_PROFILE does not apply)\n",
    )
    const show = ["config", "show", "--url", ORDERS_ORIGIN, "--profile", "orders", "-o", "json"]
    const named = await cli(show)
    expect(JSON.parse(named.stdout)).toMatchObject({ profile: "orders" })
    expect(JSON.parse(named.stdout)).not.toHaveProperty("noProfile")
  })
})

describe("an OAuth login from the environment beside a --url", () => {
  it("is the environment's, which the hint and the auth commands reach with --url", async () => {
    const idp = fakeIdp()
    const engine = new WorkflowEngine("approve")
    const runtime = fakeRuntime({
      fetch: routeFetch(idp, engine.fetch),
      now: () => T0,
      onSleep: () => {
        engine.tick()
      },
      env: {
        PULSE_CLI_AUTH: "oauth",
        PULSE_CLI_OAUTH_ISSUER: ISSUER,
        PULSE_CLI_OAUTH_CLIENT_ID: "pulse-cli",
      },
      files: { [CONFIG_PATH]: FILE },
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
    const before = lastErrorOf((await cli(EDITOR_COMMAND)).stderr)
    expect(before).toMatchObject({
      code: "LOGIN_REQUIRED",
      message: "Not logged in: the environment configuration has no OAuth login",
    })
    expect(before.hint).toContain("Run `pulse auth login --url <url>` in a terminal with")
    // without --url, auth status takes the default profile, whose Authorization header refuses OAuth
    expect(lastErrorOf((await cli(["auth", "status", "-o", "json"])).stderr)).toMatchObject({
      code: "CONFIG",
    })
    const status = lastErrorOf((await cli(["auth", "status", "--url", ENGINE_URL])).stderr)
    expect(status).toMatchObject({ code: "LOGIN_REQUIRED", hint: before.hint })
    expect((await cli(["auth", "login", "--url", ENGINE_URL])).stderr).toContain("(no profile)")
    expect(await cli(EDITOR_COMMAND)).toMatchObject({ code: 0 })
    expect(engine.stage).toBe("book")
    expect(engine.requests.at(-1)?.headers.authorization).toMatch(/^Bearer \S+$/)
    expect((await cli(["auth", "status", "--url", ENGINE_URL])).code).toBe(0)
    const logout = await cli(["auth", "logout", "--url", ENGINE_URL])
    expect(JSON.parse(logout.stdout)).toMatchObject({ profile: null, removed: true })
  })
})

describe("a 401 and config show with a --url without --profile", () => {
  it("a 401 without credentials names the profile the --url leaves out", async () => {
    const server = fakeServer().on(
      "GET",
      "/process-instance/pi-1",
      new Response("", { status: 401 }),
    )
    const runtime = fakeRuntime({ fetch: server.fetch, files: { [CONFIG_PATH]: FILE } })
    const result = await execute(
      run,
      ["process-instance", "get", "pi-1", "--url", BASE_URL],
      runtime,
    )
    expect(lastErrorOf(result.stderr).hint).toMatch(
      /^The engine requires authentication and pulse sent no credentials: --url without --profile selects no profile, so the default profile of the config file does not apply\. Use Basic auth/,
    )
  })

  it("config show names the only profile of a project file as its default profile", async () => {
    const project = { profiles: { svc: { url: "http://localhost:8112/engine-rest" } } }
    const { cli } = workflowSetup(run, "approve", {
      cwd: "/home/tester/repo/src",
      dirs: ["/home/tester/repo/.git"],
      files: { "/home/tester/repo/.pulse.json": JSON.stringify(project) },
    })
    const shown = await cli(["config", "show", "--url", ENGINE_URL, "-o", "json"])
    expect(JSON.parse(shown.stdout)).toMatchObject({
      profile: null,
      noProfile:
        "--url without --profile selects no profile, so the default profile of the project file /home/tester/repo/.pulse.json does not apply",
    })
    expect(JSON.parse((await cli(["config", "show", "-o", "json"])).stdout)).toMatchObject({
      profile: "svc",
    })
  })
})
