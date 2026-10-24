import { IncidentId, type EngineConnection } from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../../../src/adapters/c7/index.js"
import { FAKE_CLI_PATH, FAKE_CONFIG_PATH, fakeEngineCli } from "./support/fake-engine-cli.js"

const ENDPOINT = "https://engine.example/engine-rest"
const TELEMETRY = {
  command: ["telemetry", "get-data"],
  stdout: '{"product":{"name":"Operaton","version":"2.1.5"}}',
}
const BASIC: EngineConnection = {
  endpoint: ENDPOINT,
  credentials: { kind: "basic", username: "demo", password: "s3cret" },
}

function adapterOver(cli: ReturnType<typeof fakeEngineCli>): C7Adapter {
  return new C7Adapter({ cliPath: FAKE_CLI_PATH, configPath: FAKE_CONFIG_PATH }, cli.spawner)
}

describe("the C7 adapter", () => {
  test("reads from the endpoint of the connection with its credentials in the environment only", async () => {
    const cli = fakeEngineCli([TELEMETRY])
    const runtime = adapterOver(cli).runtime(BASIC)

    expect(await runtime.describeEngine()).toEqual({ product: "Operaton", version: "2.1.5" })

    const [invocation] = cli.invocations
    expect(invocation?.args[0]).toBe(FAKE_CLI_PATH)
    expect(invocation?.args.join(" ")).not.toContain("s3cret")
    expect(invocation?.environment).toMatchObject({
      OPERATE_URL: ENDPOINT,
      OPERATE_CONFIG: FAKE_CONFIG_PATH,
      OPERATE_READ_ONLY: "1",
      OPERATE_AUTH: "basic",
      OPERATE_USERNAME: "demo",
      OPERATE_PASSWORD: "s3cret",
    })
  })

  test("writes to the same endpoint with the same credentials, without the read-only switch", async () => {
    const cli = fakeEngineCli([
      {
        command: ["retry"],
        stdout: JSON.stringify({ retried: 1, incidents: [{ result: "retried" }] }),
      },
    ])
    const commands = adapterOver(cli).commands(BASIC)

    await commands.retryIncident(IncidentId("993d2801-cd91-11f1-9c88-32e5612dd01b"))

    const environment = cli.invocations[0]?.environment
    expect(environment).toMatchObject({
      OPERATE_URL: ENDPOINT,
      OPERATE_AUTH: "basic",
      OPERATE_USERNAME: "demo",
      OPERATE_PASSWORD: "s3cret",
    })
    expect(environment).not.toHaveProperty("OPERATE_READ_ONLY")
  })

  test("connects without credentials when the connection has none", async () => {
    const cli = fakeEngineCli([TELEMETRY])
    const runtime = adapterOver(cli).runtime({
      endpoint: ENDPOINT,
      credentials: { kind: "none" },
    })

    await runtime.describeEngine()

    const environment = cli.invocations[0]?.environment
    expect(environment).toMatchObject({ OPERATE_AUTH: "none" })
    expect(environment).not.toHaveProperty("OPERATE_USERNAME")
    expect(environment).not.toHaveProperty("OPERATE_PASSWORD")
  })
})
