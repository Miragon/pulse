import { describe, expect, it } from "vitest"
import { parseProfileFile } from "./parse.js"
import { authTypeOf, dialectOf, refusalsOn, type Surface } from "./surface.js"
import { PROFILE_FIXTURES, problemLabel } from "./testing/index.js"
import type { CredentialPolicy, Profile } from "./types.js"

/** Surfaces as the readers would state them: a sample, not their own constants. */
const CLI: Surface = {
  dialects: ["c7"],
  authTypes: ["none", "basic", "bearer", "oauth"],
  urlRequired: false,
  defaultEngineOnly: false,
  refusedKeys: [],
}
const VSCODE: Surface = {
  dialects: ["c7"],
  authTypes: ["none", "basic", "oauth"],
  urlRequired: true,
  defaultEngineOnly: true,
  refusedKeys: ["headers"],
}
const SERVER: Surface = {
  dialects: ["c7"],
  authTypes: ["none", "basic", "bearer", "passthrough"],
  urlRequired: true,
  defaultEngineOnly: true,
  refusedKeys: ["headers"],
}

/** Each usable profile of a fixture with what `surface` refuses of it. */
function refusals(fixture: string, policy: CredentialPolicy, surface: Surface) {
  const text = PROFILE_FIXTURES.find(({ name }) => name === fixture)?.text ?? ""
  const file = parseProfileFile(text, { credentials: policy })
  return Object.fromEntries(
    file.profiles.flatMap(({ name, profile }) =>
      name === undefined || profile === undefined
        ? []
        : [[name, refusalsOn(profile, surface).map(problemLabel)]],
    ),
  )
}

describe("refusalsOn", () => {
  it("lets each reader refuse what it cannot serve of the operator's profiles", () => {
    expect(refusals("operator-file", "env", SERVER)).toEqual({
      local: [],
      "prod-a": [],
      "prod-b": [],
      staging: [],
      "dev.sso": ["auth-type-not-served auth.type", "process-engine-not-served engine"],
    })
    expect(refusals("operator-file", "env-or-literal", CLI)).toEqual({
      local: [],
      "prod-a": [],
      "prod-b": [],
      staging: ["auth-type-not-served auth.type"],
      "dev.sso": [],
    })
  })

  it("refuses a profile without url where a reader needs one, and headers it cannot send", () => {
    expect(refusals("url-optional", "none", VSCODE)).toEqual({ nowhere: ["url-missing url"] })
    expect(refusals("url-optional", "none", CLI)).toEqual({ nowhere: [] })
    expect(refusals("every-profile-key", "none", SERVER)).toEqual({
      shop: ["key-not-served headers"],
    })
    expect(refusals("engines", "none", VSCODE)).toEqual({
      default: [],
      padded: [],
      orders: ["process-engine-not-served engine"],
    })
  })

  it("refuses a dialect the reader does not speak", () => {
    const profile: Profile = { url: "http://a:8080", flavor: "operaton" }
    expect(refusalsOn(profile, { ...SERVER, dialects: [] })).toEqual([
      { code: "dialect-not-served", key: "flavor" },
    ])
  })
})

describe("what a profile uses", () => {
  it("speaks its flavor's dialect, camunda7's without one", () => {
    expect(dialectOf({})).toBe("c7")
    expect(dialectOf({ flavor: "cibseven" })).toBe("c7")
  })

  it("authenticates with its type, else Basic auth with a username, else none", () => {
    expect(authTypeOf({})).toBe("none")
    expect(authTypeOf({ auth: {} })).toBe("none")
    expect(authTypeOf({ auth: { username: "demo" } })).toBe("basic")
    expect(authTypeOf({ auth: { type: "none", username: "demo" } })).toBe("none")
    expect(authTypeOf({ auth: { type: "passthrough" } })).toBe("passthrough")
  })
})
