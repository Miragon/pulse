/**
 * Table format of the view of `pulse plan-migration`: the plan file, the process and its two
 * versions, the counts, then the mappings and the engine's problems. Pure.
 */

import { plural } from "./findings.js"
import type { PlanMigrationView } from "./plan-migration.js"
import { headerBlock, section } from "./text.js"

function leftOutText(leftOut: number): string | undefined {
  if (leftOut === 0) return undefined
  const verb = leftOut === 1 ? "is" : "are"
  return `${plural(leftOut, "instruction")} of the engine that ${verb} not one to one`
}

function headerLines(view: PlanMigrationView): string[] {
  const count = view.mappings.length
  const mapped = view.mappings.filter((mapping) => mapping.from === "--map").length
  const problems = view.problems.length
  return headerBlock([
    ["Plan file", `${view.planFile} (${view.replaced ? "replaced" : "new"})`],
    [
      "Process",
      `${view.bpmnProcessId} v${String(view.source.version)} → v${String(view.target.version)}`,
    ],
    ["Mappings", mapped === 0 ? String(count) : `${String(count)} (${String(mapped)} from --map)`],
    ["Left out", leftOutText(view.leftOut)],
    ["Check", problems === 0 ? "no problems" : plural(problems, "problem")],
  ])
}

export function planMigrationText(view: PlanMigrationView, maxWidth: number): string {
  const mappings = section(
    {
      title: "Mappings:",
      columns: ["SOURCE", "TARGET", "FROM"],
      rows: view.mappings.map((mapping) => ({
        SOURCE: mapping.sourceElementId,
        TARGET: mapping.targetElementId,
        FROM: mapping.from,
      })),
      fixed: ["SOURCE", "TARGET"],
    },
    maxWidth,
  )
  const problems = section(
    {
      title: "Problems:",
      columns: ["SOURCE", "TARGET", "MESSAGE"],
      rows: view.problems.map((problem) => ({
        SOURCE: problem.sourceElementId ?? "",
        TARGET: problem.targetElementId ?? "",
        MESSAGE: problem.message,
      })),
      fixed: ["SOURCE", "TARGET"],
    },
    maxWidth,
  )
  return `${[...headerLines(view), ...mappings, ...problems].join("\n")}\n`
}
