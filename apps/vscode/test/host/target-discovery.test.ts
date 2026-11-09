import { VSCODE_WRITES_WORDING } from "../../src/host/connections/writes-wording.js"
import { join } from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { LOCAL_TARGET, TargetsProblem, WritePolicy } from "@miragon/pulse-runtime-view/host-kit"
import { TargetDiscovery } from "../../src/host/connections/target-discovery.js"
import { TargetsFile } from "../../src/host/connections/targets-file.js"

const files = vi.hoisted(() => new Map<string, string>())

vi.mock("vscode", () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, name: string) => ({ fsPath: `${base.fsPath}/${name}` }),
  },
  workspace: {
    findFiles: () => Promise.resolve([...files.keys()].map((fsPath) => ({ fsPath }))),
    fs: {
      readFile: (uri: { fsPath: string }) =>
        Promise.resolve(new TextEncoder().encode(files.get(uri.fsPath) ?? "")),
    },
  },
}))

const CURRENT_A = join("/work/a", TargetsFile.NAME)
const CURRENT_B = join("/work/b", TargetsFile.NAME)
const FORMER_B = join("/work/b", ".pulse-cli.json")

function profiles(entries: Record<string, string>): string {
  return JSON.stringify({
    profiles: Object.fromEntries(Object.entries(entries).map(([name, url]) => [name, { url }])),
  })
}

beforeEach(() => {
  files.clear()
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
    files.set(CURRENT_A, profiles({ shared: "http://a:8080/engine-rest" }))
    files.set(
      CURRENT_B,
      profiles({ shared: "http://b:8080/engine-rest", b: "http://b:8080/engine-rest" }),
    )

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets.map((target) => [target.name, target.endpoint])).toEqual([
      ["shared", "http://a:8080/engine-rest"],
      ["b", "http://b:8080/engine-rest"],
    ])
    expect(problems).toEqual([])
  })

  test("show a folder with the file under its former name only as a problem, never its engines nor the local default", async () => {
    files.set(FORMER_B, profiles({ old: "http://old:8080/engine-rest" }))

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets).toEqual([])
    expect(problems).toEqual([new TargetsProblem(FORMER_B, TargetsFile.RENAME)])
    expect(problems[0]?.severity).toBeUndefined()
    expect(problems[0]?.label()).toBe(
      ".pulse-cli.json: Pulse reads .pulse.json now. Rename this file to .pulse.json; its content stays.",
    )
  })

  test("leave the former name alone in a folder that has the current one", async () => {
    files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    files.set(join("/work/a", ".pulse-cli.json"), "not JSON")

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets.map((target) => target.name)).toEqual(["a"])
    expect(problems).toEqual([])
  })

  test("list the engines of another folder next to a folder with the former name only", async () => {
    files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    files.set(FORMER_B, profiles({ old: "http://old:8080/engine-rest" }))

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets.map((target) => target.name)).toEqual(["a"])
    expect(problems).toEqual([new TargetsProblem(FORMER_B, TargetsFile.RENAME)])
  })

  test("falls back to the local engine without any project file", async () => {
    expect(await TargetDiscovery.discover()).toEqual({ targets: [LOCAL_TARGET], problems: [] })
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
