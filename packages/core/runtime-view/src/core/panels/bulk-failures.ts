import { BulkFailureText } from "../views/bulk-failure-text.js"
import type { BulkRun } from "./bulk-run.js"
import type { PanelContext } from "./panel-context.js"

export class BulkFailures {
  static async note(context: PanelContext, run: BulkRun): Promise<void> {
    const operationId = run.operationId
    if (run.progress.failed > 0 && run.failures === undefined && operationId !== undefined) {
      run.noteFailures(await context.runtime.getBulkFailures(operationId))
    }
  }

  static async show(context: PanelContext, run: BulkRun): Promise<void> {
    const failures = run.failures ?? []
    if (failures.length === 0) {
      return
    }
    const named = failures.flatMap((failure) =>
      failure.instanceId !== undefined && run.plan.ids.includes(failure.instanceId)
        ? [failure.instanceId]
        : [],
    )
    const stillThere =
      named.length === 0
        ? []
        : (
            await context.runtime.searchInstances(
              run.plan.action.eligibleFilter({ instanceIds: named }),
              { limit: named.length },
            )
          ).items
    const text = new BulkFailureText(run, stillThere).text()
    context.effects.showIncidentDetails(BulkFailureText.titleOf(run), {
      kind: "errorMessage",
      text,
      truncated: false,
    })
  }
}
