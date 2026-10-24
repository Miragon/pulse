/**
 * Shared OAuth logins end to end through `run()`: one `auth login` serves every
 * profile of the same config file or repository with the same stored OAuth settings, in every
 * worktree of the repository; a login never serves a profile of another origin, also not one of
 * the same name in another repository's project file.
 */

import { describe, expect, it } from "vitest"
import { type FakeServer, fakeServer, json } from "../../test/support/fake-fetch.js"
import { fakeIdp, ISSUER, routeFetch } from "../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime } from "../../test/support/fake-runtime.js"
import { loginFile, loginKey, TOKEN_DIR } from "../../test/support/oauth.js"
import { run } from "./run.js"

const T0 = 1_700_000_000_000
const SHOP = "/home/tester/shop"
const SHOP_LOGIN = loginFile(loginKey({ origin: `repository:${SHOP}/.git` }))
const OWN_LOGIN = loginFile()
const WORKTREE = "/home/tester/agents/one"
const AUTH = { type: "oauth", issuer: ISSUER, clientId: "operate-cli" }

/** A project file with an OAuth profile per name, each on its own port. */
function project(names: readonly string[]): string {
  const profiles = names.map((name, index) => [
    name,
    { url: `http://localhost:${String(8112 + index)}/engine-rest`, auth: AUTH },
  ])
  return JSON.stringify({ defaultProfile: names[0], profiles: Object.fromEntries(profiles) })
}

function errorOf(stderr: string): Record<string, unknown> {
  const line = stderr.trim().split("\n").at(-1) ?? ""
  return (JSON.parse(line) as { error: Record<string, unknown> }).error
}

/**
 * One machine: its files persist between commands, each command runs in a working directory of
 * its own; the fake identity provider and an engine per origin answer.
 */
function machine(files: Record<string, string>, dirs: readonly string[] = []) {
  const idp = fakeIdp()
  const engines = new Map<string, FakeServer>()
  const engine = (url: string) => {
    const origin = new URL(url).origin
    const server =
      engines.get(origin) ??
      fakeServer(`${origin}/engine-rest`)
        .on("GET", "/process-definition/count", json({ count: 1 }))
        .on("GET", "/version", json({ version: "7.24.0" }))
        .on("GET", "/engine", json([{ name: "default" }]))
    engines.set(origin, server)
    return server
  }
  const fetch = routeFetch(idp, (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    return engine(url).fetch(input, init)
  })
  let state: Record<string, string | Uint8Array> = { ...files }
  const cli = async (cwd: string, args: readonly string[]) => {
    const runtime = fakeRuntime({
      fetch,
      now: () => T0,
      cwd,
      dirs: [...dirs],
      files: state,
      browser: async (url, self) => {
        await self.loopback.request("/callback", idp.authorize(url))
        return true
      },
    })
    const result = await execute(run, args, runtime)
    state = Object.fromEntries([...runtime.files].map(([path, file]) => [path, file.data]))
    return result
  }
  const tokenFiles = () => Object.keys(state).filter((path) => path.startsWith(`${TOKEN_DIR}/`))
  return { cli, idp, engine, tokenFiles, has: (path: string) => path in state }
}

describe("a login shared by the profiles of a repository", () => {
  it("serves every profile with the same settings, and the engine of each gets its token", async () => {
    const { cli, engine, idp, tokenFiles } = machine(
      { [`${SHOP}/.operate.json`]: project(["orders", "billing", "invoices"]) },
      [`${SHOP}/.git`],
    )
    const login = await cli(`${SHOP}/services`, ["auth", "login", "--profile", "orders"])
    expect(login.code).toBe(0)
    expect(login.stderr).toContain(
      "The login also serves 2 other profiles with the same issuer, client, audience and scopes:\n  billing   http://localhost:8113/engine-rest\n  invoices  http://localhost:8114/engine-rest\n",
    )
    expect(tokenFiles()).toEqual([SHOP_LOGIN])
    const count = await cli(SHOP, ["process-definition", "count", "--profile", "billing"])
    expect(count.code).toBe(0)
    const [request] = engine("http://localhost:8113").requests
    expect(request?.headers.authorization).toBe(`Bearer ${idp.accessTokens[0] ?? ""}`)
  })

  it("is shared by every worktree that links back to the repository", async () => {
    const files = {
      [`${SHOP}/.operate.json`]: project(["orders"]),
      [`${WORKTREE}/.operate.json`]: project(["orders"]),
      [`${WORKTREE}/.git`]: `gitdir: ${SHOP}/.git/worktrees/one\n`,
      [`${SHOP}/.git/worktrees/one/gitdir`]: `${WORKTREE}/.git\n`,
    }
    const { cli } = machine(files, [`${SHOP}/.git`])
    expect((await cli(SHOP, ["auth", "login"])).code).toBe(0)
    const status = await cli(`${WORKTREE}/src`, ["auth", "status"])
    expect(status.code).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({ profile: "orders", tokenCache: SHOP_LOGIN })
  })

  it("says on config set whether a new profile shares a login or needs one", async () => {
    const { cli } = machine({ [`${SHOP}/.operate.json`]: project(["orders", "billing"]) }, [
      `${SHOP}/.git`,
    ])
    const options = ["--auth", "oauth", "--oauth-issuer", ISSUER, "--oauth-client-id"]
    const before = await cli(SHOP, [
      "config",
      "set",
      "invoices",
      "--project",
      ...options,
      "operate-cli",
    ])
    expect(before.stderr).toBe(
      "Next: run `operate auth login --profile invoices` in a terminal to log in.\n",
    )
    expect((await cli(SHOP, ["auth", "login"])).code).toBe(0)
    const after = await cli(SHOP, [
      "config",
      "set",
      "shipping",
      "--project",
      ...options,
      "operate-cli",
    ])
    expect(after.stderr).toBe(
      'Notice: the profile uses the OAuth login of profiles "orders", "billing" and "invoices": same issuer, client, audience and scopes.\n',
    )
    const url = await cli(SHOP, [
      "config",
      "set",
      "orders",
      "--project",
      "--url",
      "http://x/engine-rest",
    ])
    expect(url.stderr).toBe(
      'Notice: the profile uses the OAuth login of profiles "billing", "invoices" and "shipping": same issuer, client, audience and scopes.\n',
    )
    const other = await cli(SHOP, ["config", "set", "audit", "--project", ...options, "audit-cli"])
    expect(other.stderr).toBe(
      "Next: run `operate auth login --profile audit` in a terminal to log in.\n",
    )
  })

  it("keeps the login when a profile changes its settings while another of the file uses it", async () => {
    // your config file: one origin, so the last profile that changes takes the login with it
    const { cli, has } = machine({ [CONFIG_PATH]: project(["orders", "billing"]) })
    expect((await cli("/home/tester", ["auth", "login"])).code).toBe(0)
    const audience = ["--oauth-audience", "engine-rest"]
    const billing = await cli("/home/tester", ["config", "set", "billing", ...audience])
    expect(billing.stderr).toBe(
      "Next: run `operate auth login --profile billing` in a terminal to log in.\n",
    )
    expect(has(OWN_LOGIN)).toBe(true)
    const orders = await cli("/home/tester", ["config", "set", "orders", ...audience])
    expect(orders.stderr).toBe(
      `Removed the OAuth login of profile "orders" for its previous settings (${OWN_LOGIN}); it was not revoked.\nNext: run \`operate auth login --profile orders\` in a terminal to log in.\n`,
    )
    expect(has(OWN_LOGIN)).toBe(false)
  })

  it("keeps the login of a repository on edits: another worktree may still use it", async () => {
    const files = {
      [`${SHOP}/.operate.json`]: project(["orders"]),
      [`${WORKTREE}/.operate.json`]: project(["orders"]),
      [`${WORKTREE}/.git`]: `gitdir: ${SHOP}/.git/worktrees/one\n`,
      [`${SHOP}/.git/worktrees/one/gitdir`]: `${WORKTREE}/.git\n`,
    }
    const { cli } = machine(files, [`${SHOP}/.git`])
    expect((await cli(SHOP, ["auth", "login"])).code).toBe(0)
    const args = ["config", "set", "orders", "--project", "--oauth-audience", "engine-rest"]
    const edit = await cli(WORKTREE, args)
    expect(edit.stderr).toBe(
      `Notice: kept the OAuth login of profile "orders" for its previous settings (${SHOP_LOGIN}): other worktrees and project files of the repository may still use it. It was not revoked; delete the file once none does.\nNext: run \`operate auth login --profile orders\` in a terminal to log in.\n`,
    )
    expect((await cli(SHOP, ["auth", "status"])).code).toBe(0)
  })

  it("names a config file of --config in the command to log in", async () => {
    const { cli } = machine({})
    const args = ["config", "set", "p", "--config", "/home/tester/ci/operate.json"]
    const oauth = ["--auth", "oauth", "--oauth-issuer", ISSUER, "--oauth-client-id", "operate-cli"]
    const set = await cli("/home/tester", [...args, ...oauth])
    expect(set.stderr).toBe(
      "Next: run `operate auth login --config /home/tester/ci/operate.json --profile p` in a terminal to log in.\n",
    )
    const status = await cli("/home/tester", [
      "auth",
      "status",
      "--config",
      "/home/tester/ci/operate.json",
      "--profile",
      "p",
    ])
    expect(errorOf(status.stderr).hint).toContain(
      "Run `operate auth login --config /home/tester/ci/operate.json --profile p` in a terminal:",
    )
  })
})

describe("a login never crosses origins", () => {
  const OTHER = "/home/tester/download"
  /** Another repository's project file: a profile of the same name, issuer and client. */
  const COLLECTOR = JSON.stringify({
    defaultProfile: "orders",
    profiles: { orders: { url: "https://collector.example/engine-rest", auth: AUTH } },
  })

  it("never sends one repository's login to the URL of another's profile of the same name", async () => {
    const { cli, engine, has } = machine(
      { [`${SHOP}/.operate.json`]: project(["orders"]), [`${OTHER}/.operate.json`]: COLLECTOR },
      [`${SHOP}/.git`, `${OTHER}/.git`],
    )
    expect((await cli(SHOP, ["auth", "login"])).code).toBe(0)
    for (const args of [["status"], ["process-definition", "count"]]) {
      const result = await cli(OTHER, args)
      expect(result.code, args.join(" ")).toBe(4)
      expect(errorOf(result.stderr)).toMatchObject({
        code: "LOGIN_REQUIRED",
        message: 'Not logged in: profile "orders" has no OAuth login',
      })
      expect(errorOf(result.stderr).hint).toContain(
        `Run \`operate auth login --profile orders\` in a terminal in ${OTHER}:`,
      )
    }
    expect(engine("https://collector.example").requests).toEqual([])
    // nor do logout and config delete there touch it
    const logout = await cli(OTHER, ["auth", "logout"])
    expect(JSON.parse(logout.stdout)).toMatchObject({ removed: false })
    expect((await cli(OTHER, ["config", "delete", "orders", "--project"])).code).toBe(0)
    expect(has(SHOP_LOGIN)).toBe(true)
    expect((await cli(SHOP, ["auth", "status"])).code).toBe(0)
  })

  it("never lets a copied .git file claim the repository of the login", async () => {
    const { cli } = machine(
      {
        [`${SHOP}/.operate.json`]: project(["orders"]),
        [`${WORKTREE}/.git`]: `gitdir: ${SHOP}/.git/worktrees/one\n`,
        [`${SHOP}/.git/worktrees/one/gitdir`]: `${WORKTREE}/.git\n`,
        [`${OTHER}/.operate.json`]: COLLECTOR,
        [`${OTHER}/.git`]: `gitdir: ${SHOP}/.git/worktrees/one\n`,
      },
      [`${SHOP}/.git`],
    )
    expect((await cli(SHOP, ["auth", "login"])).code).toBe(0)
    expect((await cli(OTHER, ["status"])).code).toBe(4)
  })

  it("keeps the logins of your config file, a --config file and a project's profile apart", async () => {
    const own = JSON.stringify({ defaultProfile: "orders", profiles: { orders: { auth: AUTH } } })
    const { cli, tokenFiles } = machine(
      {
        [CONFIG_PATH]: own,
        "/home/tester/ci/operate.json": own,
        [`${OTHER}/.operate.json`]: COLLECTOR,
      },
      [`${OTHER}/.git`],
    )
    expect((await cli("/home/tester", ["auth", "login"])).code).toBe(0)
    expect(tokenFiles()).toEqual([loginFile()])
    const named = await cli("/home/tester/ci", [
      "status",
      "--config",
      "/home/tester/ci/operate.json",
    ])
    expect(errorOf(named.stderr)).toMatchObject({ code: "LOGIN_REQUIRED" })
    // in the repository the profile of your config file wins and keeps its login
    expect((await cli(OTHER, ["auth", "status"])).code).toBe(0)
    expect((await cli(OTHER, ["auth", "status", "--config", CONFIG_PATH])).code).toBe(0)
  })

  it("gives a project file outside a repository a login of its own", async () => {
    const { cli, tokenFiles } = machine({
      "/srv/a/.operate.json": project(["orders"]),
      "/srv/b/.operate.json": project(["orders"]),
    })
    expect((await cli("/srv/a", ["auth", "login"])).code).toBe(0)
    expect(tokenFiles()).toEqual([loginFile(loginKey({ origin: "project:/srv/a/.operate.json" }))])
    expect((await cli("/srv/b", ["auth", "status"])).code).toBe(4)
  })
})
