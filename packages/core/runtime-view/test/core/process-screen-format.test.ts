import {
  VariableConditionTypes,
  type ElementBadgeData,
  type InstanceListFilterData,
  type InstanceScopeCode,
  type ScopeCountsData,
  type VariableConditionData,
  type VariableConditionKindCode,
  type VariableOperatorCode,
  type VariableValueTypeCode,
} from "@miragon/pulse-screens"
import { describe, expect, expectTypeOf, test } from "vitest"
import {
  VariableConditionRules,
  type ElementBadge,
  type InstanceListFilter,
  type InstanceScope,
  type RefusedVariableCondition,
  type ScopeCounts,
  type VariableConditionView,
  type VariableOperator,
  type VariableValueType,
} from "../../src/core/protocol/index.js"

const OPERATORS: readonly VariableOperator[] = [
  "equals",
  "notEquals",
  "like",
  "greaterThan",
  "lessThan",
]
const TYPES: readonly (VariableValueType | undefined)[] = [
  undefined,
  "text",
  "number",
  "boolean",
  "date",
  "null",
]
const VALUES = ["42", "-0.5", "007", "1e3", "true", "false", "True", "", "late", "2026-03-15T10:00"]

describe("the definition view of the protocol", () => {
  test("copies the screens' JSON form of a badge, an instance list's filter and its counts, without importing it", () => {
    expectTypeOf<ElementBadge>().toEqualTypeOf<ElementBadgeData>()
    expectTypeOf<InstanceScope>().toEqualTypeOf<InstanceScopeCode>()
    expectTypeOf<ScopeCounts>().toEqualTypeOf<ScopeCountsData>()
    expectTypeOf<InstanceListFilter>().toEqualTypeOf<InstanceListFilterData>()
    expectTypeOf<VariableConditionView>().toEqualTypeOf<VariableConditionData>()
    expectTypeOf<VariableOperator>().toEqualTypeOf<VariableOperatorCode>()
    expectTypeOf<VariableValueType>().toEqualTypeOf<VariableValueTypeCode>()
    expectTypeOf<RefusedVariableCondition>().toEqualTypeOf<VariableConditionKindCode>()
  })

  test("reads a variable condition's type by the screens' rule, which the builder asks the engine by", () => {
    const conditions = OPERATORS.flatMap((operator) =>
      TYPES.flatMap((as) =>
        VALUES.map((value): VariableConditionView => ({
          name: "v",
          operator,
          value,
          ...(as === undefined ? {} : { as }),
        })),
      ),
    )

    expect(conditions.map((condition) => VariableConditionRules.typeOf(condition))).toEqual(
      conditions.map((condition) => VariableConditionTypes.of(condition)),
    )
  })
})
