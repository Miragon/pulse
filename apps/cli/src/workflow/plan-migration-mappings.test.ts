import { describe, expect, it } from "vitest"
import { applyEdits, parseEdits, usablePairs } from "./plan-migration-mappings.js"

const PROPOSAL = [
  { sourceElementId: "check", targetElementId: "check" },
  { sourceElementId: "approve", targetElementId: "approve" },
  { sourceElementId: "notify", targetElementId: "notify" },
]

const MAP_HINT =
  "Name element ids of the BPMN models, e.g. --map Activity_CheckOrder=Activity_Review"

describe("parseEdits", () => {
  it("reads --map at its first = and --unmap, scope pairs included", () => {
    expect(
      parseEdits(["check=review", "pack#multiInstanceBody=box#multiInstanceBody"], ["x"]),
    ).toEqual({
      map: new Map([
        ["check", "review"],
        ["pack#multiInstanceBody", "box#multiInstanceBody"],
      ]),
      unmap: new Set(["x"]),
    })
    expect(parseEdits([], ["x", "x"]).unmap).toEqual(new Set(["x"]))
  })

  it.each([
    [["check"], [], '--map expects <source>=<target>, got "check"'],
    [
      ["=review"],
      [],
      '--map =review: "" must be a BPMN element id, or an element id with one # part for its scope',
    ],
    [
      ["check=a=b"],
      [],
      '--map check=a=b: "a=b" must be a BPMN element id, or an element id with one # part for its scope',
    ],
    [
      ["a#b#c=d"],
      [],
      '--map a#b#c=d: "a#b#c" must be a BPMN element id, or an element id with one # part for its scope',
    ],
    [
      [],
      ["1st"],
      '--unmap 1st: "1st" must be a BPMN element id, or an element id with one # part for its scope',
    ],
  ])("refuses --map %j --unmap %j", (map, unmap, message) => {
    expect(() => parseEdits(map, unmap)).toThrow(
      expect.objectContaining({ code: "USAGE", message, details: { hint: MAP_HINT } }),
    )
  })

  it("refuses a source mapped twice or both mapped and left out", () => {
    expect(() => parseEdits(["check=a", "check=b"], [])).toThrow(
      expect.objectContaining({
        code: "USAGE",
        message: "--map maps check twice",
        details: { hint: "Map each element of the source version once." },
      }),
    )
    expect(() => parseEdits(["check=a"], ["check"])).toThrow(
      expect.objectContaining({
        message: "--map and --unmap both name check",
        details: {
          hint: "Map check with --map, or leave the engine's mapping of it out with --unmap.",
        },
      }),
    )
  })
})

describe("applyEdits", () => {
  it("keeps the engine's mappings sorted by source", () => {
    expect(applyEdits(PROPOSAL, parseEdits([], []))).toEqual([
      { sourceElementId: "approve", targetElementId: "approve", from: "engine" },
      { sourceElementId: "check", targetElementId: "check", from: "engine" },
      { sourceElementId: "notify", targetElementId: "notify", from: "engine" },
    ])
  })

  it("drops --unmap, replaces the engine's mapping of a --map source and adds the others", () => {
    expect(applyEdits(PROPOSAL, parseEdits(["check=review", "Zeta=Zeta"], ["notify"]))).toEqual([
      { sourceElementId: "Zeta", targetElementId: "Zeta", from: "--map" },
      { sourceElementId: "approve", targetElementId: "approve", from: "engine" },
      { sourceElementId: "check", targetElementId: "review", from: "--map" },
    ])
  })

  it("refuses --unmap of a source the engine does not map", () => {
    expect(() => applyEdits(PROPOSAL, parseEdits([], ["review"]))).toThrow(
      expect.objectContaining({
        code: "USAGE",
        message: "The engine proposes no mapping for review",
        details: {
          hint: "--unmap takes the source element of a mapping the engine proposes; without it the view lists them (from engine).",
        },
      }),
    )
  })
})

describe("usablePairs", () => {
  it("keeps the pairs a plan file holds, each source once, and counts the rest", () => {
    expect(
      usablePairs([
        { sourceElementId: "a", targetElementId: "a" },
        { sourceElementId: "a", targetElementId: "b" },
        { sourceElementId: "x y", targetElementId: "x" },
        { sourceElementId: "c", targetElementId: "d:e" },
        { sourceElementId: "pack#multiInstanceBody", targetElementId: "pack#multiInstanceBody" },
      ]),
    ).toEqual({
      pairs: [
        { sourceElementId: "a", targetElementId: "a" },
        { sourceElementId: "pack#multiInstanceBody", targetElementId: "pack#multiInstanceBody" },
      ],
      unusable: 3,
    })
  })
})
