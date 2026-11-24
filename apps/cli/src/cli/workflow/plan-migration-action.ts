/**
 * The action of `pulse plan-migration`: the version arguments as whole numbers, the lists of
 * `--map` and `--unmap`, the read guard, then the plan file and its view.
 */

import { convertScalar } from "../../operation/values.js"
import { compact } from "../../util.js"
import { notAVersion, planMigration } from "../../workflow/plan-migration.js"
import { planMigrationText } from "../../workflow/plan-migration-text.js"
import { emitResult, guard, type WorkflowRun } from "./register.js"
import { list, text } from "./values.js"

const WHOLE_NUMBER = /^-?\d+$/

/**
 * A version argument: any whole number, so the plan's rule words one out of range (here one no
 * number holds exactly, to quote it as typed); other text fails as `integer()` words an option.
 */
function version(raw: string, name: string, key: string): number {
  if (!WHOLE_NUMBER.test(raw)) {
    // Always throws: `<source> expects an integer, got "one"`.
    return Number(convertScalar({ type: "integer" }, raw, `<${name}>`))
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw notAVersion(raw, name, key)
  return value
}

export async function runPlanMigration(run: WorkflowRun): Promise<void> {
  const { args, flags } = run.values
  const key = args[0] ?? ""
  const target = args[2]
  const options = {
    key,
    source: version(args[1] ?? "", "source", key),
    ...compact({
      target: target === undefined ? undefined : version(target, "target", key),
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
