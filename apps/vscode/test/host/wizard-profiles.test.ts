import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { ProjectFileEdit } from "../../src/host/connections/project-file-edit.js"
import { SaasSetup } from "../../src/host/connections/saas-setup.js"
import { SelfManagedSetup } from "../../src/host/connections/self-managed-setup.js"
import type { SetupValues } from "../../src/host/connections/setup-field.js"

const FIXTURE = new URL(
  "../../../cli/test/fixtures/project-file/valid-wizard-profiles.json",
  import.meta.url,
)
const SCHEMA = "https://unpkg.com/@miragon/pulse-cli/schema/project-file.schema.json"
const TAKEN: ReadonlySet<string> = new Set()
const SAAS = new SaasSetup(TAKEN)
const SELF_MANAGED = new SelfManagedSetup(TAKEN)
const OIDC: SetupValues = {
  url: "https://camunda.example.com/v2",
  operateUrl: "https://camunda.example.com/operate",
  login: "oidc",
  tokenEndpoint: "https://keycloak.example.com/realms/camunda/protocol/openid-connect/token",
  audience: "camunda",
  scopes: "api://camunda/.default",
  clientId: "pulse",
  clientSecret: "secret",
}
const WIZARD: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
  [
    "saas-bru-2",
    SAAS.profileOf({
      region: "bru-2",
      clusterId: "12345678-90ab-cdef-1234-567890abcdef",
      clientId: "client",
      clientSecret: "secret",
      audience: "zeebe.camunda.io",
    }),
  ],
  [
    "c8-open",
    SELF_MANAGED.profileOf({
      url: "http://localhost:18088/v2",
      operateUrl: "http://localhost:18088/operate",
      login: "none",
    }),
  ],
  [
    "c8-basic",
    SELF_MANAGED.profileOf({
      url: "https://camunda.example.com/v2/",
      operateUrl: "",
      login: "basic",
      username: "reader",
      password: "secret",
    }),
  ],
  ["c8-oidc", SELF_MANAGED.profileOf(OIDC)],
]

function textOf(file: unknown): string {
  return `${JSON.stringify(file, undefined, 2)}\n`
}

describe("the profiles the Add Engine wizard writes", () => {
  test("are byte for byte the CLI's fixture, which its parser and schema check", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { readonly file: unknown }
    const start = textOf({
      $schema: SCHEMA,
      defaultProfile: "local",
      profiles: { local: { url: "http://localhost:8080/engine-rest" } },
    })

    const written = WIZARD.reduce((current, [name, profile]) => {
      const edition = ProjectFileEdit.withProfile(current, { name, profile })
      if ("problem" in edition) {
        throw new Error(`${name}: ${edition.problem}`)
      }
      return edition.text
    }, start)

    expect(written).toBe(textOf(fixture.file))
  })

  test("never hold a client ID, secret, username or password", () => {
    const profiles = JSON.stringify(WIZARD)

    expect(profiles).not.toMatch(/secret|"pulse"|"client"|reader/)
  })
})
