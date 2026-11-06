import { beforeEach, describe, expect, test, vi } from "vitest"
import type { ConnectionPicker } from "../../src/host/commands/connection-picker.js"
import type { OpenTargetsFileCommand } from "../../src/host/commands/open-targets-file-command.js"
import type { Connection } from "../../src/host/connections/connection.js"
import type { ConnectionRegistry } from "../../src/host/connections/connection-registry.js"
import type { CredentialStore } from "../../src/host/connections/credential-store.js"
import { LOCAL_TARGET, type EngineTarget } from "../../src/host/connections/engine-target.js"
import type { PanelHost, PanelNavigator } from "../../src/host/panels/vscode-panel-effects.js"

interface InputOptions {
  readonly title: string
  readonly prompt?: string
  readonly password?: boolean
}

const window = vi.hoisted(() => ({
  showInputBox: vi.fn<(options: InputOptions) => Promise<string | undefined>>(),
  showInformationMessage:
    vi.fn<(message: string, ...items: string[]) => Promise<string | undefined>>(),
  showQuickPick: vi.fn<(items: readonly { readonly label: string }[]) => Promise<unknown>>(),
}))

vi.mock("vscode", () => ({ window }))

const { SetCredentialsCommand } = await import("../../src/host/commands/set-credentials-command.js")
const { ConnectionEditor } = await import("../../src/host/commands/connection-editor.js")
const { VsCodePanelEffects } = await import("../../src/host/panels/vscode-panel-effects.js")

const FILE = "/work/.pulse-cli.json"
const SOURCE = { kind: "file", path: FILE } as const
const OPEN_FILE = "Open the project file"
const C8_OPEN_WITHOUT_AUTH =
  "The profile c8-open has no auth type, so Pulse sends no credentials. Set its auth.type to basic or clientCredentials in .pulse-cli.json."

const SAAS: EngineTarget = {
  name: "c8-saas",
  engine: "c8",
  endpoint: "https://bru-2.api.camunda.io/cluster/v2",
  auth: { kind: "clientCredentials", tokenEndpoint: "https://login.cloud.camunda.io/oauth/token" },
  source: SOURCE,
}

const MOVED: EngineTarget = { ...SAAS, endpoint: "https://bru-2.api-camunda.io/cluster/v2" }

const KEYCLOAK: EngineTarget = {
  ...SAAS,
  name: "c8-oidc",
  endpoint: "http://localhost:18088/v2",
  auth: {
    kind: "clientCredentials",
    tokenEndpoint: "http://localhost:18089/realms/pulse/protocol/openid-connect/token",
  },
}

const SHOP: EngineTarget = {
  name: "shop-prod",
  engine: "c7",
  endpoint: "https://shop.example.com:8443/engine-rest",
  auth: { kind: "basic" },
  source: SOURCE,
}

const C8_OPEN: EngineTarget = {
  name: "c8-open",
  engine: "c8",
  endpoint: "http://localhost:18080/v2",
  auth: { kind: "none" },
  source: SOURCE,
}

const SHOP_DEV: EngineTarget = { ...SHOP, name: "shop-dev", auth: { kind: "none" } }
const SHOP_SSO: EngineTarget = { ...SHOP, name: "shop-sso", auth: { kind: "oauth2" } }
const SHOP_TEST: EngineTarget = {
  ...SHOP,
  name: "shop-test",
  endpoint: "http://shop-test.example.com/engine-rest",
}

function answering(...inputs: (string | undefined)[]): InputOptions[] {
  const asked: InputOptions[] = []
  for (const input of inputs) {
    window.showInputBox.mockImplementationOnce((options) => {
      asked.push(options)
      return Promise.resolve(input)
    })
  }
  return asked
}

function setCredentials() {
  const write = vi.fn<CredentialStore["write"]>(() => Promise.resolve())
  const reload = vi.fn<ConnectionRegistry["reload"]>(() => Promise.resolve())
  const openFile = vi.fn<OpenTargetsFileCommand["run"]>(() => Promise.resolve())
  const command = new SetCredentialsCommand(
    { reload } as unknown as ConnectionRegistry,
    { write } as unknown as CredentialStore,
    { pick: vi.fn() } as unknown as ConnectionPicker,
    { run: openFile } as unknown as OpenTargetsFileCommand,
  )
  return { command, write, reload, openFile }
}

async function setCredentialsOf(target: EngineTarget) {
  const parts = setCredentials()
  await parts.command.run({ connection: { target } as unknown as Connection })
  return parts
}

beforeEach(() => {
  window.showInputBox.mockReset()
  window.showInformationMessage.mockReset()
  window.showQuickPick.mockReset()
})

describe("Set Credentials", () => {
  test.each([
    {
      target: SAAS,
      identity: "Client ID",
      secret: "Client secret",
      prompt:
        "Pulse sends it to login.cloud.camunda.io and the tokens it gets to bru-2.api.camunda.io.",
    },
    {
      target: MOVED,
      identity: "Client ID",
      secret: "Client secret",
      prompt:
        "Pulse sends it to login.cloud.camunda.io and the tokens it gets to bru-2.api-camunda.io.",
    },
    {
      target: KEYCLOAK,
      identity: "Client ID",
      secret: "Client secret",
      prompt: "Pulse sends it to localhost:18089 and the tokens it gets to localhost:18088.",
    },
    {
      target: SHOP,
      identity: "Username",
      secret: "Password",
      prompt: "Pulse sends it to shop.example.com:8443.",
    },
  ])(
    "names the hosts that get the credentials of $target.name at $target.endpoint and what they bring",
    async ({ target, identity, secret, prompt }) => {
      const asked = answering("pulse", "s3cret")

      const { write, reload } = await setCredentialsOf(target)

      expect(asked).toEqual([
        { title: `${identity} for ${target.name}`, prompt },
        { title: `${secret} for ${target.name}`, prompt, password: true },
      ])
      expect(write).toHaveBeenCalledWith(target, "pulse", "s3cret")
      expect(reload).toHaveBeenCalledOnce()
      expect(window.showInformationMessage).not.toHaveBeenCalled()
    },
  )

  test("saves nothing when you cancel a prompt", async () => {
    answering("pulse", undefined)

    const { write, reload } = await setCredentialsOf(SAAS)

    expect(write).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe("Set Credentials on a target that sends no stored credentials", () => {
  test.each([
    { target: C8_OPEN, why: C8_OPEN_WITHOUT_AUTH },
    {
      target: SHOP_DEV,
      why: "The profile shop-dev has no auth type, so Pulse sends no credentials. Set its auth.type to basic in .pulse-cli.json.",
    },
    {
      target: LOCAL_TARGET,
      why: "local has no profile, so Pulse sends no credentials. Add a profile with an auth.type of basic to .pulse-cli.json.",
    },
    {
      target: SHOP_SSO,
      why: "shop-sso uses OAuth2 with a browser login, which Pulse does not support yet.",
    },
    {
      target: SHOP_TEST,
      why: "shop-test would send its credentials over plain HTTP. Use an https endpoint.",
    },
  ])("asks for nothing on $target.name and says why", async ({ target, why }) => {
    const { write, reload, openFile } = await setCredentialsOf(target)

    expect(window.showInputBox).not.toHaveBeenCalled()
    expect(window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(why, OPEN_FILE)
    expect(write).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })

  test.each([
    { target: C8_OPEN, file: FILE },
    { target: SHOP_SSO, file: FILE },
    { target: LOCAL_TARGET, file: undefined },
  ])("opens the project file of $target.name on request", async ({ target, file }) => {
    window.showInformationMessage.mockResolvedValueOnce(OPEN_FILE)

    const { openFile } = await setCredentialsOf(target)

    expect(openFile).toHaveBeenCalledExactlyOnceWith(file)
  })
})

describe("the ways to Set Credentials from a panel", () => {
  const navigator = {} as PanelNavigator

  function panelOf(target: EngineTarget) {
    const parts = setCredentials()
    const editor = new ConnectionEditor(parts.command, {} as OpenTargetsFileCommand)
    const connection = { target } as unknown as Connection
    const effects = new VsCodePanelEffects(connection, navigator, { editor } as PanelHost)
    return { ...parts, editor, connection, effects }
  }

  test("Set credentials… after a rejected login explains a profile without auth", async () => {
    const { effects, write } = panelOf(C8_OPEN)

    effects.setCredentials()

    await vi.waitFor(() => {
      expect(window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
        C8_OPEN_WITHOUT_AUTH,
        OPEN_FILE,
      )
    })
    expect(window.showInputBox).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  test("Set credentials… after a rejected login asks for the login of a basic profile", async () => {
    const asked = answering("pulse", "s3cret")
    const { effects, write, reload } = panelOf(SHOP)

    effects.setCredentials()

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce()
    })
    expect(asked.map((options) => options.prompt)).toEqual([
      "Pulse sends it to shop.example.com:8443.",
      "Pulse sends it to shop.example.com:8443.",
    ])
    expect(write).toHaveBeenCalledWith(SHOP, "pulse", "s3cret")
  })

  test("Edit connection… names the moved host when you set the credentials again", async () => {
    const asked = answering("pulse", "s3cret")
    window.showQuickPick.mockImplementationOnce((items) => Promise.resolve(items[0]))
    const { editor, connection, write } = panelOf(MOVED)

    await editor.edit(connection)

    expect(asked.map((options) => options.prompt)).toEqual([
      "Pulse sends it to login.cloud.camunda.io and the tokens it gets to bru-2.api-camunda.io.",
      "Pulse sends it to login.cloud.camunda.io and the tokens it gets to bru-2.api-camunda.io.",
    ])
    expect(write).toHaveBeenCalledWith(MOVED, "pulse", "s3cret")
  })
})
