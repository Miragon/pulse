import { describe, expect, it } from "vitest"
import { BUILT_IN_INCIDENT_TYPES, incidentRecovery } from "./incident-recovery.js"

describe("incidentRecovery — built-in incidents are retried, never resolved", () => {
  it("names exactly the two engine-raised types", () => {
    expect(BUILT_IN_INCIDENT_TYPES).toEqual(["failedJob", "failedExternalTask"])
  })

  it("retries the failed job a failedJob incident points at", () => {
    expect(incidentRecovery({ incidentType: "failedJob", configuration: "job-1" })).toEqual({
      action: "retry-job",
      jobId: "job-1",
    })
  })

  it("retries the external task a failedExternalTask incident points at", () => {
    expect(
      incidentRecovery({ incidentType: "failedExternalTask", configuration: "ext-1" }),
    ).toEqual({ action: "retry-external-task", externalTaskId: "ext-1" })
  })

  it.each([null, undefined, ""])(
    "offers nothing for a built-in incident without configuration %j (propagated: act on the root cause)",
    (configuration) => {
      expect(incidentRecovery({ incidentType: "failedJob", configuration })).toEqual({
        action: "none",
      })
      expect(incidentRecovery({ incidentType: "failedExternalTask", configuration })).toEqual({
        action: "none",
      })
    },
  )

  it("resolves custom incident types", () => {
    expect(incidentRecovery({ incidentType: "invoiceMismatch", configuration: "x" })).toEqual({
      action: "resolve",
    })
    expect(incidentRecovery({ incidentType: null })).toEqual({ action: "resolve" })
  })
})
