import { join } from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { LOCAL_TARGET } from "../../src/host/connections/engine-target.js"
import { TargetDiscovery } from "../../src/host/connections/target-discovery.js"
import { TargetsFile } from "../../src/host/connections/targets-file.js"
import { TargetsProblem } from "../../src/host/connections/targets-problem.js"
import { WritePolicy } from "../../src/host/connections/write-policy.js"

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

function profiles(entries: Record<string, string>): string {
  return JSON.stringify({
    profiles: Object.fromEntries(Object.entries(entries).map(([name, url]) => [name, { url }])),
  })
}

beforeEach(() => {
  files.clear()
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

  test("falls back to the local engine without any project file", async () => {
    expect(await TargetDiscovery.discover()).toEqual({ targets: [LOCAL_TARGET], problems: [] })
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
  })

  test("keeps a broken file an error", () => {
    expect(new TargetsProblem(CURRENT_A, "the file is not valid JSON").severity).toBeUndefined()
  })
})
