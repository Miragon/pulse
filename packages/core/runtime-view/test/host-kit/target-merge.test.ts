import { describe, expect, test } from "vitest"
import { LOCAL_TARGET, type EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { ProjectFile } from "../../src/host-kit/connections/project-file.js"
import {
  type FileVerdict,
  TargetMerge,
  type UserConfigRead,
  type UserConfigVerdict,
} from "../../src/host-kit/connections/target-merge.js"
import { UserConfigLocation } from "../../src/host-kit/connections/user-config-location.js"

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
      problems: [".pulse.json: Pulse can't read this file"],
    })
  })

  test("name a file the host was told to read that is missing, and keep the local engine", () => {
    expect(merged([{ kind: "missing", path: A }])).toEqual({
      targets: [["local", LOCAL.endpoint, { kind: "default" }]],
      problems: [".pulse.json: Pulse can't read this file"],
    })
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

function withUser(files: readonly FileVerdict[], user: UserConfigRead) {
  const { targets, problems } = new TargetMerge(LOCAL).merge(files, user)
  return {
    targets: targets.map((target) => [target.name, target.endpoint, target.source.kind]),
    problems: problems.map((problem) => [problem.label(), problem.severity]),
  }
}

describe("the engines of the CLI's user config", () => {
  test("list its profiles without any project file, as profiles of the user config", () => {
    expect(
      withUser([], {
        location: DEFAULT_PLACE,
        verdict: own({ saas: { url: "https://saas.example.com/engine-rest" } }),
      }),
    ).toEqual({
      targets: [["saas", "https://saas.example.com/engine-rest", "user-config"]],
      problems: [],
    })
  })

  test("join after the project files, and a profile of the user wins a name whole, in its place", () => {
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

    const { targets } = new TargetMerge(LOCAL).merge(files, { location: DEFAULT_PLACE, verdict })

    expect(targets.map((target) => [target.name, target.source.kind])).toEqual([
      ["dev", "user-config"],
      ["team", "file"],
      ["mine", "user-config"],
    ])
    expect(targets[0]?.readOnly).toBeUndefined()
  })

  test("hide a project's profile behind a refused one of the same name, and say why", () => {
    expect(
      withUser([read(A, { dev: { url: "http://dev:8080/engine-rest" } })], {
        location: DEFAULT_PLACE,
        verdict: own({ dev: { url: "ftp://dev" } }),
      }),
    ).toEqual({
      targets: [["local", LOCAL.endpoint, "default"]],
      problems: [
        ['CLI config: profile "dev": url must start with http:// or https://.', undefined],
      ],
    })
  })

  test("are no problem while the file does not exist", () => {
    expect(
      withUser([], { location: DEFAULT_PLACE, verdict: { kind: "missing", path: OWN } }),
    ).toEqual({ targets: [["local", LOCAL.endpoint, "default"]], problems: [] })
  })

  test("name a file Pulse cannot read and take no local engine in its place", () => {
    expect(
      withUser([], { location: DEFAULT_PLACE, verdict: { kind: "unreadable", path: OWN } }),
    ).toEqual({ targets: [], problems: [[`CLI config: ${TargetMerge.UNREADABLE}`, undefined]] })
  })

  test("leave the project's engines alone when the file is no profile file", () => {
    expect(
      withUser([read(A, { a: { url: "http://a:8080/engine-rest" } })], {
        location: DEFAULT_PLACE,
        verdict: { kind: "read", path: OWN, text: "{" },
      }),
    ).toEqual({
      targets: [["a", "http://a:8080/engine-rest", "file"]],
      problems: [["CLI config: The text is not valid JSON (line 1, column 2).", undefined]],
    })
  })
})

describe("the file PULSE_CLI_CONFIG names", () => {
  const PROJECT = [read(A, { team: { url: "http://team:8080/engine-rest" } })]

  test("is the only file Pulse reads, like the CLI, and says so while it hides project files", () => {
    const verdict = own({ ci: { url: "http://ci:8080/engine-rest" } }, NAMED)

    expect(withUser(PROJECT, { location: NAMED_PLACE, verdict })).toEqual({
      targets: [["ci", "http://ci:8080/engine-rest", "user-config"]],
      problems: [[`CLI config: ${TargetMerge.NAMED_ONLY}`, "warning"]],
    })
    expect(withUser([], { location: NAMED_PLACE, verdict }).problems).toEqual([])
    expect(TargetMerge.NAMED_ONLY).toBe(
      "PULSE_CLI_CONFIG names this file, so Pulse reads no .pulse.json, like the CLI.",
    )
  })

  test("must exist: a missing one is one problem, and no local engine takes its place", () => {
    expect(
      withUser(PROJECT, { location: NAMED_PLACE, verdict: { kind: "missing", path: NAMED } }),
    ).toEqual({ targets: [], problems: [[`CLI config: ${TargetMerge.NAMED_MISSING}`, undefined]] })
  })

  test("that Pulse cannot read is one problem, and no local engine takes its place", () => {
    expect(
      withUser(PROJECT, { location: NAMED_PLACE, verdict: { kind: "unreadable", path: NAMED } }),
    ).toEqual({ targets: [], problems: [[`CLI config: ${TargetMerge.UNREADABLE}`, undefined]] })
  })

  test("by a relative path is one problem, whatever a host read, and no engine", () => {
    const relative = new UserConfigLocation({ PULSE_CLI_CONFIG: "pulse.json" }, "/home/me", "linux")
    const expectedProblem = {
      targets: [],
      problems: [[`CLI config: ${TargetMerge.RELATIVE}`, undefined]],
    }

    expect(withUser(PROJECT, { location: relative })).toEqual(expectedProblem)
    expect(
      withUser(PROJECT, { location: relative, verdict: own({ ci: { url: "http://ci" } }) }),
    ).toEqual(expectedProblem)
  })

  test("without a usable profile still leaves the local engine, as a project file does", () => {
    expect(withUser(PROJECT, { location: NAMED_PLACE, verdict: own({}, NAMED) }).targets).toEqual([
      ["local", LOCAL.endpoint, "default"],
    ])
  })
})
