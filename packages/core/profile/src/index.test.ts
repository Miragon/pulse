import { describe, expect, it } from "vitest"
import * as profile from "./index.js"
import * as testing from "./testing/index.js"

/** The published entries' lists: knip never reports what an entry exports, so they are held here. */
describe("the @miragon/pulse-profile entries", () => {
  // The single-value rules (isUsername, isTimeout, ...) are exported because a reader applies them
  // to what replaces a profile's value too: the CLI to its flags and its environment.
  it("export exactly the parser, the rules the readers share and the vocabulary", () => {
    expect(Object.keys(profile).sort()).toEqual(
      [
        "AUTH_KEYS",
        "AUTH_TYPES",
        "BASIC_AUTH_KEYS",
        "BEARER_AUTH_KEYS",
        "CREDENTIAL_POLICIES",
        "DEFAULT_FLAVOR",
        "ENVIRONMENT_ID",
        "ENV_NAME",
        "FLAVORS",
        "MAX_TIMEOUT_MS",
        "OAUTH_AUTH_KEYS",
        "OUTPUT_FORMATS",
        "PROBLEM_CODES",
        "PROFILE_KEYS",
        "PROFILE_NAME",
        "ROOT_KEYS",
        "SECRET_KEYS",
        "SECRET_VARIABLE_PREFIX",
        "VARIABLE_KEYS",
        "authTypeOf",
        "credentialsInClearText",
        "defaultProfileOf",
        "describeProblem",
        "dialectOf",
        "isConventionalVariable",
        "isEngineName",
        "isHeaderName",
        "isHeaderValue",
        "isLoopbackHost",
        "isRedirectPort",
        "isScopeList",
        "isSecretHeader",
        "isTimeout",
        "isUsername",
        "jsonErrorPosition",
        "normalizeCockpitUrl",
        "normalizeUrl",
        "parseProfileFile",
        "refusalsOn",
        "urlProblem",
      ].sort(),
    )
  })

  it("export the fixtures and the form they compare in from ./testing", () => {
    expect(Object.keys(testing).sort()).toEqual(["PROFILE_FIXTURES", "outcomeOf", "problemLabel"])
  })

  it("map each flavor to the dialect it speaks: one dialect today", () => {
    expect(profile.FLAVORS).toEqual({ camunda7: "c7", cibseven: "c7", operaton: "c7" })
  })
})
