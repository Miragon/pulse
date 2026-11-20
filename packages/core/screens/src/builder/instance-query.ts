import {
  ElementId,
  IsoTimestamp,
  type DefinitionId,
  type InstanceFilter,
  type VariableComparison,
  type VariableCondition,
} from "@miragon/pulse-engine-core"
import type {
  InstanceListFilterData,
  InstanceScopeCode,
  VariableConditionData,
  VariableValueTypeCode,
} from "../format/instance-list-data.js"
import { VariableConditionTypes } from "../format/variable-condition-types.js"

type ComparisonOf = (name: string, operator: VariableComparison, value: string) => VariableCondition

const ZONED = /(?:Z|[+-]\d{2}:\d{2})$/

const SCOPES: Readonly<
  Record<InstanceScopeCode, Pick<InstanceFilter, "lifecycle" | "withIncident">>
> = {
  running: { lifecycle: "running" },
  withIncident: { lifecycle: "running", withIncident: true },
  ended: { lifecycle: "ended" },
  all: {},
}

export class InstanceQuery {
  private static readonly COMPARISONS: Readonly<Record<VariableValueTypeCode, ComparisonOf>> = {
    text: (name, operator, value) => ({ name, operator, valueJson: JSON.stringify(value) }),
    number: (name, operator, value) => ({ name, operator, valueJson: value }),
    boolean: (name, operator, value) => ({ name, operator, valueJson: value }),
    date: (name, operator, value) => ({ name, operator, at: InstanceQuery.instantOf(value) }),
    null: (name, operator) => ({ name, operator, valueJson: "null" }),
  }

  static of(definitionId: DefinitionId, filter: InstanceListFilterData): InstanceFilter {
    const { elementId, businessKey, variables } = filter
    return {
      definitionId,
      ...SCOPES[filter.scope],
      ...(elementId === undefined ? {} : { activeElementId: ElementId(elementId) }),
      ...(businessKey === undefined ? {} : { businessKey }),
      ...(variables === undefined
        ? {}
        : { variables: variables.map((condition) => InstanceQuery.conditionOf(condition)) }),
    }
  }

  static conditionOf(condition: VariableConditionData): VariableCondition {
    const { name, operator, value } = condition
    if (operator === "like") {
      return { name, operator, pattern: value }
    }
    return InstanceQuery.COMPARISONS[VariableConditionTypes.of(condition)](name, operator, value)
  }

  private static instantOf(value: string): IsoTimestamp {
    if (!ZONED.test(value)) {
      throw new RangeError(
        `The date "${value}" names no offset; the surface reads its user's time zone into it`,
      )
    }
    return IsoTimestamp(value)
  }
}
