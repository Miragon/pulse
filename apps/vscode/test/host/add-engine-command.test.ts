import { beforeEach, describe, expect, test, vi } from "vitest"
import { RuntimeError, type EngineInfo } from "../../src/contract/index.js"
import type { OpenTargetsFileCommand } from "../../src/host/commands/open-targets-file-command.js"
import type { ConnectionRegistry } from "../../src/host/connections/connection-registry.js"
import type { CredentialStore } from "../../src/host/connections/credential-store.js"
import type { EngineTarget } from "../../src/host/connections/engine-target.js"
import { ScriptedPrompts } from "./support/scripted-prompts.js"

interface Folder {
  readonly uri: { readonly fsPath: string }
}

const fake = vi.hoisted(() => ({
  log: [] as string[],
  files: new Map<string, string>(),
  folders: [] as Folder[],
  user: undefined as Readonly<Record<string, unknown>> | undefined,
  window: {
    showInformationMessage: vi.fn<(message: string) => Promise<undefined>>(),
    showErrorMessage: vi.fn<(message: string, ...items: string[]) => Promise<string | undefined>>(),
    showWorkspaceFolderPick: vi.fn<() => Promise<Folder | undefined>>(),
  },
  commands: { executeCommand: vi.fn<(command: string, ...args: unknown[]) => Promise<void>>() },
}))

vi.mock("vscode", () => ({
  window: fake.window,
  commands: fake.commands,
  ConfigurationTarget: { Global: "global" },
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join("/"),
    }),
  },
  workspace: {
    get workspaceFolders() {
      return fake.folders
    },
    fs: {
      readFile: (uri: { fsPath: string }) => {
        const text = fake.files.get(uri.fsPath)
        return text === undefined
          ? Promise.reject(new Error("missing"))
          : Promise.resolve(new TextEncoder().encode(text))
      },
      writeFile: (uri: { fsPath: string }, bytes: Uint8Array) => {
        fake.log.push(`write ${uri.fsPath}`)
        fake.files.set(uri.fsPath, new TextDecoder().decode(bytes))
        return Promise.resolve()
      },
    },
    getConfiguration: () => ({
      inspect: () => ({ globalValue: fake.user }),
      update: (key: string, value: unknown, target: unknown) => {
        fake.log.push(`settings ${key} ${JSON.stringify(value)} ${String(target)}`)
        return Promise.resolve()
      },
    }),
  },
}))

const { AddEngineCommand } = await import("../../src/host/commands/add-engine-command.js")

const SAVE = "$(check) Save and connect"
const CLUSTER = "12345678-90ab-cdef-1234-567890abcdef"
const FILE = "/work/.pulse-cli.json"
const SAAS = [
  "Camunda 8 SaaS",
  "bru-2",
  CLUSTER,
  "client-id",
  "s3cret",
  "zeebe.camunda.io",
  "saas-bru-2",
]
const REFUSED = new RuntimeError(
  "unauthorized",
  "The token endpoint refused the client ID or secret (invalid_client).",
)

function adding(answers: readonly (string | undefined)[], describe: () => Promise<EngineInfo>) {
  const prompts = new ScriptedPrompts(answers)
  const write = vi.fn<CredentialStore["write"]>((target, identity) => {
    fake.log.push(
      `secret ${target.name} ${identity} ${target.source.kind === "file" ? target.source.path : ""}`,
    )
    return Promise.resolve()
  })
  const openFile = vi.fn<OpenTargetsFileCommand["run"]>(() => Promise.resolve())
  const registry = {
    all: () => [{ target: { name: "shop-dev" } }],
    reload: () => {
      fake.log.push("reload")
      return Promise.resolve()
    },
    activate: (name: string) => {
      fake.log.push(`activate ${name}`)
      return Promise.resolve()
    },
    byName: (name: string) => ({
      target: { name } as EngineTarget,
      badge: { name, environment: "test", host: "bru-2.api.camunda.io" },
      runtime: { describeEngine: describe },
    }),
  }
  const command = new AddEngineCommand(
    registry as unknown as ConnectionRegistry,
    { write },
    { run: openFile },
    prompts,
  )
  return { command, prompts, write, openFile }
}

function profiles(): Readonly<Record<string, unknown>> {
  const file = JSON.parse(fake.files.get(FILE) ?? "{}") as { profiles?: Record<string, unknown> }
  return file.profiles ?? {}
}

const ENGINE = () => Promise.resolve({ product: "Camunda 8", version: "8.9.28" })

beforeEach(() => {
  fake.log.length = 0
  fake.files.clear()
  fake.folders = [{ uri: { fsPath: "/work" } }]
  fake.user = { "shop-prod": "production" }
  fake.window.showInformationMessage.mockReset()
  fake.window.showErrorMessage.mockReset()
  fake.window.showWorkspaceFolderPick.mockReset()
  fake.commands.executeCommand.mockReset()
})

describe("Add Engine", () => {
  test("saves a SaaS cluster, its secret and its class in that order, then reads it once", async () => {
    const { command } = adding([...SAAS, "Test", SAVE], ENGINE)

    await command.run()

    expect(fake.log).toEqual([
      `secret saas-bru-2 client-id ${FILE}`,
      `write ${FILE}`,
      'settings environments {"shop-prod":"production","saas-bru-2":"test"} global',
      "reload",
      "activate saas-bru-2",
    ])
    expect(profiles()).toEqual({
      "saas-bru-2": {
        url: `https://bru-2.api.camunda.io/${CLUSTER}/v2`,
        cockpitUrl: `https://bru-2.api.camunda.io/${CLUSTER}/operate`,
        flavor: "camunda8",
        auth: {
          type: "clientCredentials",
          tokenEndpoint: "https://login.cloud.camunda.io/oauth/token",
          audience: "zeebe.camunda.io",
        },
      },
    })
    expect(fake.files.get(FILE)).not.toContain("s3cret")
    expect(fake.window.showInformationMessage).toHaveBeenCalledWith(
      "Pulse reads saas-bru-2: Camunda 8 8.9.28.",
    )
    expect(fake.commands.executeCommand).toHaveBeenCalledWith(
      "pulse.openEngineOverview",
      "saas-bru-2",
    )
  })

  test("writes production to the user settings and leaves an unclassified engine out", async () => {
    await adding([...SAAS, "Production", SAVE], ENGINE).command.run()
    expect(fake.log).toContain(
      'settings environments {"shop-prod":"production","saas-bru-2":"production"} global',
    )

    fake.log.length = 0
    fake.files.clear()
    await adding([...SAAS, "Leave it unclassified", SAVE], ENGINE).command.run()
    expect(fake.log.some((line) => line.startsWith("settings"))).toBe(false)
  })

  test("words a failed read in Pulse's words and saves the changed details over the first ones", async () => {
    const describe = vi
      .fn<() => Promise<EngineInfo>>()
      .mockRejectedValueOnce(REFUSED)
      .mockImplementation(ENGINE)
    fake.window.showErrorMessage.mockResolvedValueOnce("Change the details")
    const { command } = adding(
      [...SAAS, "Test", SAVE, "Name", "saas", "Client secret", "right-secret", SAVE],
      describe,
    )

    await command.run()

    expect(fake.window.showErrorMessage).toHaveBeenCalledWith(
      "saas-bru-2 rejected the credentials. The token endpoint refused the client ID or secret (invalid_client).",
      "Change the details",
      "Open the project file",
    )
    expect(Object.keys(profiles())).toEqual(["saas"])
    expect(fake.commands.executeCommand).toHaveBeenCalledWith("pulse.openEngineOverview", "saas")
  })

  test("leaves a project file that isn't JSON as it is and offers to open it", async () => {
    fake.files.set(FILE, "{ not json")
    fake.window.showErrorMessage.mockResolvedValueOnce("Open the project file")
    const { command, openFile } = adding([...SAAS, "Test", SAVE], ENGINE)

    await command.run()

    expect(fake.window.showErrorMessage).toHaveBeenCalledWith(
      ".pulse-cli.json isn't valid JSON.",
      "Change the details",
      "Open the project file",
    )
    expect(fake.files.get(FILE)).toBe("{ not json")
    expect(openFile).toHaveBeenCalledWith(FILE)
    expect(fake.log).toEqual([])
  })

  test("refuses credentials over plain HTTP outside loopback before it saves anything", async () => {
    const { command } = adding(
      [
        "Camunda 8 Self-Managed",
        "http://camunda.example.com/v2",
        "",
        "Basic auth",
        "reader",
        "reader-password",
        "c8-camunda",
        "Test",
        SAVE,
      ],
      ENGINE,
    )

    await command.run()

    expect(fake.window.showErrorMessage).toHaveBeenCalledWith(
      "c8-camunda would send its credentials over plain HTTP. Use an https endpoint.",
      "Change the details",
      "Open the project file",
    )
    expect(fake.log).toEqual([])
  })

  test("opens the project file for the Camunda 7 family", async () => {
    const { command, openFile } = adding(["Camunda 7, Operaton or CIB seven"], ENGINE)

    await command.run()

    expect(openFile).toHaveBeenCalledWith()
    expect(fake.log).toEqual([])
  })

  test("asks for a folder only when there are several, and for one when there is none", async () => {
    fake.folders = []
    await adding([], ENGINE).command.run()
    expect(fake.window.showInformationMessage).toHaveBeenCalledWith(
      "Open a folder to configure engines in a .pulse-cli.json.",
    )

    fake.folders = [{ uri: { fsPath: "/work" } }, { uri: { fsPath: "/other" } }]
    fake.window.showWorkspaceFolderPick.mockResolvedValueOnce(undefined)
    await adding([], ENGINE).command.run()
    expect(fake.window.showWorkspaceFolderPick).toHaveBeenCalledOnce()
    expect(fake.log).toEqual([])
  })
})
