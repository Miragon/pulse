import { describe, expect, it } from "vitest"
import { translator, type T } from "../../messages/use-t.js"
import { instanceName, instanceTargetLines, writeFeedback } from "./write-feedback.js"

const tFor =
  (locale: "en" | "de"): T =>
  (key, params) =>
    translator(locale, key, params)

describe("instanceName", () => {
  it("names an instance by its business key, else by its short id", () => {
    expect(instanceName("5f0ce78e-6b1d-11ef-9c3a-0242ac120002", "LEA-2026-00424")).toBe(
      "LEA-2026-00424",
    )
    expect(instanceName("5f0ce78e-6b1d-11ef-9c3a-0242ac120002", null)).toBe("5f0ce78e…")
    expect(instanceName("pi-1")).toBe("pi-1")
  })
})

describe("instanceTargetLines", () => {
  it("leads with the business key, then the short id, never the bare UUID", () => {
    const id = "5f0ce78e-6b1d-11ef-9c3a-0242ac120002"
    expect(instanceTargetLines(tFor("de"), id, "LEA-2026-00424")).toEqual([
      ["Geschäftsschlüssel", "LEA-2026-00424"],
      ["Prozessinstanz", "5f0ce78e…"],
    ])
    expect(instanceTargetLines(tFor("en"), id, null)).toEqual([["Process instance", "5f0ce78e…"]])
  })
})

describe("writeFeedback: every write names its object (U9)", () => {
  const de = tFor("de")
  const en = tFor("en")

  it("job and external task retries", () => {
    expect(writeFeedback.jobRetry(de, "LEA-2026-00424")).toEqual({
      success: "Job für Instanz LEA-2026-00424 neu eingeplant",
      failure: "Job für Instanz LEA-2026-00424 konnte nicht neu eingeplant werden",
    })
    expect(writeFeedback.externalTaskRetry(en, "pi-1")).toEqual({
      success: "External task for instance pi-1 retried",
      failure: "Couldn't retry the external task for instance pi-1",
    })
  })

  it("resolve, cancel, suspend and activate", () => {
    expect(writeFeedback.resolve(de, "pi-1").success).toBe(
      "Incident in Instanz pi-1 als gelöst markiert",
    )
    expect(writeFeedback.cancel(en, "pi-1")).toEqual({
      success: "Instance pi-1 cancelled",
      failure: "Couldn't cancel instance pi-1",
    })
    expect(writeFeedback.suspension(de, "pi-1", true).success).toBe("Instanz pi-1 ausgesetzt")
    expect(writeFeedback.suspension(de, "pi-1", false).success).toBe("Instanz pi-1 aktiviert")
    expect(writeFeedback.suspension(en, "pi-1", false).failure).toBe(
      "Couldn't activate instance pi-1",
    )
  })

  it("a variable", () => {
    expect(writeFeedback.variable(de, "amount").success).toBe("Variable amount gespeichert")
  })

  it("a task: completed, or handed back to its owner when it was delegated", () => {
    const feedback = writeFeedback.completeTask(de, "Rechnung prüfen")
    const success = feedback.success as (result: object) => string
    expect(success({ outcome: "completed" })).toBe("Aufgabe Rechnung prüfen abgeschlossen")
    expect(success({ outcome: "resolved", assignee: "anna" })).toBe(
      "Aufgabe Rechnung prüfen an anna zurückgegeben",
    )
    // A resolved task without a known owner reads as completed words.
    expect(success({ outcome: "resolved", assignee: null })).toBe(
      "Aufgabe Rechnung prüfen abgeschlossen",
    )
    expect(feedback.failure).toBe("Aufgabe Rechnung prüfen konnte nicht abgeschlossen werden")
  })
})
