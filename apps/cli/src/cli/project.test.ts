/**
 * Project config files end to end through `run()`: the lookup from the working
 * directory, the merge with the user's config file, `config set|unset|use|delete --project`,
 * `config path|list|show`, the credentials and the foreign default a project file refuses, and the
 * files a command reads.
 */

import { describe, expect, it } from "vitest"
import { BASE_URL, fakeServer, json } from "../../test/support/fake-fetch.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../test/support/fake-runtime.js"
import { ISSUER } from "../../test/support/fake-idp.js"
import { loginFile, loginKey } from "../../test/support/oauth.js"
import { run } from "./run.js"

const REPO = "/home/tester/repo"
const PROJECT = `${REPO}/.pulse-cli.json`
/** The login of an OAuth profile of the user's config file and of one of the repository. */
const OWN_LOGIN = loginFile()
const REPO_LOGIN = loginFile(loginKey({ origin: `repository:${REPO}/.git` }))

function runtimeOf(options: FakeRuntimeOptions = {}): FakeRuntime {
  const server = fakeServer()
    .on("GET", "/version", json({ version: "7.24.0" }))
    .on("GET", "/engine", json([{ name: "default" }]))
    .on("GET", "/task", json([]))
  return fakeRuntime({
    fetch: server.fetch,
    cwd: `${REPO}/src`,
    dirs: [`${REPO}/.git`],
    ...options,
  })
}

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, runtimeOf(options))
}

/** Runs the commands on the same runtime; returns the last outcome. */
async function sequence(runtime: FakeRuntime, ...commands: (readonly string[])[]) {
  let last = await execute(run, [], runtime)
  for (const args of commands) {
    runtime.stdout.chunks.length = 0
    runtime.stderr.chunks.length = 0
    last = await execute(run, args, runtime)
  }
  return last
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

function json5(value: unknown): string {
  return JSON.stringify(value)
}

const PROJECT_FILE = json5({
  defaultProfile: "svc",
  profiles: {
    svc: { url: BASE_URL, readOnly: true },
    shared: { url: "http://project-shared/engine-rest" },
  },
})

const USER_FILE = json5({
  defaultProfile: "mine",
  profiles: {
    mine: { url: "http://mine/engine-rest" },
    shared: { url: "http://user-shared/engine-rest", engine: "e" },
  },
})

describe("the project file in commands", () => {
  it("uses the project's default profile, its URL and its read-only guard", async () => {
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE }
    const ping = await cli(["ping", "-o", "json"], { files })
    expect(ping.code).toBe(0)
    expect(JSON.parse(ping.stdout)).toMatchObject({ url: BASE_URL })
    const write = await cli(["task", "claim", "t1", "--user-id", "u"], { files })
    expect(write.code).toBe(2)
    expect(errorOf(write.stderr)).toMatchObject({ code: "READ_ONLY" })
    expect(errorOf(write.stderr).hint).toContain('profile "svc"')
  })

  it("lets the user's profile of the same name win, and --profile pick one", async () => {
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE }
    const show = await cli(["config", "show", "--profile", "shared"], { files })
    expect(JSON.parse(show.stdout)).toMatchObject({
      configFile: CONFIG_PATH,
      projectFile: PROJECT,
      profile: "shared",
      profileFile: CONFIG_PATH,
      values: { url: { value: "http://user-shared/engine-rest" }, engine: { value: "e" } },
    })
    const svc = await cli(["config", "show", "-o", "table"], { files })
    expect(svc.stdout).toMatch(
      new RegExp(
        `^Config file: ${CONFIG_PATH}\\nProject file: ${PROJECT}\\nProfile: svc \\(from the project file\\)\\n\\n`,
      ),
    )
    const mine = await cli(["config", "show", "-o", "table", "--profile", "mine"], { files })
    expect(mine.stdout).toContain("\nProfile: mine\n\n")
  })

  it("lists the profiles of both files with their scope", async () => {
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE }
    const list = await cli(["config", "list"], { files })
    expect(
      (JSON.parse(list.stdout) as { name: string; scope: string; default: boolean }[]).map(
        ({ name, scope, default: isDefault }) => [name, scope, isDefault],
      ),
    ).toEqual([
      ["mine", "user", false],
      ["shared", "user", false],
      ["svc", "project", true],
    ])
  })

  it("is left out with --config or PULSE_CLI_CONFIG", async () => {
    const files = { [PROJECT]: PROJECT_FILE, "/other.json": USER_FILE }
    const flag = await cli(["config", "show", "--config", "/other.json"], { files })
    expect(JSON.parse(flag.stdout)).toMatchObject({ projectFile: null, profile: "mine" })
    const env = await cli(["config", "list"], { files, env: { PULSE_CLI_CONFIG: "/other.json" } })
    expect(env.stdout).not.toContain("svc")
  })

  it("is not looked up in the home directory", async () => {
    const files = { "/home/tester/.pulse-cli.json": PROJECT_FILE }
    const show = await cli(["config", "show"], { files, cwd: "/home/tester" })
    expect(JSON.parse(show.stdout)).toMatchObject({ projectFile: null, profile: null })
  })

  it("is a CONFIG error when it stores a secret, also for best-effort readers", async () => {
    const files = {
      [PROJECT]: json5({ profiles: { p: { auth: { type: "bearer", token: "Tk9-secret" } } } }),
    }
    const result = await cli(["ping"], { files })
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr).message).toBe(
      `Invalid project file ${PROJECT}: profile "p" sets auth.token; a project file is shared and names no credentials, so it comes from PULSE_CLI_TOKEN or PULSE_CLI_TOKEN_COMMAND or a profile "p" of your own config file`,
    )
    expect(result.stderr).not.toContain("Tk9-secret")
    // the docs commands still work, with the default output format
    expect((await cli(["commands", "-o", "json"], { files })).code).toBe(0)
  })

  it("takes the output format of the project's profile for docs commands", async () => {
    const files = {
      [PROJECT]: json5({ defaultProfile: "p", profiles: { p: { output: "table" } } }),
    }
    expect((await cli(["config", "path"], { files })).stdout).toBe(`${CONFIG_PATH}\n`)
  })
})

describe("config path --project", () => {
  it("prints the project file in effect, else where config set --project creates it", async () => {
    const found = await cli(["config", "path", "--project"], { files: { [PROJECT]: "{}" } })
    expect(found.stdout).toBe(`{"path":"${PROJECT}"}\n`)
    const created = await cli(["config", "path", "--project", "-o", "table"])
    expect(created.stdout).toBe(`${PROJECT}\n`)
  })

  it("refuses the home directory and --config", async () => {
    const home = await cli(["config", "path", "--project"], { cwd: "/home/tester" })
    expect(home.code).toBe(3)
    expect(errorOf(home.stderr)).toMatchObject({
      message: "No project directory: /home/tester is your home directory",
    })
    const both = await cli(["config", "path", "--project", "--config", "/c.json"])
    expect(both.code).toBe(2)
    expect(errorOf(both.stderr).message).toBe("--project and --config exclude each other")
  })
})

describe("config set|unset|use|delete --project", () => {
  it("creates the project file at the repository root (0644) and edits it", async () => {
    const runtime = runtimeOf()
    const set = await sequence(runtime, [
      "config",
      "set",
      "svc",
      "--project",
      "--url",
      "http://localhost:8112/engine-rest/svc",
    ])
    expect(set.code).toBe(0)
    expect(set.stderr).toBe(
      `Created the project file ${PROJECT}; commit it to share its profiles.\n`,
    )
    expect(runtime.files.get(PROJECT)?.mode).toBe(0o644)
    expect(JSON.parse(fileText(runtime, PROJECT) ?? "")).toEqual({
      defaultProfile: "svc",
      profiles: { svc: { url: "http://localhost:8112/engine-rest/svc" } },
    })
    expect(runtime.files.has(CONFIG_PATH)).toBe(false)
    const edited = await sequence(
      runtime,
      ["config", "set", "b", "--project", "--url", "http://b/engine-rest"],
      ["config", "use", "b", "--project"],
      ["config", "unset", "svc", "url", "--project"],
      ["config", "delete", "svc", "--project"],
    )
    expect(edited).toMatchObject({ code: 0, stderr: `Deleted profile "svc" from ${PROJECT}\n` })
    expect(JSON.parse(fileText(runtime, PROJECT) ?? "")).toEqual({
      defaultProfile: "b",
      profiles: { b: { url: "http://b/engine-rest" } },
    })
  })

  it("refuses secrets before writing anything", async () => {
    const runtime = runtimeOf({ stdin: "Tk9-secret\n" })
    const token = await sequence(runtime, [
      "config",
      "set",
      "p",
      "--project",
      "--auth",
      "bearer",
      "--auth-token-stdin",
    ])
    expect(token.code).toBe(3)
    expect(errorOf(token.stderr).message).toBe(
      `The project file ${PROJECT} cannot be written: profile "p" sets auth.token; a project file is shared and names no credentials, so it comes from PULSE_CLI_TOKEN or PULSE_CLI_TOKEN_COMMAND or a profile "p" of your own config file`,
    )
    expect(errorOf(token.stderr).hint).toBe(
      "Credentials come from the environment (PULSE_CLI_TOKEN, PULSE_CLI_TOKEN_COMMAND, PULSE_CLI_PASSWORD, PULSE_CLI_OAUTH_CLIENT_SECRET) or from a profile of the same name in your own config file. Remove it from the project file, e.g. with `pulse-cli config unset <profile> auth --project` (`headers` for a secret header), and a committed secret from the history of your repository, too.",
    )
    const variable = await sequence(runtime, [
      "config",
      "set",
      "p",
      "--project",
      "--auth",
      "bearer",
      "--auth-token-env",
      "CI_TOKEN",
    ])
    expect(errorOf(variable.stderr).message).toContain('profile "p" sets auth.tokenEnv;')
    const header = await sequence(runtime, [
      "config",
      "set",
      "p",
      "--project",
      "-H",
      "X-Api-Key: k-1",
    ])
    expect(errorOf(header.stderr).message).toContain("stores the secret header X-Api-Key")
    expect(runtime.files.has(PROJECT)).toBe(false)
  })

  it("repairs a project file with a credential, which every other command refuses", async () => {
    const runtime = runtimeOf({
      files: {
        [PROJECT]: json5({
          defaultProfile: "p",
          profiles: { p: { url: BASE_URL, auth: { type: "bearer", tokenEnv: "GITHUB_TOKEN" } } },
        }),
      },
      env: { GITHUB_TOKEN: "ghp-secret" },
    })
    const refused = await sequence(runtime, ["task", "list"])
    expect(refused.code).toBe(3)
    expect(errorOf(refused.stderr).message).toContain('profile "p" sets auth.tokenEnv;')
    expect(errorOf(refused.stderr).hint).toContain(
      "pulse-cli config unset <profile> auth --project",
    )
    const unset = await sequence(runtime, ["config", "unset", "p", "tokenEnv", "--project"])
    expect(unset.code).toBe(0)
    expect(JSON.parse(fileText(runtime, PROJECT) ?? "")).toEqual({
      defaultProfile: "p",
      profiles: { p: { url: BASE_URL, auth: { type: "bearer" } } },
    })
  })

  it("points a user edit of a project profile to --project", async () => {
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE }
    for (const args of [
      ["config", "unset", "svc", "url"],
      ["config", "use", "svc"],
      ["config", "delete", "svc"],
    ]) {
      const result = await cli(args, { files })
      expect(result.code, args.join(" ")).toBe(3)
      expect(errorOf(result.stderr)).toMatchObject({
        message: `Profile "svc" is a profile of the project file ${PROJECT}, not of your config file`,
        hint: "Add --project to change the project file; `pulse-cli config set svc <options>` without it creates a profile of your own that overrides the project's.",
      })
    }
    // a profile in neither file keeps the usual error
    const missing = await cli(["config", "use", "nope"], { files })
    expect(errorOf(missing.stderr).message).toBe('Profile "nope" does not exist')
  })

  it("notes when the default of the project wins, or a profile of the user overrides one", async () => {
    const runtime = runtimeOf({ files: { [PROJECT]: PROJECT_FILE } })
    const mine = await sequence(runtime, ["config", "set", "mine", "--url", "http://mine/x"])
    expect(mine.code).toBe(0)
    expect(mine.stderr).toBe(
      `Notice: in this repository the defaultProfile of the project file ${PROJECT} ("svc") wins; use --profile, PULSE_CLI_PROFILE or \`pulse-cli config use <profile> --project\`.\n`,
    )
    const set = await sequence(runtime, ["config", "set", "shared", "--engine", "mine"])
    expect(set.stderr).toBe(
      `Notice: profile "shared" of your config file now overrides the profile of the same name in the project file ${PROJECT} as a whole: none of the project's settings of "shared" apply. Add --project to change the project's profile instead.\n`,
    )
    const again = await sequence(runtime, ["config", "set", "shared", "--timeout", "5"])
    expect(again.stderr).toBe("")
    // a profile of the user's named like the project's default takes the default away
    const svc = await sequence(runtime, ["config", "set", "svc", "--default", "--url", BASE_URL])
    expect(svc.stderr).not.toContain("wins")
  })

  it("never makes a profile of the user's the default of the repository", async () => {
    const files = {
      [PROJECT]: json5({ defaultProfile: "prod", profiles: { prod: { url: "http://evil/x" } } }),
      [CONFIG_PATH]: json5({
        defaultProfile: "mine",
        profiles: { mine: { url: BASE_URL }, prod: { url: "https://prod/x" } },
      }),
    }
    const show = await cli(["config", "show"], { files })
    expect(JSON.parse(show.stdout)).toMatchObject({ profile: "mine", profileFile: CONFIG_PATH })
    const foreign = { [PROJECT]: json5({ defaultProfile: "prod", profiles: {} }) }
    const refused = await cli(["task", "list"], { files: { ...files, ...foreign } })
    expect(refused.code).toBe(3)
    expect(errorOf(refused.stderr).message).toBe(
      `Invalid project file ${PROJECT}: defaultProfile "prod" is not one of its profiles; a project file chooses only among its own profiles`,
    )
    // the hint's repair works on the invalid file
    const runtime = runtimeOf({
      files: { [PROJECT]: json5({ defaultProfile: "prod", profiles: { svc: { url: BASE_URL } } }) },
    })
    const hint = errorOf((await sequence(runtime, ["config", "list"])).stderr).hint
    expect(hint).toContain("`pulse-cli config use <profile> --project`")
    expect((await sequence(runtime, ["config", "use", "svc", "--project"])).code).toBe(0)
    expect(JSON.parse(fileText(runtime, PROJECT) ?? "")).toMatchObject({ defaultProfile: "svc" })
    expect((await sequence(runtime, ["task", "list"])).code).toBe(0)
  })

  it("keeps the logins of a project profile and a profile of the same name of yours apart, and the repository login on delete", async () => {
    const auth = { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" }
    const files = {
      [PROJECT]: json5({
        profiles: { shared: { url: "http://project-shared/engine-rest", auth } },
      }),
      [CONFIG_PATH]: json5({
        profiles: { shared: { url: "http://user-shared/engine-rest", auth } },
      }),
      [OWN_LOGIN]: "{}",
      [REPO_LOGIN]: "{}",
    }
    const runtime = runtimeOf({ files })
    const project = await sequence(runtime, ["config", "delete", "shared", "--project"])
    expect(project.stderr).toBe(
      `Deleted profile "shared" from ${PROJECT}\nNotice: kept the OAuth login of profile "shared" (${REPO_LOGIN}): other worktrees and project files of the repository may still use it. It was not revoked; delete the file once none does.\n`,
    )
    expect(runtime.files.has(REPO_LOGIN)).toBe(true)
    expect(runtime.files.has(OWN_LOGIN)).toBe(true)
    const user = await sequence(runtime, ["config", "delete", "shared"])
    expect(user.stderr).toContain(`Removed the OAuth login of profile "shared" (${OWN_LOGIN})`)
    expect(runtime.files.has(OWN_LOGIN)).toBe(false)
  })
})
