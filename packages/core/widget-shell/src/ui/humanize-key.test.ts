import { describe, expect, it } from "vitest"
import { humanizeKey } from "./humanize-key.js"

/** #322 U18: derived headers in sentence case. */
describe("humanizeKey", () => {
  it.each([
    ["totalIncidents", "Total incidents"],
    ["processDefinitionKey", "Process definition key"],
    ["process", "Process"],
    ["running", "Running"],
    ["process_definition_key", "Process definition key"],
    ["incident-count", "Incident count"],
    ["__private__key", "Private key"],
    ["Total", "Total"],
    ["TotalIncidents", "Total incidents"],
    ["p95Latency", "P95 latency"],
    ["latencyP95", "Latency P95"],
    ["errorRate2h", "Error rate2h"],
    ["processURLKey", "Process URL key"],
    ["slaURL", "Sla URL"],
    ["ID", "ID"],
    ["id", "Id"],
    ["pageX", "Page x"],
    ["UPPER_CASE_KEY", "UPPER CASE KEY"],
  ])("%s → %s", (key, header) => {
    expect(humanizeKey(key)).toBe(header)
  })

  it("keeps a key that already reads as words, as written", () => {
    expect(humanizeKey("Open incidents")).toBe("Open incidents")
    expect(humanizeKey("Offene Incidents")).toBe("Offene Incidents")
    expect(humanizeKey("  SLA breaches ")).toBe("SLA breaches")
    expect(humanizeKey("Open  incidents")).toBe("Open  incidents")
  })

  it("keeps a key without any word in it", () => {
    expect(humanizeKey("_")).toBe("_")
    expect(humanizeKey("-")).toBe("-")
    expect(humanizeKey(" ")).toBe(" ")
  })
})
