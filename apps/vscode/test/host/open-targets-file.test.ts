import { beforeEach, describe, expect, test, vi } from "vitest"
import { OpenTargetsFileCommand } from "../../src/host/commands/open-targets-file-command.js"
import type { Connection } from "../../src/host/connections/connection.js"
import type { ConnectionRegistry } from "../../src/host/connections/connection-registry.js"
import { LOCAL_TARGET } from "../../src/host/connections/engine-target.js"
import { TargetsFile } from "../../src/host/connections/targets-file.js"
import { TargetsProblem } from "../../src/host/connections/targets-problem.js"

const fake = vi.hoisted(() => ({
  existing: new Set<string>(),
  folders: [] as { uri: { fsPath: string } }[],
  calls: [] as string[],
}))

vi.mock("vscode", () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, name: string) => ({ fsPath: `${base.fsPath}/${name}` }),
  },
  window: {
    showTextDocument: (uri: { fsPath: string }) => {
      fake.calls.push(`open ${uri.fsPath}`)
      return Promise.resolve()
    },
    showInformationMessage: (message: string) => {
      fake.calls.push(`inform ${message}`)
      return Promise.resolve()
    },
  },
  workspace: {
    get workspaceFolders() {
      return fake.folders
    },
    fs: {
      stat: (uri: { fsPath: string }) =>
        fake.existing.has(uri.fsPath) ? Promise.resolve({}) : Promise.reject(new Error("missing")),
      writeFile: (uri: { fsPath: string }) => {
        fake.calls.push(`write ${uri.fsPath}`)
        fake.existing.add(uri.fsPath)
        return Promise.resolve()
      },
    },
  },
}))

const CURRENT = `/w/${TargetsFile.NAME}`
const NESTED = `/w/shop/${TargetsFile.NAME}`

function registryOf(
  problems: readonly TargetsProblem[],
  connections: readonly Pick<Connection, "target">[] = [{ target: LOCAL_TARGET }],
): ConnectionRegistry {
  return {
    all: () => connections,
    configurationProblems: () => problems,
  } as unknown as ConnectionRegistry
}

async function runIn(registry: ConnectionRegistry, path?: unknown): Promise<readonly string[]> {
  await new OpenTargetsFileCommand(registry).run(path)
  return fake.calls
}

beforeEach(() => {
  fake.existing.clear()
  fake.folders = [{ uri: { fsPath: "/w" } }]
  fake.calls = []
})

describe("Configure Engines and Open the project file", () => {
  test("write a new pulse-cli project file only when the folder has none", async () => {
    expect(await runIn(registryOf([]))).toEqual([`write ${CURRENT}`, `open ${CURRENT}`])
  })

  test("open the file the Engines tree names, and the file an engine comes from", async () => {
    const broken = new TargetsProblem(NESTED, "the file is not valid JSON")
    const other = new TargetsProblem(CURRENT, "the file is not valid JSON")
    const fromFile = {
      target: { ...LOCAL_TARGET, source: { kind: "file", path: CURRENT } },
    } as const

    expect(await runIn(registryOf([other, broken]), NESTED)).toEqual([`open ${NESTED}`])
    fake.calls = []
    expect(await runIn(registryOf([], [{ target: LOCAL_TARGET }, fromFile]))).toEqual([
      `open ${CURRENT}`,
    ])
  })

  test("ask for a folder when none is open", async () => {
    fake.folders = []

    expect(await runIn(registryOf([]))).toEqual([
      `inform Open a folder to configure engines in a ${TargetsFile.NAME}.`,
    ])
  })
})
