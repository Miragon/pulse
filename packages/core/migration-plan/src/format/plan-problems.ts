import type { MigrationPlanNote, MigrationPlanProblem } from "./plan-definition.js"
import { MigrationPlanRules } from "./plan-rules.js"

type PlainCode = Exclude<
  MigrationPlanProblem | MigrationPlanNote,
  { readonly values: unknown }
>["code"]

export class MigrationPlanProblems {
  private static readonly PLAIN: Readonly<Record<PlainCode, string>> = {
    notJson: "is not valid JSON",
    notAnObject: "must be an object",
    notAList: "must be a list",
    missing: "is missing",
    notAProcessId: `must be a BPMN process id: letters, digits, _, . or -, starting with a letter or _, at most ${String(MigrationPlanRules.MAX_ID_LENGTH)} characters`,
    notAVersion: `must be a version number from 1 to ${String(MigrationPlanRules.MAX_VERSION)}`,
    sameVersion: "must name another version than source.version",
    notAnElementId: "must be a BPMN element id, or an element id with one # part for its scope",
    enginePlan:
      "is a key of the engine's own plan, which names definition ids; a Pulse plan names the process and its version numbers: write one with pulse plan-migration",
    ignoredKey: "is not a key this version of Pulse knows; Pulse reads the plan without it",
    schemaNotText:
      "must be a text, the path or URL of the plan schema; Pulse reads the plan without it",
  }

  static describe(problem: MigrationPlanProblem | MigrationPlanNote): string {
    switch (problem.code) {
      case "tooLarge":
        return `is longer than ${String(problem.values.max)} characters`
      case "tooManyMappings":
        return `has more than ${String(problem.values.max)} mappings`
      case "unknownKey":
        return `is not a known key; use ${problem.values.choices.join(", ")}`
      case "unknownVersion":
        return `is ${problem.values.found}; this version of Pulse reads version ${String(problem.values.reads)}`
      case "sourceTwice":
        return `maps an element that mappings[${String(problem.values.first)}] maps already; a plan maps each element once`
      case "notInAPlan":
        return "has no place in a plan, which names no instance, engine, tenant, definition id or engine option; remove it"
      default:
        return MigrationPlanProblems.PLAIN[problem.code]
    }
  }
}
