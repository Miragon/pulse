import { describe, expect, it } from "vitest"
import * as format from "./index.js"

describe("the @miragon/pulse-migration-plan entry", () => {
  it("exports exactly the parser, the words of its problems, the writer, the file names, the id and version rules, the version pick and the vocabulary of the plan file format", () => {
    expect(Object.keys(format).sort()).toStrictEqual([
      "MigrationPlanFiles",
      "MigrationPlanParser",
      "MigrationPlanProblems",
      "MigrationPlanRules",
      "MigrationPlanText",
      "MigrationPlanVersions",
      "MigrationPlanVocabulary",
    ])
  })
})
