import { join } from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { LOCAL_TARGET } from "../../src/host/connections/engine-target.js"
import { TargetDiscovery } from "../../src/host/connections/target-discovery.js"
import { TargetsFile } from "../../src/host/connections/targets-file.js"
import { TargetsProblem } from "../../src/host/connections/targets-problem.js"
import type { UserConfigLocation } from "../../src/host/connections/user-config-file.js"
import { WritePolicy } from "../../src/host/connections/write-policy.js"

const fake = vi.hoisted(() => ({
  files: new Map<string, string>(),
  unreadable: new Set<string>(),
}))

vi.mock("vscode", () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, name: string) => ({ fsPath: `${base.fsPath}/${name}` }),
  },
  workspace: {
    findFiles: () =>
      Promise.resolve(
        [...fake.files.keys()]
          .filter((fsPath) => fsPath.endsWith(TargetsFile.NAME))
          .map((fsPath) => ({ fsPath })),
      ),
    fs: {
      readFile: (uri: { fsPath: string }) => {
        const content = fake.files.get(uri.fsPath)
        if (fake.unreadable.has(uri.fsPath)) {
          return Promise.reject(Object.assign(new Error("denied"), { code: "NoPermissions" }))
        }
        return content === undefined
          ? Promise.reject(Object.assign(new Error("missing"), { code: "FileNotFound" }))
          : Promise.resolve(new TextEncoder().encode(content))
      },
    },
  },
}))

const CURRENT_A = join("/work/a", TargetsFile.NAME)
const CURRENT_B = join("/work/b", TargetsFile.NAME)
const OWN = "/home/dev/.config/pulse-cli/config.json"
const USER: UserConfigLocation = { path: OWN, explicit: false }
const NAMED: UserConfigLocation = { path: OWN, explicit: true }

function profiles(entries: Record<string, unknown>): string {
  return JSON.stringify({
    profiles: Object.fromEntries(
      Object.entries(entries).map(([name, profile]) => [
        name,
        typeof profile === "string" ? { url: profile } : profile,
      ]),
    ),
  })
}

async function discovered(user: UserConfigLocation = USER) {
  const { targets, problems } = await TargetDiscovery.discover(user)
  return {
    targets: targets.map((target) => [target.name, target.endpoint]),
    problems: problems.map((problem) => [problem.path, problem.message, problem.severity]),
  }
}

beforeEach(() => {
  fake.files.clear()
  fake.unreadable.clear()
})

describe("the project files Pulse reads", () => {
  test("are the pulse-cli project files", () => {
    expect(TargetsFile.GLOB).toBe(`**/${TargetsFile.NAME}`)
  })

  test("writes a new one under the pulse-cli name", () => {
    expect(TargetsFile.in({ fsPath: "/work" } as never)).toEqual({
      fsPath: `/work/${TargetsFile.NAME}`,
    })
  })

  test("let the first project file win a profile name", async () => {
    fake.files.set(CURRENT_A, profiles({ shared: "http://a:8080/engine-rest" }))
    fake.files.set(
      CURRENT_B,
      profiles({ shared: "http://b:8080/engine-rest", b: "http://b:8080/engine-rest" }),
    )

    expect(await discovered()).toEqual({
      targets: [
        ["shared", "http://a:8080/engine-rest"],
        ["b", "http://b:8080/engine-rest"],
      ],
      problems: [],
    })
  })

  test("falls back to the local engine without any file", async () => {
    expect(await TargetDiscovery.discover(USER)).toEqual({ targets: [LOCAL_TARGET], problems: [] })
  })

  test("leave out the local engine once a file names a profile, even a broken one", async () => {
    fake.files.set(CURRENT_A, profiles({ broken: { url: 1 } }))

    const { targets, problems } = await discovered()

    expect(targets).toEqual([])
    expect(problems).toHaveLength(1)
  })

  test("names the file a read-only profile comes from", () => {
    const fromFile = {
      ...LOCAL_TARGET,
      readOnly: true,
      source: { kind: "file", path: CURRENT_A },
    } as const
    expect(WritePolicy.access(fromFile, "enabled", { kind: "none" }).note).toBe(
      `Read-only. local is a read-only profile in ${TargetsFile.NAME}.`,
    )
    expect(
      WritePolicy.access({ ...fromFile, source: { kind: "file", path: OWN } }, "enabled", {
        kind: "none",
      }).note,
    ).toBe("Read-only. local is a read-only profile in your CLI config.")
  })

  test("keeps a broken file an error", () => {
    expect(new TargetsProblem(CURRENT_A, "the file is not valid JSON").severity).toBeUndefined()
  })
})

describe("the CLI's user config", () => {
  test("lists its profiles without any project file", async () => {
    fake.files.set(OWN, profiles({ saas: "https://saas.example.com/engine-rest" }))

    const { targets } = await TargetDiscovery.discover(USER)

    expect(targets).toEqual([
      {
        name: "saas",
        engine: "c7",
        endpoint: "https://saas.example.com/engine-rest",
        auth: { kind: "none" },
        source: { kind: "file", path: OWN },
      },
    ])
  })

  test("joins the project files, after their profiles, and wins a name clash as a whole", async () => {
    fake.files.set(
      CURRENT_A,
      profiles({
        dev: { url: "http://dev:8080/engine-rest", readOnly: true, cockpitUrl: "http://dev/c/" },
        team: "http://team:8080/engine-rest",
      }),
    )
    fake.files.set(
      OWN,
      profiles({ mine: "http://mine:8080/engine-rest", dev: "http://localhost:8080/engine-rest" }),
    )

    const { targets } = await TargetDiscovery.discover(USER)

    expect(targets.map((target) => target.name)).toEqual(["dev", "team", "mine"])
    expect(targets[0]).toEqual({
      name: "dev",
      engine: "c7",
      endpoint: "http://localhost:8080/engine-rest",
      auth: { kind: "none" },
      source: { kind: "file", path: OWN },
    })
  })

  test("hides the project's profile behind a broken one of the same name", async () => {
    fake.files.set(CURRENT_A, profiles({ dev: "http://dev:8080/engine-rest" }))
    fake.files.set(OWN, profiles({ dev: { url: "ftp://dev" } }))

    expect(await discovered()).toEqual({
      targets: [],
      problems: [
        [
          OWN,
          'profile "dev" needs a url that is an http or https URL without credentials, query or fragment',
          undefined,
        ],
      ],
    })
  })

  test("reads no credential from the file", async () => {
    fake.files.set(
      OWN,
      profiles({
        dev: {
          url: "https://dev.example.com/engine-rest",
          auth: { type: "basic", username: "demo", password: "demo", passwordEnv: "DEV_PASSWORD" },
        },
      }),
    )

    const { targets } = await TargetDiscovery.discover(USER)

    expect(targets[0]?.auth).toEqual({ kind: "basic" })
    expect(JSON.stringify(targets)).not.toContain("demo")
  })

  test("is no problem while it does not exist, but one when it cannot be read", async () => {
    expect((await discovered()).problems).toEqual([])

    fake.files.set(OWN, "{}")
    fake.unreadable.add(OWN)

    expect((await discovered()).problems).toEqual([[OWN, "the file can't be read", undefined]])
  })

  test("named by PULSE_CLI_CONFIG, is the only file Pulse reads, like the CLI", async () => {
    fake.files.set(CURRENT_A, profiles({ team: "http://team:8080/engine-rest" }))
    fake.files.set(OWN, profiles({ ci: "http://ci:8080/engine-rest" }))

    expect(await discovered(NAMED)).toEqual({
      targets: [["ci", "http://ci:8080/engine-rest"]],
      problems: [
        [
          OWN,
          `PULSE_CLI_CONFIG names this file, so Pulse reads no ${TargetsFile.NAME}, like the CLI`,
          "warning",
        ],
      ],
    })
  })

  test("named by PULSE_CLI_CONFIG, must exist", async () => {
    expect(await discovered(NAMED)).toEqual({
      targets: [["local", LOCAL_TARGET.endpoint]],
      problems: [
        [
          OWN,
          "PULSE_CLI_CONFIG names this file, which does not exist: create it or change the variable",
          undefined,
        ],
      ],
    })
  })

  test("labels its problems apart from a project file's", () => {
    expect(new TargetsProblem(OWN, "the file is not valid JSON").label()).toBe(
      "CLI config: the file is not valid JSON",
    )
    expect(new TargetsProblem(CURRENT_A, "the file is not valid JSON").label()).toBe(
      `${TargetsFile.NAME}: the file is not valid JSON`,
    )
  })
})
