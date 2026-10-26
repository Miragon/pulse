import type { InstanceId } from "../../contract/index.js"
import { BulkRequests } from "../views/bulk-requests.js"
import type { BulkAction } from "./bulk-action.js"
import type { PreparedBulk } from "./bulk-write.js"
import type { DefinitionLoaded } from "./definition-reads.js"
import type { PanelContext } from "./panel-context.js"

export class SelectionPreview {
  constructor(private readonly context: PanelContext) {}

  async prepared(
    loaded: DefinitionLoaded,
    action: BulkAction,
    ids: readonly InstanceId[],
  ): Promise<PreparedBulk> {
    const page = await this.context.runtime.searchInstances(
      { definitionId: loaded.selected, instanceIds: ids },
      { limit: ids.length },
    )
    const eligible = page.items.filter((instance) => action.eligible(instance))
    const preview = {
      plan: {
        action,
        definitionId: loaded.selected,
        version: loaded.view.selectedVersion,
        ids: eligible.map((instance) => instance.id),
        skipped: ids.length - eligible.length,
      },
      selected: ids.length,
      firstRows: eligible,
    }
    return { preview, request: BulkRequests.of(loaded.view, preview) }
  }
}
