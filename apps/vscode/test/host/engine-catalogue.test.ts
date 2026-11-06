import { describe, expect, test } from "vitest"
import { CATALOGUE, LOCAL_TARGET } from "./support/engines.js"

describe("the engine catalogue the composition root builds from the adapters", () => {
  test.each([
    [undefined, "c7"],
    ["camunda7", "c7"],
    ["cibseven", "c7"],
    ["operaton", "c7"],
    ["camunda8", "c8"],
    ["camunda9", undefined],
    [" camunda8", undefined],
    [8, undefined],
  ])("serves the flavor %j with the engine %j", (flavor, engine) => {
    expect(CATALOGUE.engineOf(flavor)).toBe(engine)
  })

  test("names the flavors and who takes client credentials as the problem texts always did", () => {
    expect(CATALOGUE.flavors()).toBe("camunda7, cibseven, operaton or camunda8")
    expect(CATALOGUE.flavorsSending("clientCredentials")).toBe("the flavor camunda8")
    expect(CATALOGUE.flavorsSending("basic")).toBe(
      "the flavors camunda7, cibseven, operaton or camunda8",
    )
    expect(CATALOGUE.credentialTypesOf("c7")).toEqual(["basic"])
    expect(CATALOGUE.credentialTypesOf("c8")).toEqual(["basic", "clientCredentials"])
    expect(CATALOGUE.credentialTypesOf("unknown")).toEqual([])
  })

  test("offers each adapter's setups first, then the project file for an adapter without one", () => {
    const choices = CATALOGUE.choices()

    expect(choices.map((choice) => [choice.label, choice.setup !== undefined])).toEqual([
      ["Camunda 8 SaaS", true],
      ["Camunda 8 Self-Managed", true],
      ["Camunda 7, Operaton or CIB seven", false],
    ])
    expect(choices.at(-1)?.detail).toBe(
      "Opens .pulse-cli.json, with a profile to fill in if the folder has none yet.",
    )
  })

  test("falls back to the local engine of the adapter that names one", () => {
    expect(CATALOGUE.localTarget()).toEqual(LOCAL_TARGET)
  })
})
