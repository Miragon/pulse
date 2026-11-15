import { describe, expect, test } from "vitest"
import { ConfirmationPolicy } from "../../src/host-kit/connections/confirmation-policy.js"
import type { EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { EnvironmentClassifier } from "../../src/host-kit/connections/environment-classifier.js"
import { TargetHosts } from "../../src/host-kit/connections/target-hosts.js"
import { TargetPolicy } from "../../src/host-kit/connections/target-policy.js"
import { WritePolicy } from "../../src/host-kit/connections/write-policy.js"
import { LOCAL_TARGET } from "./support/local-target.js"

const WORDING = { setting: "the writes setting", enableOnRemote: "Allow writes on remote engines" }
const NONE = { kind: "none" } as const
const NO_SETTINGS = { user: undefined, workspace: [] }

function at(endpoint: string): EngineTarget {
  return { ...LOCAL_TARGET, name: "dev", endpoint, auth: { kind: "basic" } }
}

const LITERAL = ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"].map(at)
const LOOPBACK_RANGE = at("http://127.0.0.2:8080/engine-rest")

describe("an engine on this machine, for writes and the LOCAL badge", () => {
  test.each(LITERAL)("is $endpoint", (target) => {
    expect(TargetHosts.isLoopback(target)).toBe(true)
    expect(WritePolicy.access(target, "localOnly", NONE, WORDING).writable).toBe(true)
    expect(EnvironmentClassifier.classify(target, NO_SETTINGS)).toBe("local")
    expect(ConfirmationPolicy.confirmationFor(target, NO_SETTINGS, "retryIncident")).toBe("none")
  })

  test("is never another address of 127.0.0.0/8, whatever the settings say", () => {
    const saidLocal = { user: { dev: "local" }, workspace: [] }

    expect(TargetHosts.isLoopback(LOOPBACK_RANGE)).toBe(false)
    expect(WritePolicy.access(LOOPBACK_RANGE, "localOnly", NONE, WORDING).writable).toBe(false)
    expect(EnvironmentClassifier.classify(LOOPBACK_RANGE, saidLocal)).toBe("unclassified")
    expect(ConfirmationPolicy.confirmationFor(LOOPBACK_RANGE, saidLocal, "retryIncident")).toBe(
      "typeHost",
    )
  })
})

describe("a login over plain HTTP", () => {
  test.each([
    "http://localhost:8080/engine-rest",
    "http://127.0.0.2:8080/engine-rest",
    "http://127.255.0.1/engine-rest",
    "http://[::1]/engine-rest",
  ])("stays on the loopback interface the profile format names: %s", (endpoint) => {
    expect(TargetHosts.inClearText(endpoint)).toBe(false)
    expect(TargetPolicy.refusal(at(endpoint), NONE)).toBeUndefined()
  })

  test.each(["http://128.0.0.1/engine-rest", "http://localhost.example.com/engine-rest"])(
    "is clear text beyond it: %s",
    (endpoint) => {
      expect(TargetHosts.inClearText(endpoint)).toBe(true)
      expect(TargetPolicy.refusal(at(endpoint), NONE)).toBe(
        "dev would send basic credentials over plain HTTP. Use an https endpoint.",
      )
    },
  )

  test("is never clear text over https", () => {
    expect(TargetHosts.inClearText("https://shop.example.com/engine-rest")).toBe(false)
  })
})
