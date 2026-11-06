import { beforeEach, describe, expect, test, vi } from "vitest"
import type { ConnectionPicker } from "../../src/host/commands/connection-picker.js"
import type { Connection } from "../../src/host/connections/connection.js"
import type { ConnectionRegistry } from "../../src/host/connections/connection-registry.js"
import type { CredentialStore } from "../../src/host/connections/credential-store.js"
import type { EngineTarget } from "../../src/host/connections/engine-target.js"

interface InputOptions {
  readonly title: string
  readonly prompt?: string
  readonly password?: boolean
}

const window = vi.hoisted(() => ({
  showInputBox: vi.fn<(options: InputOptions) => Promise<string | undefined>>(),
}))

vi.mock("vscode", () => ({ window }))

const { SetCredentialsCommand } = await import("../../src/host/commands/set-credentials-command.js")

const SOURCE = { kind: "file", path: "/work/.pulse-cli.json" } as const

const SAAS: EngineTarget = {
  name: "c8-saas",
  engine: "c8",
  endpoint: "https://bru-2.api.camunda.io/cluster/v2",
  auth: { kind: "clientCredentials", tokenEndpoint: "https://login.cloud.camunda.io/oauth/token" },
  source: SOURCE,
}

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

async function setCredentialsOf(target: EngineTarget) {
  const write = vi.fn<CredentialStore["write"]>(() => Promise.resolve())
  const reload = vi.fn<ConnectionRegistry["reload"]>(() => Promise.resolve())
  const command = new SetCredentialsCommand(
    { reload } as unknown as ConnectionRegistry,
    { write } as unknown as CredentialStore,
    { pick: vi.fn() } as unknown as ConnectionPicker,
  )
  await command.run({ connection: { target } as unknown as Connection })
  return { write, reload }
}

beforeEach(() => {
  window.showInputBox.mockReset()
})

describe("Set Credentials", () => {
  test.each([
    {
      target: SAAS,
      identity: "Client ID",
      secret: "Client secret",
      prompt: "Pulse sends it to login.cloud.camunda.io.",
    },
    {
      target: KEYCLOAK,
      identity: "Client ID",
      secret: "Client secret",
      prompt: "Pulse sends it to localhost:18089.",
    },
    {
      target: SHOP,
      identity: "Username",
      secret: "Password",
      prompt: "Pulse sends it to shop.example.com:8443.",
    },
  ])(
    "names the host that gets the credentials of $target.name",
    async ({ target, identity, secret, prompt }) => {
      const asked = answering("pulse", "s3cret")

      const { write, reload } = await setCredentialsOf(target)

      expect(asked).toEqual([
        { title: `${identity} for ${target.name}`, prompt },
        { title: `${secret} for ${target.name}`, prompt, password: true },
      ])
      expect(write).toHaveBeenCalledWith(target, "pulse", "s3cret")
      expect(reload).toHaveBeenCalledOnce()
    },
  )

  test("saves nothing when you cancel a prompt", async () => {
    answering("pulse", undefined)

    const { write, reload } = await setCredentialsOf(SAAS)

    expect(write).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
