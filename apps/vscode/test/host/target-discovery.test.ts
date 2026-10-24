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
const FALLBACK_A = join("/work/a", TargetsFile.FALLBACK_NAME)
const FALLBACK_B = join("/work/b", TargetsFile.FALLBACK_NAME)

function profiles(entries: Record<string, string>): string {
  return JSON.stringify({
    profiles: Object.fromEntries(Object.entries(entries).map(([name, url]) => [name, { url }])),
  })
}

beforeEach(() => {
  files.clear()
})

describe("the project files Pulse reads", () => {
  test("are the pulse-cli project file and, where none sits beside it, the old one", () => {
    expect(TargetsFile.GLOB).toBe(`**/{${TargetsFile.NAME},${TargetsFile.FALLBACK_NAME}}`)
    const currentA = { fsPath: CURRENT_A }
    const fallbackA = { fsPath: FALLBACK_A }
    const fallbackB = { fsPath: FALLBACK_B }
    expect(TargetsFile.readingOrder([fallbackB, fallbackA, currentA])).toEqual([
      { file: currentA, fallback: false },
      { file: fallbackB, fallback: true },
    ])
  })

  test("writes a new one under the pulse-cli name", () => {
    expect(TargetsFile.in({ fsPath: "/work" } as never)).toEqual({
      fsPath: `/work/${TargetsFile.NAME}`,
    })
  })

  test("let the pulse-cli project file win a profile name and warn about the old name", async () => {
    files.set(
      FALLBACK_B,
      profiles({ shared: "http://b:8080/engine-rest", b: "http://b:8080/engine-rest" }),
    )
    files.set(CURRENT_A, profiles({ shared: "http://a:8080/engine-rest" }))
    files.set(FALLBACK_A, profiles({ shadowed: "http://a:9090/engine-rest" }))

    const { targets, problems } = await TargetDiscovery.discover()

    expect(targets.map((target) => [target.name, target.endpoint])).toEqual([
      ["shared", "http://a:8080/engine-rest"],
      ["b", "http://b:8080/engine-rest"],
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]?.path).toBe(FALLBACK_B)
    expect(problems[0]?.severity).toBe("warning")
    expect(problems[0]?.label()).toBe(
      `${TargetsFile.FALLBACK_NAME}: rename it to ${TargetsFile.NAME}; Pulse reads this file name only until its first release after 2027-01-31`,
    )
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

  test("keeps a broken file an error and the old name a warning", () => {
    expect(new TargetsProblem(CURRENT_A, "the file is not valid JSON").severity).toBeUndefined()
    expect(new TargetsProblem(FALLBACK_B, "rename it", "warning").severity).toBe("warning")
  })
})
