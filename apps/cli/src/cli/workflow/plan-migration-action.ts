/**
 * The action of `pulse plan-migration`: the version arguments as whole numbers, the lists of
 * `--map` and `--unmap`, the read guard, then the plan file and its view.
 */

import { convertScalar } from "../../operation/values.js"
import { compact } from "../../util.js"
import { planMigration } from "../../workflow/plan-migration.js"
import { planMigrationText } from "../../workflow/plan-migration-text.js"
import { emitResult, guard, type WorkflowRun } from "./register.js"
import { list, text } from "./values.js"

/** A version argument as `integer()` reads an option: an int32; the range is the plan's rule. */
function version(raw: string, name: string): number {
  return Number(convertScalar({ type: "integer", format: "int32" }, raw, `<${name}>`))
}

export async function runPlanMigration(run: WorkflowRun): Promise<void> {
  const { args, flags } = run.values
  const target = args[2]
  const options = {
    key: args[0] ?? "",
    source: version(args[1] ?? "", "source"),
    ...compact({
      target: target === undefined ? undefined : version(target, "target"),
      planFile: text(flags, "plan-file"),
    }),
    map: list(flags, "map"),
    unmap: list(flags, "unmap"),
    dryRun: run.session.globals.dryRun,
  }
  guard(run, "read")
  const deps = { ...run.deps, fs: run.context.runtime.fs }
  await emitResult(run, await planMigration(deps, options), planMigrationText)
}
