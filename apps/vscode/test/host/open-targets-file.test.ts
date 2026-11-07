import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { OpenTargetsFileCommand } from "../../src/host/commands/open-targets-file-command.js"
import type { Connection } from "../../src/host/connections/connection.js"
import type { ConnectionRegistry } from "../../src/host/connections/connection-registry.js"
import { LOCAL_TARGET } from "../../src/host/connections/engine-target.js"
import { TargetsFile } from "../../src/host/connections/targets-file.js"
import { TargetsProblem } from "../../src/host/connections/targets-problem.js"

interface Item {
  readonly label: string
  readonly description?: string
}

const fake = vi.hoisted(() => ({
  existing: new Set<string>(),
  folders: [] as { name: string; uri: { fsPath: string } }[],
  calls: [] as string[],
  offered: [] as string[],
  choose: (items: readonly { label: string }[]) => items[0],
}))

vi.mock("vscode", () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, name: string) => ({ fsPath: `${base.fsPath}/${name}` }),
  },
  Range: class {
    constructor(
      readonly startLine: number,
      readonly startCharacter: number,
      readonly endLine: number,
      readonly endCharacter: number,
    ) {}
  },
  SnippetString: class {
    value = ""
    appendText(text: string) {
      this.value += text
      return this
    }
    appendPlaceholder(text: string) {
      this.value += `\${${text}}`
      return this
    }
  },
  window: {
    showTextDocument: (uri: { fsPath: string }) => {
      fake.calls.push(`open ${uri.fsPath}`)
      return Promise.resolve({
        document: { lineCount: 3, validateRange: (range: unknown) => range },
        insertSnippet: (snippet: { value: string }) => {
          fake.calls.push(`snippet ${snippet.value}`)
          return Promise.resolve(true)
        },
      })
    },
    showQuickPick: (items: readonly Item[]) => {
      fake.offered = items.map((item) => `${item.label} | ${item.description ?? ""}`)
      return Promise.resolve(fake.choose(items))
    },
  },
  workspace: {
    get workspaceFolders() {
      return fake.folders
    },
    asRelativePath: (uri: { fsPath: string }) => uri.fsPath.replace(/^\/w\//, ""),
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
let own = ""

function registryOf(
  problems: readonly TargetsProblem[],
  connections: readonly Pick<Connection, "target">[] = [{ target: LOCAL_TARGET }],
): ConnectionRegistry {
  return {
    all: () => connections,
    configurationProblems: () => problems,
    reload: () => {
      fake.calls.push("reload")
      return Promise.resolve()
    },
  } as unknown as ConnectionRegistry
}

async function runIn(registry: ConnectionRegistry, path?: unknown): Promise<readonly string[]> {
  await new OpenTargetsFileCommand(registry).run(path)
  return fake.calls
}

function fromFile(path: string): Pick<Connection, "target"> {
  return { target: { ...LOCAL_TARGET, source: { kind: "file", path } } }
}

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "pulse-configure-"))
  vi.stubEnv("XDG_CONFIG_HOME", home)
  vi.stubEnv("PULSE_CLI_CONFIG", "")
  own = join(home, "pulse-cli", "config.json")
  fake.existing.clear()
  fake.folders = [{ name: "w", uri: { fsPath: "/w" } }]
  fake.calls = []
  fake.offered = []
  fake.choose = (items) => items[0]
})

describe("Configure Engines", () => {
  test("opens the file the Engines tree or a connection names", async () => {
    const broken = new TargetsProblem(NESTED, "the file is not valid JSON")
    const other = new TargetsProblem(CURRENT, "the file is not valid JSON")

    expect(await runIn(registryOf([other, broken]), NESTED)).toEqual([`open ${NESTED}`])
    fake.calls = []
    expect(await runIn(registryOf([], [fromFile(own)]), own)).toEqual([`open ${own}`])
    expect(fake.offered).toEqual([])
  })

  test("asks which file gets the engines while a folder is open", async () => {
    await runIn(registryOf([]))

    expect(fake.offered).toEqual([`This project | ${TargetsFile.NAME}`, `All projects | ${own}`])
  })

  test("writes a new project file only when the folder has none", async () => {
    expect(await runIn(registryOf([]))).toEqual([`write ${CURRENT}`, `open ${CURRENT}`])
  })

  test("offers the project file an engine comes from", async () => {
    fake.existing.add(NESTED)

    expect(await runIn(registryOf([], [fromFile(own), fromFile(NESTED)]))).toEqual([
      `open ${NESTED}`,
    ])
    expect(fake.offered[0]).toBe(`This project | shop/${TargetsFile.NAME}`)
  })

  test("offers each folder of a multi-root workspace by its name", async () => {
    fake.folders = [
      { name: "shop", uri: { fsPath: "/w/shop" } },
      { name: "billing", uri: { fsPath: "/w/billing" } },
    ]

    await runIn(registryOf([]))

    expect(fake.offered.map((item) => item.split(" | ")[0])).toEqual([
      "shop",
      "billing",
      "All projects",
    ])
  })

  test("does nothing when the choice is dismissed", async () => {
    fake.choose = () => undefined

    expect(await runIn(registryOf([]))).toEqual([])
  })
})

describe("Configure Engines and the CLI's user config", () => {
  test("is where engines go without an open folder: created private, with a profile to fill in", async () => {
    fake.folders = []

    const calls = await runIn(registryOf([]))

    expect(fake.offered).toEqual([])
    expect(calls).toEqual([
      `open ${own}`,
      'snippet {\n  "profiles": {\n    "${dev}": {\n      "url": "${https://dev.example.com/engine-rest}"\n    }\n  }\n}\n',
      "reload",
    ])
    expect(statSync(own).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(own, "utf8"))).toEqual({ profiles: {} })
  })

  test("opens an existing user config as it is", async () => {
    fake.folders = []
    await runIn(registryOf([]))
    fake.calls = []

    expect(await runIn(registryOf([]))).toEqual([`open ${own}`])
  })

  test("is the choice for all projects", async () => {
    fake.choose = (items) => items[1]

    expect((await runIn(registryOf([])))[0]).toBe(`open ${own}`)
  })

  test("named by PULSE_CLI_CONFIG, is the only file it offers", async () => {
    const named = join(mkdtempSync(join(tmpdir(), "pulse-named-")), "ci.json")
    vi.stubEnv("PULSE_CLI_CONFIG", named)

    expect((await runIn(registryOf([])))[0]).toBe(`open ${named}`)
    expect(fake.offered).toEqual([])
  })
})
