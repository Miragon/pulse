import { describe, expect, it } from "vitest"
import type { PlanMigrationView } from "./plan-migration.js"
import { planMigrationText } from "./plan-migration-text.js"

const VIEW: PlanMigrationView = {
  planFile: ".pulse/migrations/invoice-v1-to-v2.migration.json",
  replaced: false,
  bpmnProcessId: "invoice",
  source: { version: 1, definitionId: "invoice:1:def-1" },
  target: { version: 2, definitionId: "invoice:2:def-2" },
  mappings: [
    { sourceElementId: "approve", targetElementId: "approve", from: "engine" },
    { sourceElementId: "check", targetElementId: "review", from: "--map" },
  ],
  leftOut: 1,
  problems: [
    {
      sourceElementId: "check",
      targetElementId: "review",
      message: "Activities have incompatible types",
    },
  ],
}

describe("planMigrationText", () => {
  it("prints the file, the process, the counts, the mappings and the problems", () => {
    expect(planMigrationText(VIEW, 100)).toBe(
      [
        "Plan file  .pulse/migrations/invoice-v1-to-v2.migration.json (new)",
        "Process    invoice v1 → v2",
        "Mappings   2 (1 from --map)",
        "Left out   1 instruction of the engine that is not one to one",
        "Check      1 problem",
        "",
        "Mappings:",
        "SOURCE   TARGET   FROM",
        "approve  approve  engine",
        "check    review   --map",
        "",
        "Problems:",
        "SOURCE  TARGET  MESSAGE",
        "check   review  Activities have incompatible types",
        "",
      ].join("\n"),
    )
  })

  it("leaves out what is not there: left out, problems, mappings of --map", () => {
    const text = planMigrationText(
      {
        ...VIEW,
        replaced: true,
        mappings: VIEW.mappings.slice(0, 1),
        leftOut: 0,
        problems: [],
      },
      100,
    )
    expect(text).toBe(
      [
        "Plan file  .pulse/migrations/invoice-v1-to-v2.migration.json (replaced)",
        "Process    invoice v1 → v2",
        "Mappings   1",
        "Check      no problems",
        "",
        "Mappings:",
        "SOURCE   TARGET   FROM",
        "approve  approve  engine",
        "",
      ].join("\n"),
    )
  })

  it("counts several left out instructions and problems, one without its mapping", () => {
    const text = planMigrationText(
      {
        ...VIEW,
        mappings: [],
        leftOut: 2,
        problems: [...VIEW.problems, { message: "Variables are not valid" }],
      },
      100,
    )
    expect(text).toContain("\nLeft out   2 instructions of the engine that are not one to one\n")
    expect(text).toContain("\nCheck      2 problems\n")
    expect(text).not.toContain("Mappings:")
    expect(text).toMatch(/\n {16}Variables are not valid\n$/)
  })
})
