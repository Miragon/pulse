/**
 * The editors' command for a project file's target, `--profile <name> --url <the project file's
 * URL>`, through `run()` in a repository (src/config/url-beside-profile.ts): a profile of the same
 * name in the user's config file that holds credentials for another origin fails (CONFIG) before
 * any request, the auth commands too before any login lookup; the user's profile of the project
 * file's origin, a profile of the project file alone and PULSE_CLI_URL beside `--profile` go on and
 * send what they send per value.
 */

import { describe, expect, it, vi } from "vitest"
import { errorOf, T0 } from "../../test/support/cli-auth.js"
import { fakeIdp, ISSUER, routeFetch } from "../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime, fileText } from "../../test/support/fake-runtime.js"
import { ADVANCE } from "../../test/support/no-profile.js"
import { cacheText, cachedLogin, TOKEN_DIR, TOKEN_FILE } from "../../test/support/oauth.js"
import { WorkflowEngine } from "../../test/support/workflow-engine.js"
import { run } from "./run.js"

const REPO = "/home/tester/repo"
const PROJECT_URL = "http://127.0.0.1:8942/engine-rest"
const OWN_URL = "http://127.0.0.1:8941/engine-rest"
/** The command Pulse for VS Code and Pulse for Orca show for a target of the project file. */
const EDITOR_COMMAND = [...ADVANCE, "--profile", "orders", "--url", PROJECT_URL]
const SECRETS = { Authorization: "Bearer user-token", "X-Api-Key": "user-key" }

/** The repository's project file: orders on PROJECT_URL with a header of its own. */
const PROJECT_FILE = JSON.stringify({
  profiles: { orders: { url: PROJECT_URL, headers: { "X-Team": "orders" } } },
})

/** The user's config file holding `orders` as given, or nothing. */
function userFile(orders?: Readonly<Record<string, unknown>>): Record<string, string> {
  return orders === undefined ? {} : { [CONFIG_PATH]: JSON.stringify({ profiles: { orders } }) }
}

/** The CLI in the repository, its fake engine and authorization server recording every request. */
function inRepository(files: Record<string, string>, env: Record<string, string> = {}) {
  const engine = new WorkflowEngine("approve")
  const idp = fakeIdp()
  const runtime = fakeRuntime({
    fetch: routeFetch(idp, engine.fetch),
    now: () => T0,
    onSleep: () => {
      engine.tick()
    },
    cwd: `${REPO}/src`,
    dirs: [`${REPO}/.git`],
    files: { [`${REPO}/.pulse.json`]: PROJECT_FILE, ...files },
    env,
  })
  const read = vi.spyOn(runtime.fs, "readFile")
  const cli = async (args: readonly string[]) => {
    runtime.stdout.chunks.length = 0
    runtime.stderr.chunks.length = 0
    return execute(run, args, runtime)
  }
  const sent = () => [...engine.requests, ...idp.requests]
  const tokensRead = () => read.mock.calls.filter(([path]) => path.startsWith(TOKEN_DIR)).length
  return { cli, engine, runtime, sent, tokensRead }
}

describe("the editors' command beside a profile of the same name in your config file", () => {
  it("fails before any request when your profile holds credentials for another origin", async () => {
    const { cli, sent } = inRepository(userFile({ url: OWN_URL, headers: SECRETS }))
    const result = await cli(EDITOR_COMMAND)
    expect(result).toMatchObject({ code: 3, stdout: "" })
    expect(errorOf(result.stderr)).toEqual({
      code: "CONFIG",
      exitCode: 3,
      message:
        'Profile "orders" of your config file holds credentials (headers Authorization, X-Api-Key) for http://127.0.0.1:8941; pulse does not send them to http://127.0.0.1:8942, the origin --url names',
      hint: "Drop --url to use the profile with its own URL, or point the profile at that engine with `pulse config set orders --url <url>`.",
    })
    expect(result.stderr).not.toMatch(/user-(token|key)/)
    expect(sent()).toEqual([])
  })

  it("fails for Basic auth, OAuth and a bearer token of your profile alike", async () => {
    const auths = [
      { type: "basic", username: "demo", passwordEnv: "ORDERS_PASSWORD" },
      { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" },
      { type: "bearer", tokenEnv: "ORDERS_TOKEN" },
    ]
    for (const auth of auths) {
      const env = { ORDERS_PASSWORD: "user-password", ORDERS_TOKEN: "user-token" }
      const { cli, sent, runtime } = inRepository(userFile({ url: OWN_URL, auth }), env)
      const result = await cli(EDITOR_COMMAND)
      expect(errorOf(result.stderr), auth.type).toMatchObject({ code: "CONFIG" })
      expect(sent()).toEqual([])
      expect(runtime.browserUrls).toEqual([])
    }
  })

  it("goes on when your profile names the project file's origin, and sends its headers there", async () => {
    const { cli, engine } = inRepository(userFile({ url: PROJECT_URL, headers: SECRETS }))
    expect(await cli(EDITOR_COMMAND)).toMatchObject({ code: 0, stderr: "" })
    expect(engine.stage).toBe("book")
    expect(engine.requests.length).toBeGreaterThan(0)
    for (const { url, headers } of engine.requests) {
      expect(url.startsWith(`${PROJECT_URL}/`)).toBe(true)
      expect(headers).toMatchObject({
        authorization: SECRETS.Authorization,
        "x-api-key": "user-key",
      })
      // your profile replaces the project file's as a whole
      expect(headers).not.toHaveProperty("x-team")
    }
  })

  it("goes on for a profile of the project file alone, with the project file's header", async () => {
    const { cli, engine } = inRepository({})
    expect(await cli(EDITOR_COMMAND)).toMatchObject({ code: 0, stderr: "" })
    expect(engine.stage).toBe("book")
    expect(engine.requests.every(({ headers }) => headers["x-team"] === "orders")).toBe(true)
  })

  it("goes on for an OAuth login of a project file's profile at another origin", async () => {
    const sso = { url: PROJECT_URL, auth: { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" } }
    const project = { [`${REPO}/.pulse.json`]: JSON.stringify({ profiles: { orders: sso } }) }
    const selected = { PULSE_CLI_AUTH: "oauth", PULSE_CLI_OAUTH_ISSUER: ISSUER }
    const runs = [
      [project, {}],
      [{}, { ...selected, PULSE_CLI_OAUTH_CLIENT_ID: "pulse-cli" }],
    ] as const
    for (const [files, env] of runs) {
      const { cli, sent } = inRepository(files, env)
      const result = await cli([...ADVANCE, "--profile", "orders", "--url", OWN_URL])
      // past the rule: the login the project file's profile would send is looked up, and missing
      expect(errorOf(result.stderr)).toMatchObject({ code: "LOGIN_REQUIRED" })
      expect(sent()).toEqual([])
    }
  })

  it("goes on beside PULSE_CLI_URL, which replaces your profile's URL per value", async () => {
    const env = { PULSE_CLI_URL: PROJECT_URL }
    const { cli, engine } = inRepository(userFile({ url: OWN_URL, headers: SECRETS }), env)
    expect(await cli([...ADVANCE, "--profile", "orders"])).toMatchObject({ code: 0 })
    expect(engine.requests.every(({ headers }) => headers["x-api-key"] === "user-key")).toBe(true)
    expect(engine.requests.every(({ url }) => url.startsWith(`${PROJECT_URL}/`))).toBe(true)
  })
})

describe("the auth commands with --profile beside a --url of another origin", () => {
  it("fail before any login lookup, and logout removes nothing", async () => {
    const sso = { url: OWN_URL, auth: { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" } }
    const login = cacheText(cachedLogin(T0))
    const files = { ...userFile(sso), [TOKEN_FILE]: login }
    for (const command of ["login", "status", "logout"]) {
      const { cli, sent, runtime, tokensRead } = inRepository(files)
      const result = await cli(["auth", command, "--profile", "orders", "--url", PROJECT_URL])
      expect(result.code, command).toBe(3)
      expect(errorOf(result.stderr)).toMatchObject({
        code: "CONFIG",
        message: expect.stringMatching(
          /^Profile "orders" of your config file holds credentials \(an OAuth login\) for http:\/\/127\.0\.0\.1:8941;/,
        ) as string,
      })
      expect(sent()).toEqual([])
      expect(tokensRead()).toBe(0)
      expect(runtime.locks).toEqual([])
      expect(runtime.browserUrls).toEqual([])
      expect(fileText(runtime, TOKEN_FILE)).toBe(login)
    }
    // the same command without --url reads the login, so the checks above are not vacuous
    const { cli, tokensRead } = inRepository(files)
    expect(await cli(["auth", "status", "--profile", "orders"])).toMatchObject({ code: 0 })
    expect(tokensRead()).toBeGreaterThan(0)
  })
})
