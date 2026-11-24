import { describe, expect, it } from "vitest"
import { translate } from "../src/messages.ts"

describe("the page's words for a count", () => {
  it("say the incidents in called instances as incidents: the count is of the copies at the call", () => {
    // One called instance with two open incidents leaves two copies at its call activity.
    expect(translate("en", "incidents.called", { activity: "Assess", count: "2" })).toBe(
      "Assess: 2 incidents in called instances, counted in the called process.",
    )
    expect(translate("en", "incidents.called", { activity: "Assess", count: "1" })).toBe(
      "Assess: 1 incident in called instances, counted in the called process.",
    )
    expect(translate("de", "incidents.called", { activity: "Prüfen", count: "2" })).toBe(
      "Prüfen: 2 Incidents in aufgerufenen Instanzen, gezählt im aufgerufenen Prozess.",
    )
    expect(translate("de", "incidents.called", { activity: "Prüfen", count: "1" })).toBe(
      "Prüfen: 1 Incident in aufgerufenen Instanzen, gezählt im aufgerufenen Prozess.",
    )
  })
})
