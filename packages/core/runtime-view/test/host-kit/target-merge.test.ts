import { describe, expect, test } from "vitest"
import { LOCAL_TARGET, type EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { ProjectFile } from "../../src/host-kit/connections/project-file.js"
import { type FileVerdict, TargetMerge } from "../../src/host-kit/connections/target-merge.js"

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
