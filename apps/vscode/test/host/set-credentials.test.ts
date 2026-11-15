import type {
  Connection,
  CredentialStore,
  EngineTarget,
} from "@miragon/pulse-runtime-view/host-kit"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { ConnectionPicker } from "../../src/host/commands/connection-picker.js"
import type { OpenTargetsFileCommand } from "../../src/host/commands/open-targets-file-command.js"
import type { ConnectionRegistry } from "../../src/host/connections/connection-registry.js"
import type { PanelHost, PanelNavigator } from "../../src/host/panels/vscode-panel-effects.js"
import { LOCAL_TARGET } from "./support/local-target.js"

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

const FILE = "/work/.pulse.json"
const SOURCE = { kind: "file", path: FILE } as const
const OPEN_FILE = "Open .pulse.json"
const C8_OPEN_WITHOUT_LOGIN =
  "The profile c8-open uses auth.type none, so Pulse sends no login. Set its auth.type to basic or clientCredentials in .pulse.json."
const TO_SAAS =
  "Pulse sends it to login.cloud.camunda.io and the tokens it gets to bru-2.api.camunda.io."

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
  name: "c8-local",
  endpoint: "http://localhost:18088/v2",
  auth: {
    kind: "clientCredentials",
    tokenEndpoint: "http://localhost:18089/realms/pulse/protocol/openid-connect/token",
    clientId: "pulse-reader",
    audience: "camunda",
  },
}

const SHOP: EngineTarget = {
  name: "shop-prod",
  engine: "c7",
  endpoint: "https://shop.example.com:8443/engine-rest",
  auth: { kind: "basic" },
  source: SOURCE,
}

const C8_OPEN: EngineTarget = { ...SAAS, name: "c8-open", auth: { kind: "none" } }
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
  const projectFile = { run: openFile } as unknown as OpenTargetsFileCommand
  const command = new SetCredentialsCommand(
    { reload } as unknown as ConnectionRegistry,
    { write } as unknown as CredentialStore,
    { pick: vi.fn() } as unknown as ConnectionPicker,
    projectFile,
  )
  return { command, write, reload, openFile, projectFile }
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
    { target: SAAS, identity: "Client ID", secret: "Client secret", prompt: TO_SAAS },
    {
      target: MOVED,
      identity: "Client ID",
      secret: "Client secret",
      prompt:
        "Pulse sends it to login.cloud.camunda.io and the tokens it gets to bru-2.api-camunda.io.",
    },
    {
      target: SHOP,
      identity: "Username",
      secret: "Password",
      prompt: "Pulse sends it to shop.example.com:8443.",
    },
  ])(
    "asks for the $identity and $secret of $target.name and names the hosts they reach",
    async ({ target, identity, secret, prompt }) => {
      const asked = answering("pulse", "s3cret")

      const { write, reload } = await setCredentialsOf(target)

      expect(asked).toEqual([
        { title: `${identity} for ${target.name}`, prompt },
        { title: `${secret} for ${target.name}`, prompt, password: true },
      ])
      expect(write).toHaveBeenCalledExactlyOnceWith(target, { identity: "pulse", secret: "s3cret" })
      expect(reload).toHaveBeenCalledOnce()
      expect(window.showInformationMessage).not.toHaveBeenCalled()
    },
  )

  test("asks only for the secret of the client the profile names", async () => {
    const asked = answering("reader-secret")

    const { write } = await setCredentialsOf(KEYCLOAK)

    expect(asked).toEqual([
      {
        title: "Client secret for c8-local",
        prompt: "Pulse sends it to localhost:18089 and the tokens it gets to localhost:18088.",
        password: true,
      },
    ])
    expect(write).toHaveBeenCalledExactlyOnceWith(KEYCLOAK, { secret: "reader-secret" })
  })

  test.each([
    ["the client ID, and asks for no secret", [undefined], 1],
    ["the secret", ["pulse", undefined], 2],
  ] as const)("saves nothing when you cancel %s", async (_, inputs, prompts) => {
    answering(...inputs)

    const { write, reload } = await setCredentialsOf(SAAS)

    expect(window.showInputBox).toHaveBeenCalledTimes(prompts)
    expect(write).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe("Set Credentials on a target that sends no stored credentials", () => {
  test.each([
    { target: C8_OPEN, why: C8_OPEN_WITHOUT_LOGIN },
    {
      target: LOCAL_TARGET,
      why: "local has no profile, so Pulse sends no login. Add a profile with auth.type basic to .pulse.json or your CLI config.",
    },
    {
      target: SHOP_SSO,
      why: 'Profile "shop-sso" uses auth.type oauth, which this client cannot authenticate with. Set auth.type to none, or to basic without the OAuth keys, or keep this profile for the CLI.',
    },
    {
      target: SHOP_TEST,
      why: "shop-test would send basic credentials over plain HTTP. Use an https endpoint.",
    },
  ])("asks for nothing on $target.name and says why", async ({ target, why }) => {
    const { write, reload, openFile } = await setCredentialsOf(target)

    expect(window.showInputBox).not.toHaveBeenCalled()
    expect(window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
      why,
      target === LOCAL_TARGET ? "Configure Engines…" : OPEN_FILE,
    )
    expect(write).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })

  test.each([
    { target: C8_OPEN, choice: OPEN_FILE, file: FILE },
    { target: SHOP_SSO, choice: OPEN_FILE, file: FILE },
    { target: LOCAL_TARGET, choice: "Configure Engines…", file: undefined },
  ])("opens the file of $target.name on request", async ({ target, choice, file }) => {
    window.showInformationMessage.mockResolvedValueOnce(choice)

    const { openFile } = await setCredentialsOf(target)

    expect(openFile).toHaveBeenCalledExactlyOnceWith(file)
  })
})

describe("the ways to Set Credentials from a panel", () => {
  const navigator = {} as PanelNavigator

  function panelOf(target: EngineTarget) {
    const parts = setCredentials()
    const editor = new ConnectionEditor(parts.command, parts.projectFile)
    const connection = { target } as unknown as Connection
    const effects = new VsCodePanelEffects(connection, navigator, { editor } as PanelHost)
    return { ...parts, editor, connection, effects }
  }

  test("Set credentials… after a refused login explains a profile without a login", async () => {
    const { effects, write } = panelOf(C8_OPEN)

    effects.setCredentials()

    await vi.waitFor(() => {
      expect(window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
        C8_OPEN_WITHOUT_LOGIN,
        OPEN_FILE,
      )
    })
    expect(window.showInputBox).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
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
    expect(write).toHaveBeenCalledWith(MOVED, { identity: "pulse", secret: "s3cret" })
  })
})
