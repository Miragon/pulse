import { describe, expect, test } from "vitest"
import { TargetsParser } from "../../src/host/connections/targets-parser.js"

const FILE = "/work/.pulse-cli.json"
const URL = "http://localhost:8080/engine-rest"

function problemsOf(profiles: Record<string, unknown>, root: Record<string, unknown> = {}) {
  const parsed = new TargetsParser(FILE).parse(JSON.stringify({ ...root, profiles }))
  return {
    targets: parsed.targets.map((target) => target.name),
    problems: parsed.problems.map((problem) => [problem.message, problem.severity]),
  }
}

describe("a project file the extension reads", () => {
  test("names no credential: a secret or the variable that holds it is a problem, never a target", () => {
    const shared =
      "is set, but a file others share names no credential, neither a secret nor the variable that holds one."
    expect(
      problemsOf({
        variable: { url: URL, auth: { type: "basic", username: "demo", passwordEnv: "PW" } },
        secret: { url: URL, auth: { type: "basic", username: "demo", password: "S3cret" } },
        sso: { url: URL, auth: { type: "oauth", clientId: "c", clientSecretEnv: "CS" } },
        ok: { url: URL, auth: { type: "basic", username: "demo" } },
      }),
    ).toEqual({
      targets: ["ok"],
      problems: [
        [`profile "variable": auth.passwordEnv ${shared}`, undefined],
        [`profile "secret": auth.password ${shared}`, undefined],
        [`profile "sso": auth.clientSecretEnv ${shared}`, undefined],
      ],
    })
  })

  test("refuses headers and the MCP server's passthrough instead of ignoring them", () => {
    expect(
      problemsOf({
        tenant: { url: URL, headers: { "X-Tenant-Id": "acme" } },
        gateway: { url: URL, auth: { type: "passthrough" } },
      }),
    ).toEqual({
      targets: [],
      problems: [
        [
          'profile "tenant": This client does not apply headers, so it refuses the profile rather than ignore it.',
          undefined,
        ],
        ['profile "gateway": This client cannot authenticate with this auth.type.', undefined],
      ],
    })
  })

  test("shows what is off at the root as a warning, and names a profile of an invalid name by its position", () => {
    expect(
      problemsOf(
        { local: { url: URL }, "pa55 word": { url: URL } },
        { defaultProfile: "prod", default: "local" },
      ),
    ).toEqual({
      targets: ["local"],
      problems: [
        [
          "default is no key of a profile file, which holds $schema, defaultProfile and profiles.",
          "warning",
        ],
        ["defaultProfile names no profile of this file.", "warning"],
        [
          'profile 2: The profile\'s name is not valid (it is not shown): use letters, digits, ".", "_" and "-", starting with a letter or digit.',
          undefined,
        ],
      ],
    })
  })
})
