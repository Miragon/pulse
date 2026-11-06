import { describe, expect, test } from "vitest"
import { SetupSteps } from "../../src/host/commands/setup-steps.js"
import { SaasSetup } from "../../src/host/connections/saas-setup.js"
import { SelfManagedSetup } from "../../src/host/connections/self-managed-setup.js"
import { ScriptedPrompts } from "./support/scripted-prompts.js"

const SAVE = "$(check) Save and connect"
const CLUSTER = "12345678-90ab-cdef-1234-567890abcdef"
const TAKEN = new Set(["shop-dev"])
const SAAS_ANSWERS = [
  "bru-2",
  CLUSTER.toUpperCase(),
  "client-id",
  " s3cret ",
  "zeebe.camunda.io",
  "saas-bru-2",
  "Test",
]
const TOKENS = "http://localhost:18089/realms/pulse/protocol/openid-connect/token"

function inputOf(prompts: ScriptedPrompts, title: string) {
  const input = prompts.asked.find((asked) => asked.title.includes(`: ${title} (`))?.input
  if (input === undefined) {
    throw new Error(`no input box for ${title}`)
  }
  return input
}

async function asked(
  setup: SaasSetup | SelfManagedSetup,
  answers: readonly (string | undefined)[],
) {
  const prompts = new ScriptedPrompts(answers)
  const values = await new SetupSteps(prompts).ask(setup)
  return { prompts, values }
}

describe("the Camunda 8 SaaS steps", () => {
  test("ask each value with its step, then save what the review shows", async () => {
    const setup = new SaasSetup(TAKEN)
    const { prompts, values } = await asked(setup, [...SAAS_ANSWERS, SAVE])

    expect(prompts.titles()).toEqual([
      "Camunda 8 SaaS: Region (1/7)",
      "Camunda 8 SaaS: Cluster ID (2/7)",
      "Camunda 8 SaaS: Client ID (3/7)",
      "Camunda 8 SaaS: Client secret (4/7)",
      "Camunda 8 SaaS: Audience (5/7)",
      "Camunda 8 SaaS: Name (6/7)",
      "Camunda 8 SaaS: Environment (7/7)",
      "Camunda 8 SaaS: check the details",
    ])
    expect(prompts.asked.at(-1)?.items).toEqual([
      SAVE,
      "Region",
      "Cluster ID",
      "Client ID",
      "Client secret",
      "Audience",
      "Name",
      "Environment",
    ])
    expect(values).toEqual({
      region: "bru-2",
      clusterId: CLUSTER.toUpperCase(),
      clientId: "client-id",
      clientSecret: " s3cret ",
      audience: "zeebe.camunda.io",
      name: "saas-bru-2",
      environment: "test",
    })
    expect(setup.profileOf(values ?? {})).toEqual({
      url: `https://bru-2.api.camunda.io/${CLUSTER}/v2`,
      cockpitUrl: `https://bru-2.api.camunda.io/${CLUSTER}/operate`,
      flavor: "camunda8",
      auth: {
        type: "clientCredentials",
        tokenEndpoint: "https://login.cloud.camunda.io/oauth/token",
        audience: "zeebe.camunda.io",
      },
    })
    expect(setup.credentialsOf(values ?? {})).toEqual({ identity: "client-id", secret: " s3cret " })
  })

  test("suggest the audience and a name, mask the secret and say where Hub shows each value", async () => {
    const { prompts } = await asked(new SaasSetup(TAKEN), [...SAAS_ANSWERS, SAVE])

    expect(inputOf(prompts, "Audience").value).toBe("zeebe.camunda.io")
    expect(inputOf(prompts, "Name").value).toBe("saas-bru-2")
    expect(inputOf(prompts, "Client secret").password).toBe(true)
    expect(inputOf(prompts, "Region").prompt).toContain("CAMUNDA_CLUSTER_REGION")
    expect(inputOf(prompts, "Client secret").prompt).toContain(
      "sends it only to login.cloud.camunda.io",
    )
    expect(prompts.asked.at(-1)?.details?.[0]).toBe(
      "Writes .pulse-cli.json and keeps the secret in VS Code's secret storage.",
    )
  })

  test.each([
    ["Region", "BRU 2", "Enter the region in lowercase letters and digits, for example bru-2."],
    ["Region", "", "Enter the region in lowercase letters and digits, for example bru-2."],
    [
      "Cluster ID",
      "my-cluster",
      "Enter the cluster ID, a UUID such as 12345678-90ab-cdef-1234-567890abcdef.",
    ],
    ["Client ID", "  ", "Enter the client ID."],
    ["Client secret", "", "Enter the client secret."],
    ["Name", "-saas", 'Use letters, digits, ".", "_" and "-", and start with a letter or digit.'],
    ["Name", "shop-dev", "Pulse already reads an engine named shop-dev. Choose another name."],
  ])("refuse a %s of %j", async (title, value, problem) => {
    const { prompts } = await asked(new SaasSetup(TAKEN), [...SAAS_ANSWERS, SAVE])

    expect(inputOf(prompts, title).validate(value)).toBe(problem)
  })

  test("change a value from the review and keep the rest", async () => {
    const { values } = await asked(new SaasSetup(TAKEN), [...SAAS_ANSWERS, "Region", "jfk-1", SAVE])

    expect(values).toMatchObject({ region: "jfk-1", name: "saas-bru-2" })
  })

  test.each([0, 3, 6, 7])("stop without values when Escape ends step %i", async (step) => {
    const answers = [...SAAS_ANSWERS.slice(0, step), undefined]

    expect((await asked(new SaasSetup(TAKEN), answers)).values).toBeUndefined()
  })
})

describe("the Camunda 8 Self-Managed steps", () => {
  test("read OIDC client credentials with scopes and an audience, and no Operate link when empty", async () => {
    const setup = new SelfManagedSetup(TAKEN)
    const { prompts, values } = await asked(setup, [
      "http://localhost:18088/v2/",
      "",
      "OIDC client credentials",
      TOKENS,
      "camunda",
      "openid  profile",
      "pulse-reader",
      "reader-secret",
      "c8-localhost",
      "Leave it unclassified",
      SAVE,
    ])

    expect(prompts.titles().slice(0, 4)).toEqual([
      "Camunda 8 Self-Managed: REST address (1/5)",
      "Camunda 8 Self-Managed: Operate address (2/5)",
      "Camunda 8 Self-Managed: Login (3/5)",
      "Camunda 8 Self-Managed: Token endpoint (4/10)",
    ])
    expect(inputOf(prompts, "Operate address").value).toBe("http://localhost:18088/operate")
    expect(inputOf(prompts, "Name").value).toBe("c8-localhost")
    expect(setup.profileOf(values ?? {})).toEqual({
      url: "http://localhost:18088/v2",
      flavor: "camunda8",
      auth: {
        type: "clientCredentials",
        tokenEndpoint: TOKENS,
        scopes: ["openid", "profile"],
        audience: "camunda",
      },
    })
    expect(setup.credentialsOf(values ?? {})).toEqual({
      identity: "pulse-reader",
      secret: "reader-secret",
    })
  })

  test("read basic auth, and a login added from the review asks what it needs", async () => {
    const setup = new SelfManagedSetup(TAKEN)
    const { values } = await asked(setup, [
      "https://camunda.example.com/v2",
      "https://camunda.example.com/operate",
      "No login",
      "c8-camunda",
      "Production",
      "Login",
      "Basic auth",
      "reader",
      "reader-password",
      SAVE,
    ])

    expect(setup.profileOf(values ?? {})).toEqual({
      url: "https://camunda.example.com/v2",
      cockpitUrl: "https://camunda.example.com/operate",
      flavor: "camunda8",
      auth: { type: "basic" },
    })
    expect(setup.credentialsOf(values ?? {})).toEqual({
      identity: "reader",
      secret: "reader-password",
    })
    expect(values?.environment).toBe("production")
  })

  test("send nothing for an open API, and say so before saving", async () => {
    const setup = new SelfManagedSetup(TAKEN)
    const { prompts, values } = await asked(setup, [
      "http://localhost:18088/v2",
      "http://localhost:18088/operate",
      "No login",
      "c8-localhost",
      "Test",
      SAVE,
    ])

    expect(setup.profileOf(values ?? {})).toEqual({
      url: "http://localhost:18088/v2",
      cockpitUrl: "http://localhost:18088/operate",
      flavor: "camunda8",
    })
    expect(setup.credentialsOf(values ?? {})).toBeUndefined()
    expect(prompts.asked.at(-1)?.details?.[0]).toBe(
      "Writes .pulse-cli.json and reads the engine once.",
    )
  })

  test.each([
    ["REST address", "https://camunda.example.com", "End the address with /v2."],
    [
      "REST address",
      "ftp://camunda.example.com/v2",
      "Enter an http or https address without credentials, query or fragment.",
    ],
    ["Operate address", "https://camunda.example.com/op", "End the address with /operate."],
    ["Token endpoint", "keycloak", "Enter a token endpoint that is an http or https URL."],
    [
      "Scopes",
      'openid "profile"',
      "Separate distinct scopes with spaces. A scope has no quotes or backslashes.",
    ],
    [
      "Scopes",
      "openid openid",
      "Separate distinct scopes with spaces. A scope has no quotes or backslashes.",
    ],
  ])("refuse a %s of %j", async (title, value, problem) => {
    const { prompts } = await asked(new SelfManagedSetup(TAKEN), [
      "http://localhost:18088/v2",
      "",
      "OIDC client credentials",
      TOKENS,
      "",
      "",
      "pulse-reader",
      "reader-secret",
      "c8-localhost",
      "Test",
      SAVE,
    ])

    expect(inputOf(prompts, title).validate(value)).toBe(problem)
  })
})
