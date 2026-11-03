import { describe, expect, it } from "vitest"
import { engineModule } from "./module.js"
import {
  RETIRED_CREDENTIAL_ENV_VARS,
  RETIRED_ENV_VARS,
  RETIRED_MODULE_NAMES,
} from "./retired-settings.js"

const ALL_RETIRED: Readonly<Record<string, string>> = {
  ...RETIRED_ENV_VARS,
  ...RETIRED_CREDENTIAL_ENV_VARS,
}
const retired = Object.keys(ALL_RETIRED)
const known: readonly string[] = engineModule.knownEnvVars

describe("the retired camunda7 settings", () => {
  it("retires exactly the sixteen server variables of 0.24", () => {
    expect(retired.sort()).toEqual(
      [
        "CAMUNDA_ALLOW_DEPLOYMENTS",
        "CAMUNDA_AUTH_TYPE",
        "CAMUNDA_BASE_URL",
        "CAMUNDA_COCKPIT_URL",
        "CAMUNDA_DEFAULT_ENGINE",
        "CAMUNDA_ENGINES_FILE",
        "CAMUNDA_ENGINES_JSON",
        "CAMUNDA_ENGINE_FLAVOR",
        "CAMUNDA_ENGINE_ID",
        "CAMUNDA_HEALTH_CRITICAL_CLUSTER_SIZE",
        "CAMUNDA_HEALTH_CRITICAL_INCIDENTS",
        "CAMUNDA_INCIDENT_ISSUE_REPO",
        "CAMUNDA_PASSWORD",
        "CAMUNDA_REQUEST_TIMEOUT_MS",
        "CAMUNDA_TOKEN",
        "CAMUNDA_USERNAME",
      ].sort(),
    )
  })

  it("warns on the three credentials and refuses the other thirteen", () => {
    expect(Object.keys(RETIRED_CREDENTIAL_ENV_VARS).sort()).toEqual([
      "CAMUNDA_PASSWORD",
      "CAMUNDA_TOKEN",
      "CAMUNDA_USERNAME",
    ])
    expect(Object.keys(RETIRED_ENV_VARS)).toHaveLength(13)
    for (const name of Object.keys(RETIRED_CREDENTIAL_ENV_VARS)) {
      expect(Object.keys(RETIRED_ENV_VARS)).not.toContain(name)
    }
  })

  it("names a replacement the module reads for each, every one distinct", () => {
    const replacements = Object.values(ALL_RETIRED)
    for (const replacement of replacements) expect(known).toContain(replacement)
    expect(new Set(replacements).size).toBe(replacements.length)
    expect(replacements.length).toBe(known.length)
  })

  it("leaves no variable of the old family read", () => {
    expect(known.filter((name) => name.startsWith("CAMUNDA_"))).toEqual([])
  })

  it("collapses a doubled word and keeps every other name after the family", () => {
    for (const [from, to] of Object.entries(ALL_RETIRED)) {
      const rest = from.slice("CAMUNDA_".length)
      if (from === "CAMUNDA_DEFAULT_ENGINE") expect(to).toBe("ENGINE_DEFAULT")
      else if (rest.startsWith("ENGINE_") || rest.startsWith("ENGINES_")) expect(to).toBe(rest)
      else expect(to).toBe(`ENGINE_${rest}`)
    }
  })

  it("hands the boot the table and the former module name", () => {
    expect(engineModule.retired).toEqual({
      names: RETIRED_MODULE_NAMES,
      envVars: RETIRED_ENV_VARS,
      warnedEnvVars: RETIRED_CREDENTIAL_ENV_VARS,
    })
    expect(RETIRED_MODULE_NAMES).not.toContain(engineModule.name)
  })
})
