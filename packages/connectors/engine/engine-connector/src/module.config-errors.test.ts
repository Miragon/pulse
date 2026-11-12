import { describe, expect, it } from "vitest"
import { engineModule } from "./module.js"

/**
 * The boot prints a config error as one line (`runComposedServer`), so the error names the
 * variable to fix and, in a profile file, the profile: never the schema path, never a ZodError.
 * The wording of each profile problem is engine-profiles.test.ts's.
 */
describe("engineModule.configFromEnv names the variable a setting came from", () => {
  const errorOf = (env: NodeJS.ProcessEnv): Error => {
    try {
      engineModule.configFromEnv(env)
    } catch (error) {
      return error as Error
    }
    throw new Error("configFromEnv accepted the config")
  }

  it("throws a plain one-line error: no ZodError, no cause", () => {
    const error = errorOf({ ENGINE_BASE_URL: "localhost:8410/engine-rest" })
    expect(error.name).toBe("Error")
    expect(error.cause).toBeUndefined()
    expect(error.message).not.toContain("\n")
  })

  it.each([
    [
      { ENGINE_BASE_URL: "localhost:8410/engine-rest" },
      "ENGINE_BASE_URL: url must start with http:// or https://.",
    ],
    [
      { ENGINE_AUTH_TYPE: "Basic" },
      "ENGINE_AUTH_TYPE: auth.type must be one of none, basic, bearer, oauth, passthrough (the value is not shown).",
    ],
    [{ ENGINE_INCIDENT_ISSUE_REPO: "acme" }, "ENGINE_INCIDENT_ISSUE_REPO: Expected `owner/repo`"],
    [
      { ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE: "0" },
      "ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE: Too small: expected number to be >0",
    ],
  ])("the single engine and the settings: %o", (env, message) => {
    expect(errorOf(env).message).toBe(message)
  })

  it("keeps a message that names its variable already", () => {
    expect(errorOf({ ENGINE_REQUEST_TIMEOUT_MS: "30s" }).message).toBe(
      "ENGINE_REQUEST_TIMEOUT_MS must be a whole number of milliseconds",
    )
    expect(errorOf({ ENGINE_AUTH_TYPE: "basic", ENGINE_USERNAME: "demo" }).message).toBe(
      "ENGINE_AUTH_TYPE=basic needs ENGINE_USERNAME and ENGINE_PASSWORD; otherwise engine requests would run unauthenticated.",
    )
  })

  it("names the profile file and each profile that keeps it from running", () => {
    const profiles = {
      a: { url: "http://a/engine-rest", engine: "orders" },
      b: { url: "b:8080/engine-rest" },
    }
    expect(errorOf({ ENGINES_JSON: JSON.stringify({ profiles }) }).message).toBe(
      'ENGINES_JSON: no profile is usable. Profile "a" (ENGINES_JSON) is refused: engine names a process engine this server does not reach: it reaches only "default". Profile "b" (ENGINES_JSON) is refused: url must start with http:// or https://.',
    )
  })
})

/** `localhost:8410/engine-rest` parses as a URL with the scheme `localhost:`: every call then failed as a network error. */
describe("engine URLs are http(s) only, without credentials, a query or a fragment", () => {
  /** True when a profile with `url` (and `cockpitUrl`) boots. */
  const boots = (url: string, cockpitUrl?: string) => {
    const profile = { url, ...(cockpitUrl === undefined ? {} : { cockpitUrl }) }
    try {
      engineModule.configFromEnv({ ENGINES_JSON: JSON.stringify({ profiles: { a: profile } }) })
      return true
    } catch {
      return false
    }
  }

  it.each([
    "http://localhost:8410/engine-rest",
    "https://engine.example.com/engine-rest",
    "http://engine:8080/engine-rest",
    "http://10.0.0.1:8080/engine-rest",
    "http://[::1]:8080/engine-rest",
    "https://engine.example.com/engine-rest/",
  ])("accepts %s", (url) => {
    expect(boots(url)).toBe(true)
    expect(boots("http://a/engine-rest", url)).toBe(true)
  })

  it("takes a web app address with the start route of a single-page app, which a link replaces", () => {
    expect(boots("http://a/engine-rest", "https://engine.example.com/webapp/#/")).toBe(true)
  })

  it.each([
    "localhost:8410/engine-rest",
    "host.docker.internal:8410/engine-rest",
    "engine.example.com/engine-rest",
    "ftp://engine.example.com/engine-rest",
    "http://",
    // The CLI's and VS Code's rule. `fetch` throws on credentials, quoting the URL to the model.
    "https://svc:pw@engine.example.com/engine-rest",
    "https://svc@engine.example.com/engine-rest",
    "http:svc:pw@engine.example.com/engine-rest",
    " https://svc:pw@engine.example.com/engine-rest ",
    "https://engine.example.com/engine-rest?token=x",
    "https://engine.example.com/engine-rest?",
    "https://engine.example.com/engine-rest#x",
  ])("refuses %s for the REST root and the cockpit link", (url) => {
    expect(boots(url)).toBe(false)
    expect(boots("http://a/engine-rest", url)).toBe(false)
  })
})
