import { describe, expect, test } from "vitest"
import { ConfirmationPolicy } from "../../src/host-kit/connections/confirmation-policy.js"
import type { EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { EnvironmentClassifier } from "../../src/host-kit/connections/environment-classifier.js"
import { ProfileSource } from "../../src/host-kit/connections/profile-source.js"
import { TargetsParser } from "../../src/host-kit/connections/targets-parser.js"

const USER_CONFIG = "/home/dev/.config/pulse-cli/config.json"
const NONE = { user: undefined, workspace: [] }

const USER_CONFIG_TEXT = JSON.stringify({
  defaultProfile: "prod-a",
  profiles: {
    "prod-a": {
      url: "http://localhost:8410/engine-rest",
      flavor: "cibseven",
      environment: "prod-eu",
    },
    "prod-b": {
      url: "http://localhost:8411/engine-rest",
      flavor: "cibseven",
      environment: "prod-us",
      readOnly: true,
    },
    dev: { url: "http://localhost:8080/engine-rest" },
  },
})

function targetsOf(text: string, source = ProfileSource.USER_CONFIG): readonly EngineTarget[] {
  return new TargetsParser(USER_CONFIG, source).parse(text).targets
}

function targetNamed(name: string): EngineTarget {
  const target = targetsOf(USER_CONFIG_TEXT).find((candidate) => candidate.name === name)
  if (target === undefined) {
    throw new Error(`no target ${name}`)
  }
  return target
}

function at(endpoint: string, environment: string): EngineTarget {
  const text = JSON.stringify({ profiles: { x: { url: endpoint, environment } } })
  const [target] = targetsOf(text, ProfileSource.PROJECT)
  if (target === undefined) {
    throw new Error(`no target at ${endpoint}`)
  }
  return target
}

describe("a profile's environment, in the CLI's user config or a project file", () => {
  test("travels with its target, and a profile without one carries none", () => {
    expect(targetNamed("prod-a").environment).toBe("prod-eu")
    expect(targetNamed("prod-b").environment).toBe("prod-us")
    expect(targetNamed("dev")).not.toHaveProperty("environment")
    expect(at("http://localhost:8080/engine-rest", "test").environment).toBe("test")
  })

  test("keeps an engine on this machine from LOCAL when it names another environment", () => {
    for (const name of ["prod-a", "prod-b"]) {
      const target = targetNamed(name)
      expect(EnvironmentClassifier.classify(target, NONE), name).toBe("unclassified")
      expect(ConfirmationPolicy.confirmationFor(target, NONE, "retryIncident"), name).toBe(
        "typeHost",
      )
    }
    expect(EnvironmentClassifier.classify(targetNamed("dev"), NONE)).toBe("local")
    expect(ConfirmationPolicy.confirmationFor(targetNamed("dev"), NONE, "retryIncident")).toBe(
      "none",
    )
  })

  test.each([
    ["local", "local", "none"],
    ["test", "test", "modal"],
    ["production", "production", "typeHost"],
    ["staging", "unclassified", "typeHost"],
  ] as const)("reads %s on this machine as %s", (environment, classified, confirmation) => {
    const target = at("http://127.0.0.1:8080/engine-rest", environment)
    expect(EnvironmentClassifier.classify(target, NONE)).toBe(classified)
    expect(ConfirmationPolicy.confirmationFor(target, NONE, "retryIncident")).toBe(confirmation)
  })

  test("only raises: a remote engine stays unclassified, and no setting lowers it", () => {
    const remote = at("https://prod.example.com/engine-rest", "test")
    expect(EnvironmentClassifier.classify(remote, NONE)).toBe("unclassified")
    expect(at("https://prod.example.com/engine-rest", "local").environment).toBe("local")
    expect(
      EnvironmentClassifier.classify(at("https://prod.example.com/engine-rest", "local"), NONE),
    ).toBe("unclassified")
    const prodA = targetNamed("prod-a")
    for (const said of ["local", "test"]) {
      const settings = { user: { "prod-a": said }, workspace: [{ "prod-a": said }] }
      expect(EnvironmentClassifier.classify(prodA, settings), said).toBe("unclassified")
      expect(ConfirmationPolicy.confirmationFor(prodA, settings, "retryIncident"), said).toBe(
        "typeHost",
      )
    }
  })

  test("is production where a setting marks it, as any engine", () => {
    const prodA = targetNamed("prod-a")
    expect(
      EnvironmentClassifier.classify(prodA, { user: { "prod-a": "production" }, workspace: [] }),
    ).toBe("production")
    expect(
      EnvironmentClassifier.classify(prodA, {
        user: undefined,
        workspace: [{ "prod-a": "production" }],
      }),
    ).toBe("production")
    expect(
      EnvironmentClassifier.classify(at("http://localhost:8080/engine-rest", "test"), {
        user: undefined,
        workspace: [{ x: "production" }],
      }),
    ).toBe("production")
  })

  test("names no environment for a target without one, or with local", () => {
    expect(EnvironmentClassifier.namedByProfile(targetNamed("dev"))).toBeUndefined()
    expect(
      EnvironmentClassifier.namedByProfile(at("http://localhost:8080/engine-rest", "local")),
    ).toBeUndefined()
    expect(EnvironmentClassifier.namedByProfile(targetNamed("prod-b"))).toBe("unclassified")
  })
})
