import { VSCODE_WRITES_WORDING } from "../../src/host/connections/writes-wording.js"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  LOCAL_TARGET,
  TargetMerge,
  TargetsProblem,
  UserConfigLocation,
  WritePolicy,
} from "@miragon/pulse-runtime-view/host-kit"
import { TargetDiscovery } from "../../src/host/connections/target-discovery.js"
import { TargetsFile } from "../../src/host/connections/targets-file.js"
import { UserConfigFile } from "../../src/host/connections/user-config-file.js"

const fake = vi.hoisted(() => ({
  files: new Map<string, string>(),
  unreadable: new Set<string>(),
  fsPathOf: (path: string) => path,
}))

vi.mock("vscode", () => ({
  Uri: {
    file: (path: string) => ({ fsPath: fake.fsPathOf(path) }),
    joinPath: (base: { fsPath: string }, name: string) => ({ fsPath: `${base.fsPath}/${name}` }),
  },
  workspace: {
    findFiles: () =>
      Promise.resolve(
        [...fake.files.keys()]
          .filter((fsPath) => fsPath.startsWith("/work/"))
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

const OWN = "/home/dev/.config/pulse-cli/config.json"
const NAMED = "/ci/pulse.json"
const USER = new UserConfigLocation({}, "/home/dev", "linux")
const CURRENT_A = join("/work/a", TargetsFile.NAME)
const CURRENT_B = join("/work/b", TargetsFile.NAME)
const FORMER_B = join("/work/b", ".pulse-cli.json")

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

async function discovered(location: UserConfigLocation = USER) {
  const { targets, problems } = await TargetDiscovery.discover(location)
  return {
    targets: targets.map((target) => [target.name, target.endpoint, target.source.kind]),
    problems: problems.map((problem) => [problem.label(), problem.severity]),
  }
}

beforeEach(() => {
  fake.files.clear()
  fake.unreadable.clear()
  fake.fsPathOf = (path) => path
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("the project files Pulse reads", () => {
  test("are the project files, found under their current and their former name", () => {
    expect(TargetsFile.GLOB).toBe("**/{.pulse.json,.pulse-cli.json}")
  })

  test("writes a new one under the current name", () => {
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

    const { targets, problems } = await TargetDiscovery.discover(USER)

    expect(targets.map((target) => [target.name, target.endpoint])).toEqual([
      ["shared", "http://a:8080/engine-rest"],
      ["b", "http://b:8080/engine-rest"],
    ])
    expect(problems).toEqual([])
  })

  test("show a folder with the file under its former name only as a problem, never its engines nor the local default", async () => {
    fake.files.set(FORMER_B, profiles({ old: "http://old:8080/engine-rest" }))

    const { targets, problems } = await TargetDiscovery.discover(USER)

    expect(targets).toEqual([])
    expect(problems).toEqual([new TargetsProblem(FORMER_B, TargetsFile.RENAME)])
    expect(problems[0]?.severity).toBeUndefined()
    expect(problems[0]?.label()).toBe(
      ".pulse-cli.json: Pulse reads .pulse.json now. Rename this file to .pulse.json; its content stays.",
    )
  })

  test("leave the former name alone in a folder that has the current one", async () => {
    fake.files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    fake.files.set(join("/work/a", ".pulse-cli.json"), "not JSON")

    const { targets, problems } = await TargetDiscovery.discover(USER)

    expect(targets.map((target) => target.name)).toEqual(["a"])
    expect(problems).toEqual([])
  })

  test("list the engines of another folder next to a folder with the former name only", async () => {
    fake.files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    fake.files.set(FORMER_B, profiles({ old: "http://old:8080/engine-rest" }))

    const { targets, problems } = await TargetDiscovery.discover(USER)

    expect(targets.map((target) => target.name)).toEqual(["a"])
    expect(problems).toEqual([new TargetsProblem(FORMER_B, TargetsFile.RENAME)])
  })

  test("name a project file it cannot read once and take no local engine in its place", async () => {
    fake.files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    fake.unreadable.add(CURRENT_A)

    const { targets, problems } = await TargetDiscovery.discover(USER)

    expect(targets).toEqual([])
    expect(problems.map((problem) => problem.label())).toEqual([
      ".pulse.json: Pulse can't read this file",
    ])
  })

  test("list the engines of a readable project file next to one it cannot read", async () => {
    fake.files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    fake.files.set(CURRENT_B, profiles({ b: "http://b:8080/engine-rest" }))
    fake.unreadable.add(CURRENT_A)

    const { targets, problems } = await TargetDiscovery.discover(USER)

    expect(targets.map((target) => target.name)).toEqual(["b"])
    expect(problems).toEqual([new TargetsProblem(CURRENT_A, "Pulse can't read this file")])
  })

  test("name a project file it cannot read before a folder with the former name only", async () => {
    fake.files.set(FORMER_B, profiles({ old: "http://old:8080/engine-rest" }))
    fake.files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    fake.unreadable.add(CURRENT_A)

    const { targets, problems } = await TargetDiscovery.discover(USER)

    expect(targets).toEqual([])
    expect(problems).toEqual([
      new TargetsProblem(CURRENT_A, "Pulse can't read this file"),
      new TargetsProblem(FORMER_B, TargetsFile.RENAME),
    ])
  })

  test("falls back to the local engine without any project file", async () => {
    expect(await TargetDiscovery.discover(USER)).toEqual({ targets: [LOCAL_TARGET], problems: [] })
  })

  test("names the file a read-only profile comes from", () => {
    const fromFile = {
      ...LOCAL_TARGET,
      readOnly: true,
      source: { kind: "file", path: CURRENT_A },
    } as const
    expect(
      WritePolicy.access(fromFile, "enabled", { kind: "none" }, VSCODE_WRITES_WORDING).note,
    ).toBe(`Read-only. local is a read-only profile in ${TargetsFile.NAME}.`)
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
        source: { kind: "user-config", path: OWN },
      },
    ])
  })

  test("joins the project files after their profiles and wins a name clash as a whole", async () => {
    fake.files.set(
      CURRENT_A,
      profiles({
        dev: { url: "http://dev:8080/engine-rest", readOnly: true },
        team: "http://team:8080/engine-rest",
      }),
    )
    fake.files.set(
      OWN,
      profiles({ mine: "http://mine:8080/engine-rest", dev: "http://localhost:8080/engine-rest" }),
    )

    expect((await discovered()).targets).toEqual([
      ["dev", "http://localhost:8080/engine-rest", "user-config"],
      ["team", "http://team:8080/engine-rest", "file"],
      ["mine", "http://mine:8080/engine-rest", "user-config"],
    ])
  })

  test("reads no credential from the file", async () => {
    fake.files.set(
      OWN,
      profiles({
        dev: {
          url: "https://dev.example.com/engine-rest",
          auth: { type: "basic", username: "demo", password: "S3cret" },
        },
      }),
    )

    const { targets } = await TargetDiscovery.discover(USER)

    expect(targets[0]?.auth).toEqual({ kind: "basic" })
    expect(JSON.stringify(targets)).not.toContain("S3cret")
  })

  test("is no problem while it does not exist, but one when it can't be read", async () => {
    expect(await discovered()).toEqual({
      targets: [["local", LOCAL_TARGET.endpoint, "default"]],
      problems: [],
    })

    fake.files.set(OWN, "{}")
    fake.unreadable.add(OWN)

    expect(await discovered()).toEqual({
      targets: [],
      problems: [["CLI config: Pulse can't read this file", undefined]],
    })
  })

  test("named by PULSE_CLI_CONFIG, is the only file Pulse reads, like the CLI", async () => {
    fake.files.set(CURRENT_A, profiles({ team: "http://team:8080/engine-rest" }))
    fake.files.set(NAMED, profiles({ ci: "http://ci:8080/engine-rest" }))

    expect(
      await discovered(new UserConfigLocation({ PULSE_CLI_CONFIG: NAMED }, "/home/dev", "linux")),
    ).toEqual({
      targets: [["ci", "http://ci:8080/engine-rest", "user-config"]],
      problems: [[`CLI config: ${TargetMerge.NAMED_ONLY}`, "warning"]],
    })
  })

  test("named by PULSE_CLI_CONFIG, must exist and be named by its full path", async () => {
    expect(
      await discovered(new UserConfigLocation({ PULSE_CLI_CONFIG: NAMED }, "/home/dev", "linux")),
    ).toEqual({ targets: [], problems: [[`CLI config: ${TargetMerge.NAMED_MISSING}`, undefined]] })
    expect(
      await discovered(
        new UserConfigLocation({ PULSE_CLI_CONFIG: "ci.json" }, "/home/dev", "linux"),
      ),
    ).toEqual({ targets: [], problems: [[`CLI config: ${TargetMerge.RELATIVE}`, undefined]] })
  })

  test("names the file by the path the CLI names it, whatever case VS Code gives its drive letter", async () => {
    fake.fsPathOf = (path) => path.replace(/^[A-Z]:/, (drive) => drive.toLowerCase())
    const named = "C:\\ci\\pulse.json"
    const windows = new UserConfigLocation({ PULSE_CLI_CONFIG: named }, "C:\\Users\\dev", "win32")

    const missing = await TargetDiscovery.discover(windows)
    fake.files.set("c:\\ci\\pulse.json", profiles({ ci: "http://ci:8080/engine-rest" }))
    const { targets } = await TargetDiscovery.discover(windows)

    expect(missing.problems.map((problem) => problem.path)).toEqual([named])
    expect(targets.map((target) => target.source)).toEqual([{ kind: "user-config", path: named }])
  })

  test("is found where the CLI finds it, by default from the extension host's environment", () => {
    vi.stubEnv("PULSE_CLI_CONFIG", NAMED)

    expect(UserConfigFile.location()).toMatchObject({ path: NAMED, explicit: true })
  })
})
