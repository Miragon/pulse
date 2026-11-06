import { describe, expect, test } from "vitest"
import { ProjectFileEdit } from "../../src/host/connections/project-file-edit.js"

const SAAS = {
  name: "saas-bru-2",
  profile: { url: "https://bru-2.api.camunda.io/cluster/v2", flavor: "camunda8" },
}

function written(file: unknown): { readonly text: string } {
  return { text: `${JSON.stringify(file, undefined, 2)}\n` }
}

describe("adding a profile to the project file", () => {
  test("starts a file when the folder has none", () => {
    expect(ProjectFileEdit.withProfile(undefined, SAAS)).toEqual(
      written({ profiles: { "saas-bru-2": SAAS.profile } }),
    )
  })

  test("appends it, keeps the other profiles as they are and never touches the default", () => {
    const current = JSON.stringify({
      profiles: { local: { url: "http://localhost:8080/engine-rest", auth: { type: "basic" } } },
      defaultProfile: "local",
      $schema: "https://unpkg.com/@miragon/pulse-cli/schema/project-file.schema.json",
    })

    expect(ProjectFileEdit.withProfile(current, SAAS)).toEqual(
      written({
        $schema: "https://unpkg.com/@miragon/pulse-cli/schema/project-file.schema.json",
        defaultProfile: "local",
        profiles: {
          local: { url: "http://localhost:8080/engine-rest", auth: { type: "basic" } },
          "saas-bru-2": SAAS.profile,
        },
      }),
    )
  })

  test("keeps a root key the CLI doesn't know after the ones it does", () => {
    expect(ProjectFileEdit.withProfile('{"note":"x","profiles":{}}', SAAS)).toEqual(
      written({ profiles: { "saas-bru-2": SAAS.profile }, note: "x" }),
    )
  })

  test.each([
    ["{", "isn't valid JSON"],
    ["[]", "doesn't hold a JSON object"],
    ['{"profiles":[]}', "has profiles that are not an object"],
    ['{"profiles":{"saas-bru-2":{}}}', "already has a profile named saas-bru-2"],
  ])("leaves %s as it is: the file %s", (current, problem) => {
    expect(ProjectFileEdit.withProfile(current, SAAS)).toEqual({ problem })
  })

  test("replaces the profile it wrote before in place, and drops it when the name changed", () => {
    const current = JSON.stringify({ profiles: { "saas-bru-2": {}, local: {} } })

    expect(ProjectFileEdit.withProfile(current, SAAS, "saas-bru-2")).toEqual(
      written({ profiles: { "saas-bru-2": SAAS.profile, local: {} } }),
    )
    expect(ProjectFileEdit.withProfile(current, { ...SAAS, name: "saas" }, "saas-bru-2")).toEqual(
      written({ profiles: { local: {}, saas: SAAS.profile } }),
    )
  })
})
