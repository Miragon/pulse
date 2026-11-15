import { describe, expect, test, vi } from "vitest"
import { LOCAL_TARGET, type EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import type { FileVerdict, UserConfigVerdict } from "../../src/host-kit/connections/file-verdict.js"
import { ProjectFile } from "../../src/host-kit/connections/project-file.js"
import { TargetMerge } from "../../src/host-kit/connections/target-merge.js"
import { UserConfigLocation } from "../../src/host-kit/connections/user-config-location.js"
import { UserConfigRead } from "../../src/host-kit/connections/user-config-read.js"

const A = "/work/a/.pulse.json"
const B = "/work/b/.pulse.json"
const FORMER = "/work/c/.pulse-cli.json"
const LOCAL: EngineTarget = { ...LOCAL_TARGET, endpoint: "http://localhost:9090/engine-rest" }

function read(path: string, profiles: Record<string, unknown>): FileVerdict {
  return { kind: "read", path, text: JSON.stringify({ profiles }) }
}

function merged(files: readonly FileVerdict[]) {
  const { targets, problems } = new TargetMerge(LOCAL).merge(files)
  return {
    targets: targets.map((target) => [target.name, target.endpoint, target.source]),
    problems: problems.map((problem) => problem.label()),
  }
}

describe("the engines both editors take from their files", () => {
  test("keep the files in order and let the first file win a name", () => {
    expect(
      merged([
        read(A, { shared: { url: "http://a:8080/engine-rest" } }),
        read(B, {
          b: { url: "http://b:8080/engine-rest" },
          shared: { url: "http://b:8080/engine-rest" },
        }),
      ]),
    ).toEqual({
      targets: [
        ["shared", "http://a:8080/engine-rest", { kind: "file", path: A }],
        ["b", "http://b:8080/engine-rest", { kind: "file", path: B }],
      ],
      problems: [],
    })
  })

  test("are the local engine handed in when there is no file", () => {
    expect(new TargetMerge(LOCAL).merge([])).toEqual({ targets: [LOCAL], problems: [] })
  })

  test("are the local engine next to a file whose profiles are all refused", () => {
    expect(merged([read(A, { broken: { url: "ftp://dev" } })])).toEqual({
      targets: [["local", LOCAL.endpoint, { kind: "default" }]],
      problems: ['.pulse.json: profile "broken": url must start with http:// or https://.'],
    })
  })

  test("name a file Pulse cannot read once and take no local engine in its place", () => {
    expect(merged([{ kind: "unreadable", path: A }])).toEqual({
      targets: [],
      problems: [`.pulse.json: ${TargetMerge.UNREADABLE}`],
    })
  })

  test("name a file the host was told to read that is missing, and keep the local engine", () => {
    expect(merged([{ kind: "missing", path: A }])).toEqual({
      targets: [["local", LOCAL.endpoint, { kind: "default" }]],
      problems: [`.pulse.json: ${TargetMerge.MISSING}`],
    })
    expect(TargetMerge.MISSING).toBe(
      "A setting names this file, which does not exist. Create it, or change the setting.",
    )
  })

  test("ask to rename a file under its former name and take no local engine in its place", () => {
    expect(merged([{ kind: "former-name", path: FORMER }])).toEqual({
      targets: [],
      problems: [`.pulse-cli.json: ${ProjectFile.RENAME}`],
    })
  })

  test("list the engines of a readable file next to the problems of the others, in order", () => {
    expect(
      merged([
        { kind: "unreadable", path: B },
        read(A, { a: { url: "http://a:8080/engine-rest" } }),
        { kind: "former-name", path: FORMER },
      ]),
    ).toEqual({
      targets: [["a", "http://a:8080/engine-rest", { kind: "file", path: A }]],
      problems: [
        `.pulse.json: ${TargetMerge.UNREADABLE}`,
        `.pulse-cli.json: ${ProjectFile.RENAME}`,
      ],
    })
  })
})

const OWN = "/home/me/.config/pulse-cli/config.json"
const NAMED = "/ci/pulse.json"
const DEFAULT_PLACE = new UserConfigLocation({}, "/home/me", "linux")
const NAMED_PLACE = new UserConfigLocation({ PULSE_CLI_CONFIG: NAMED }, "/home/me", "linux")

function own(profiles: Record<string, unknown>, path = OWN): UserConfigVerdict {
  return { kind: "read", path, text: JSON.stringify({ profiles }) }
}

function userRead(location: UserConfigLocation, verdict: UserConfigVerdict) {
  return UserConfigRead.of(location, () => Promise.resolve(verdict))
}

async function withUser(
  files: readonly FileVerdict[],
  location: UserConfigLocation,
  verdict: UserConfigVerdict,
) {
  const user = await userRead(location, verdict)
  const { targets, problems } = new TargetMerge(LOCAL).merge(files, user)
  return {
    targets: targets.map((target) => [target.name, target.endpoint, target.source.kind]),
    problems: problems.map((problem) => [problem.label(), problem.severity]),
  }
}

describe("the read of the CLI's user config", () => {
  test("reads the file at its full path", async () => {
    const read = vi.fn(() => Promise.resolve(own({})))

    const user = await UserConfigRead.of(DEFAULT_PLACE, read)

    expect(read).toHaveBeenCalledWith(OWN)
    expect(user.location).toBe(DEFAULT_PLACE)
    expect(user.verdict()).toEqual(own({}))
  })

  test("reads nothing at a relative path and carries no verdict", async () => {
    const relative = new UserConfigLocation({ PULSE_CLI_CONFIG: "pulse.json" }, "/home/me", "linux")
    const read = vi.fn(() => Promise.resolve(own({})))

    const user = await UserConfigRead.of(relative, read)

    expect(read).not.toHaveBeenCalled()
    expect(user.verdict()).toBeUndefined()
  })
})

describe("the engines of the CLI's user config", () => {
  test("list its profiles without any project file, as profiles of the user config", async () => {
    const saas = own({ saas: { url: "https://saas.example.com/engine-rest" } })

    expect(await withUser([], DEFAULT_PLACE, saas)).toEqual({
      targets: [["saas", "https://saas.example.com/engine-rest", "user-config"]],
      problems: [],
    })
  })

  test("join after the project files, and a profile of the user wins a name whole, in its place", async () => {
    const files = [
      read(A, {
        dev: { url: "http://dev:8080/engine-rest", readOnly: true },
        team: { url: "http://team:8080/engine-rest" },
      }),
    ]
    const verdict = own({
      mine: { url: "http://mine:8080/engine-rest" },
      dev: { url: "http://localhost:8080/engine-rest" },
    })

    const { targets } = new TargetMerge(LOCAL).merge(files, await userRead(DEFAULT_PLACE, verdict))

    expect(targets.map((target) => [target.name, target.source.kind])).toEqual([
      ["dev", "user-config"],
      ["team", "file"],
      ["mine", "user-config"],
    ])
    expect(targets[0]?.readOnly).toBeUndefined()
  })

  test("hide a project's profile behind a refused one of the same name, and say why", async () => {
    const project = [read(A, { dev: { url: "http://dev:8080/engine-rest" } })]

    expect(await withUser(project, DEFAULT_PLACE, own({ dev: { url: "ftp://dev" } }))).toEqual({
      targets: [["local", LOCAL.endpoint, "default"]],
      problems: [
        ['CLI config: profile "dev": url must start with http:// or https://.', undefined],
      ],
    })
  })

  test("are no problem while the file does not exist", async () => {
    expect(await withUser([], DEFAULT_PLACE, { kind: "missing", path: OWN })).toEqual({
      targets: [["local", LOCAL.endpoint, "default"]],
      problems: [],
    })
  })

  test("name a file Pulse cannot read, say what to check and take no local engine in its place", async () => {
    expect(await withUser([], DEFAULT_PLACE, { kind: "unreadable", path: OWN })).toEqual({
      targets: [],
      problems: [[`CLI config: ${TargetMerge.UNREADABLE}`, undefined]],
    })
    expect(TargetMerge.UNREADABLE).toBe(
      "Pulse can't read this file. Check that the path names a file, not a folder, and that you have read access to it.",
    )
  })

  test("leave the project's engines alone when the file is no profile file", async () => {
    const project = [read(A, { a: { url: "http://a:8080/engine-rest" } })]

    expect(await withUser(project, DEFAULT_PLACE, { kind: "read", path: OWN, text: "{" })).toEqual({
      targets: [["a", "http://a:8080/engine-rest", "file"]],
      problems: [["CLI config: The text is not valid JSON (line 1, column 2).", undefined]],
    })
  })
})

describe("the file PULSE_CLI_CONFIG names", () => {
  const PROJECT = [read(A, { team: { url: "http://team:8080/engine-rest" } })]

  test("is the only file Pulse reads, like the CLI, and says so while it hides project files", async () => {
    const verdict = own({ ci: { url: "http://ci:8080/engine-rest" } }, NAMED)

    expect(await withUser(PROJECT, NAMED_PLACE, verdict)).toEqual({
      targets: [["ci", "http://ci:8080/engine-rest", "user-config"]],
      problems: [[`CLI config: ${TargetMerge.NAMED_ONLY}`, "warning"]],
    })
    expect((await withUser([], NAMED_PLACE, verdict)).problems).toEqual([])
    expect(TargetMerge.NAMED_ONLY).toBe(
      "PULSE_CLI_CONFIG names this file, so Pulse reads no .pulse.json, like the CLI.",
    )
  })

  test("must exist: a missing one is one problem, and no local engine takes its place", async () => {
    expect(await withUser(PROJECT, NAMED_PLACE, { kind: "missing", path: NAMED })).toEqual({
      targets: [],
      problems: [[`CLI config: ${TargetMerge.NAMED_MISSING}`, undefined]],
    })
  })

  test("that Pulse cannot read is one problem, and no local engine takes its place", async () => {
    expect(await withUser(PROJECT, NAMED_PLACE, { kind: "unreadable", path: NAMED })).toEqual({
      targets: [],
      problems: [[`CLI config: ${TargetMerge.UNREADABLE}`, undefined]],
    })
  })

  test("by a relative path is one problem and no engine, and nothing is read", async () => {
    const relative = new UserConfigLocation({ PULSE_CLI_CONFIG: "pulse.json" }, "/home/me", "linux")
    const read = vi.fn(() => Promise.resolve(own({ ci: { url: "http://ci" } })))

    const { targets, problems } = new TargetMerge(LOCAL).merge(
      PROJECT,
      await UserConfigRead.of(relative, read),
    )

    expect(read).not.toHaveBeenCalled()
    expect(targets).toEqual([])
    expect(problems.map((problem) => problem.label())).toEqual([
      `CLI config: ${TargetMerge.RELATIVE}`,
    ])
  })

  test("without a usable profile still leaves the local engine, as a project file does", async () => {
    expect((await withUser(PROJECT, NAMED_PLACE, own({}, NAMED))).targets).toEqual([
      ["local", LOCAL.endpoint, "default"],
    ])
  })
})
