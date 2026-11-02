import { describe, expect, it } from "vitest"
import {
  DEFAULT_ENVIRONMENT_ID,
  environmentOf,
  enginesByEnvironment,
  formatEnginesByEnvironment,
  groupEnginesByEnvironment,
} from "./environments.js"

describe("environmentOf", () => {
  it("returns the entry's environment, falling back to the default environment", () => {
    expect(environmentOf({ environment: "prod-eu" })).toBe("prod-eu")
    expect(environmentOf({})).toBe(DEFAULT_ENVIRONMENT_ID)
  })
})

describe("groupEnginesByEnvironment", () => {
  it("groups by environment in first-appearance order, keeping engine order within a group", () => {
    expect(
      groupEnginesByEnvironment([
        { id: "a", environment: "prod-eu" },
        { id: "b", environment: "prod-us" },
        { id: "c", environment: "prod-eu" },
      ]),
    ).toEqual([
      {
        id: "prod-eu",
        engines: [
          { id: "a", environment: "prod-eu" },
          { id: "c", environment: "prod-eu" },
        ],
      },
      { id: "prod-us", engines: [{ id: "b", environment: "prod-us" }] },
    ])
  })

  it("yields exactly one default group for an environment-less list — the consumers' single-stage switch", () => {
    // The consumers' element shape: engine entries whose environment is optional.
    const engines: Array<{ id: string; environment?: string }> = [{ id: "a" }, { id: "b" }]
    expect(groupEnginesByEnvironment(engines)).toEqual([
      { id: DEFAULT_ENVIRONMENT_ID, engines: [{ id: "a" }, { id: "b" }] },
    ])
  })

  it("files environment-less entries into the default group next to explicit ones", () => {
    const engines: Array<{ id: string; environment?: string }> = [
      { id: "a" },
      { id: "b", environment: "prod-eu" },
    ]
    expect(groupEnginesByEnvironment(engines)).toEqual([
      { id: DEFAULT_ENVIRONMENT_ID, engines: [{ id: "a" }] },
      { id: "prod-eu", engines: [{ id: "b", environment: "prod-eu" }] },
    ])
  })

  it("returns no groups for no engines", () => {
    expect(groupEnginesByEnvironment([])).toEqual([])
  })
})

describe("formatEnginesByEnvironment", () => {
  it("names each environment's engines when more than one exists", () => {
    expect(
      formatEnginesByEnvironment([
        { id: "prod-eu", engines: [{ id: "a" }, { id: "c" }] },
        { id: "prod-us", engines: [{ id: "b" }] },
      ]),
    ).toBe("prod-eu: a, c; prod-us: b")
  })

  it("stays a flat id list for a single group — and empty for none", () => {
    expect(
      formatEnginesByEnvironment([
        { id: DEFAULT_ENVIRONMENT_ID, engines: [{ id: "a" }, { id: "b" }] },
      ]),
    ).toBe("a, b")
    expect(formatEnginesByEnvironment([])).toBe("")
  })
})

describe("enginesByEnvironment", () => {
  it("pairs each engine with its environment when more than one exists", () => {
    expect(
      enginesByEnvironment([
        { id: "prod-eu", engines: [{ id: "a" }, { id: "c" }] },
        { id: "prod-us", engines: [{ id: "b" }] },
      ]),
    ).toEqual(["prod-eu/a", "prod-eu/c", "prod-us/b"])
  })

  it("adds nothing for a single environment — or none", () => {
    expect(
      enginesByEnvironment([{ id: DEFAULT_ENVIRONMENT_ID, engines: [{ id: "a" }, { id: "b" }] }]),
    ).toBeUndefined()
    expect(enginesByEnvironment([])).toBeUndefined()
  })
})
