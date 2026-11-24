import { describe, expect, test } from "vitest"
import { MigrationPlanRules } from "../../src/index.js"

const LONGEST = `a${"b".repeat(254)}`

describe("a process id", () => {
  test.each(["order-fulfillment", "_invoice", "Rechnung.prüfen", "a·b", "Ünterschrift", LONGEST])(
    "is a name: %s",
    (id) => {
      expect(MigrationPlanRules.isProcessId(id)).toBe(true)
    },
  )

  test.each([
    "",
    "1invoice",
    ".invoice",
    "-invoice",
    "invoice:1:def-1",
    "a/b",
    "a\\b",
    "a#b",
    "a b",
    `${LONGEST}c`,
  ])("is no name: %j", (id) => {
    expect(MigrationPlanRules.isProcessId(id)).toBe(false)
  })

  test("is a text", () => {
    expect(MigrationPlanRules.isProcessId(1)).toBe(false)
    expect(MigrationPlanRules.isProcessId(undefined)).toBe(false)
  })

  test("is at most as long as the rules say", () => {
    expect(LONGEST).toHaveLength(MigrationPlanRules.MAX_ID_LENGTH)
  })
})

describe("an element id", () => {
  test.each(["Activity_Pack", "Activity_Pack#multiInstanceBody", `${LONGEST}#${LONGEST}`])(
    "is a name, or a name with one scope part: %s",
    (id) => {
      expect(MigrationPlanRules.isElementId(id)).toBe(true)
    },
  )

  test.each(["", "#", "a#", "#b", "a#b#c", "a:b", "1a", "a#1b", `${LONGEST}c#b`])(
    "is none of these: %j",
    (id) => {
      expect(MigrationPlanRules.isElementId(id)).toBe(false)
    },
  )

  test("is a text", () => {
    expect(MigrationPlanRules.isElementId(null)).toBe(false)
  })
})

describe("a version", () => {
  test.each([1, 4, MigrationPlanRules.MAX_VERSION])("is a whole number in range: %d", (version) => {
    expect(MigrationPlanRules.isVersion(version)).toBe(true)
  })

  test.each([0, -1, 1.5, MigrationPlanRules.MAX_VERSION + 1, Number.NaN, "3", undefined])(
    "is none of these: %j",
    (version) => {
      expect(MigrationPlanRules.isVersion(version)).toBe(false)
    },
  )
})
