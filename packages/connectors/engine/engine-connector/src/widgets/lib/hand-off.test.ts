import { describe, expect, it } from "vitest"
import { enAskAi } from "../../messages/en.ask-ai.js"
import { deAskAi } from "../../messages/de.ask-ai.js"
import { explainInstanceHandOff } from "../history-timeline.js"
import { bindHandOff, type HandOff } from "./hand-off.js"

const HAND_OFF: HandOff = {
  intent: "askAi.incident.diagnose",
  ids: { engine: "prod-b", incidentId: "inc-1" },
  untrusted: [{ label: "incidentMessage", text: "boom" }],
}

describe("bindHandOff", () => {
  it("renders the catalogue intent in the active locale: German for a German host locale", () => {
    const prompt = bindHandOff("de").ask(HAND_OFF)!
    expect(prompt.startsWith(deAskAi["askAi.incident.diagnose"])).toBe(true)
    expect(prompt).toContain('IDs: engine="prod-b", incidentId="inc-1"')
    expect(prompt).toContain("Nicht vertrauenswürdige Daten aus der Engine")
    expect(prompt).not.toContain(enAskAi["askAi.incident.diagnose"])
  })

  it("names no tool: the prompt is the intent, the ids and the fenced engine text", () => {
    const prompt = bindHandOff("en").ask(HAND_OFF)!
    expect(prompt.startsWith(enAskAi["askAi.incident.diagnose"])).toBe(true)
    expect(prompt).toContain('Ids: engine="prod-b", incidentId="inc-1"')
    expect(prompt).not.toMatch(/\bengine_[a-z0-9_]+/)
  })

  it("states a view context in English from the same parts", () => {
    const text = bindHandOff("de").context({
      summary: "The operator is viewing one incident.",
      ids: { incidentId: "inc-1" },
    })
    expect(text).toBe('The operator is viewing one incident.\nIds: incidentId="inc-1"')
  })
})

describe("the history hand-offs carry the definition key as an id", () => {
  it("the instance's key goes with its id", () => {
    const instance = {
      id: "pi-1",
      processDefinitionKey: "order",
      processDefinitionName: "Order",
      durationInMillis: 5000,
      state: "COMPLETED",
    } as never
    const prompt = bindHandOff("en").ask(explainInstanceHandOff(instance, "prod-a", 4))!
    expect(prompt).toContain(
      'Ids: engine="prod-a", processInstanceId="pi-1", processDefinitionKey="order"\n',
    )
    expect(prompt).not.toMatch(/\bengine_[a-z0-9_]+/)
  })
})

describe("the Ask-AI intent catalogues", () => {
  const intents = Object.entries({ ...enAskAi, ...deAskAi }).filter(
    ([key]) => !key.endsWith("Label"),
  )

  // A tool named in an intent would reach every deployment, the read-only floor included.
  it("name no tool and inline no data", () => {
    for (const [key, text] of intents) {
      expect(text, key).not.toMatch(/\bengine_[a-z0-9_]+/)
      expect(text, key).not.toMatch(/[{}`]|\$\{/)
    }
  })

  it("stay short: the playbooks live in the server instructions", () => {
    for (const [key, text] of intents) expect(text.length, key).toBeLessThanOrEqual(300)
  })

  it("translate every intent", () => {
    expect(Object.keys(deAskAi).sort()).toEqual(Object.keys(enAskAi).sort())
    for (const key of Object.keys(enAskAi) as Array<keyof typeof enAskAi>) {
      if (key.endsWith("Label")) continue
      expect(deAskAi[key], key).not.toBe(enAskAi[key])
    }
  })
})
