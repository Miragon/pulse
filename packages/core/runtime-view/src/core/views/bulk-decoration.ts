import { InstanceId, type InstanceSummary } from "../../contract/index.js"
import type { OfferedBulkAction } from "../panels/bulk-action.js"
import type { BulkRun } from "../panels/bulk-run.js"
import type { BulkSelection } from "../panels/bulk-selection.js"
import type { DefinitionView, InstanceRow, SelectionView } from "../protocol/index.js"
import { BulkOutcomes, type BulkScene } from "./bulk-outcomes.js"
import { Labels } from "./labels.js"

export interface BulkState {
  readonly run: BulkRun | undefined
  readonly selection: BulkSelection
  readonly instances: readonly InstanceSummary[]
  readonly migrates: boolean
  readonly scene: Omit<BulkScene, "shownVersion">
}

export class BulkDecoration {
  constructor(private readonly actions: readonly [OfferedBulkAction, ...OfferedBulkAction[]]) {}

  static selects(view: Pick<DefinitionView, "filter">, canWrite: boolean): boolean {
    return canWrite && view.filter.scope !== "ended"
  }

  decorate(view: DefinitionView, state: BulkState): DefinitionView {
    const selecting = BulkDecoration.selects(view, state.scene.canWrite)
    const selection = selecting ? this.selectionOf(view, state) : undefined
    const { run } = state
    return {
      ...view,
      instances: selecting ? this.rowsOf(view.instances, state) : view.instances,
      ...(selection === undefined ? {} : { selection }),
      ...(run === undefined
        ? {}
        : {
            bulk: new BulkOutcomes(run, {
              ...state.scene,
              shownVersion: view.selectedVersion,
            }).view(),
          }),
    }
  }

  private selectionOf(view: DefinitionView, state: BulkState): SelectionView | undefined {
    const [selecting] = this.actions
    return state.selection.view({
      eligible: selecting.wording.eligible,
      matching: selecting.matching(view.filter, view.scopeCounts),
      offers: this.actions.map((action) => ({ action: action.kind, label: action.wording.offer })),
      ...(state.migrates ? { migration: "Migrate to version…" } : {}),
      ...this.blocked(state.run),
    })
  }

  private blocked(run: BulkRun | undefined): { readonly blockedBy?: string } {
    if (run?.isActive() !== true) {
      return {}
    }
    const what = Labels.plural(run.progress.total, "instance")
    return { blockedBy: `Wait until ${run.plan.action.wording.doing.toLowerCase()} ${what} ends` }
  }

  private rowsOf(rows: readonly InstanceRow[], state: BulkState): InstanceRow[] {
    const eligible = new Set(
      state.instances
        .filter((instance) => this.actions.some((action) => action.eligible(instance)))
        .map((instance) => instance.id),
    )
    return rows.map((row) => {
      const id = InstanceId(row.id)
      if (!eligible.has(id)) {
        return row
      }
      return { ...row, selectable: true, ...(state.selection.has(id) ? { selected: true } : {}) }
    })
  }
}
