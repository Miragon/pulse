import { VSCODE_WRITES_WORDING } from "../../src/host/connections/writes-wording.js"
import { join } from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { LOCAL_TARGET, TargetsProblem, WritePolicy } from "@miragon/pulse-runtime-view/host-kit"
import { TargetDiscovery } from "../../src/host/connections/target-discovery.js"
import { TargetsFile } from "../../src/host/connections/targets-file.js"

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
    findFiles: () => Promise.resolve([...fake.files.keys()].map((fsPath) => ({ fsPath }))),
    fs: {
      readFile: (uri: { fsPath: string }) =>
        fake.unreadable.has(uri.fsPath)
          ? Promise.reject(Object.assign(new Error("denied"), { code: "NoPermissions" }))
          : Promise.resolve(new TextEncoder().encode(fake.files.get(uri.fsPath) ?? "")),
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
  fake.files.clear()
  fake.unreadable.clear()
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

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets.map((target) => [target.name, target.endpoint])).toEqual([
      ["shared", "http://a:8080/engine-rest"],
      ["b", "http://b:8080/engine-rest"],
    ])
    expect(problems).toEqual([])
  })

  test("show a folder with the file under its former name only as a problem, never its engines nor the local default", async () => {
    fake.files.set(FORMER_B, profiles({ old: "http://old:8080/engine-rest" }))

    const { targets, problems } = await TargetDiscovery.discover()

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

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets.map((target) => target.name)).toEqual(["a"])
    expect(problems).toEqual([])
  })

  test("list the engines of another folder next to a folder with the former name only", async () => {
    fake.files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    fake.files.set(FORMER_B, profiles({ old: "http://old:8080/engine-rest" }))

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets.map((target) => target.name)).toEqual(["a"])
    expect(problems).toEqual([new TargetsProblem(FORMER_B, TargetsFile.RENAME)])
  })

  test("name a project file it cannot read once and take no local engine in its place", async () => {
    fake.files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    fake.unreadable.add(CURRENT_A)

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets).toEqual([])
    expect(problems.map((problem) => problem.label())).toEqual([
      ".pulse.json: Pulse can't read this file",
    ])
  })

  test("list the engines of a readable project file next to one it cannot read", async () => {
    fake.files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    fake.files.set(CURRENT_B, profiles({ b: "http://b:8080/engine-rest" }))
    fake.unreadable.add(CURRENT_A)

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets.map((target) => target.name)).toEqual(["b"])
    expect(problems).toEqual([new TargetsProblem(CURRENT_A, "Pulse can't read this file")])
  })

  test("name a project file it cannot read before a folder with the former name only", async () => {
    fake.files.set(FORMER_B, profiles({ old: "http://old:8080/engine-rest" }))
    fake.files.set(CURRENT_A, profiles({ a: "http://a:8080/engine-rest" }))
    fake.unreadable.add(CURRENT_A)

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets).toEqual([])
    expect(problems).toEqual([
      new TargetsProblem(CURRENT_A, "Pulse can't read this file"),
      new TargetsProblem(FORMER_B, TargetsFile.RENAME),
    ])
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
