/**
 * `pulse inspect`: where a process instance waits and why. The rounds of requests and the
 * instance view are @miragon/pulse-c7-core's; the view's next steps become command lines.
 */

import * as core from "@miragon/pulse-c7-core"
import type { EnginePort } from "../engine-port/engine-port.js"
import { renderedAsync } from "./error-text.js"
import { nextCommand } from "./next-text.js"
import { checkSelection, type Selection, selectInstance } from "./select.js"
import type { InstanceView, WorkflowResult } from "./types.js"

/** The instance view with its next steps as command lines. */
export function cliView(view: core.InstanceView): InstanceView {
  return { ...view, next: view.next.map(nextCommand) }
}

/**
 * The instance view of `id`; NOT_FOUND when neither runtime nor history know it. An instance that
 * ends while the rounds run (a job executor finished it) is loaded once more, then as ended.
 */
export async function loadInstance(
  port: EnginePort,
  id: string,
  options: core.InspectOptions,
): Promise<InstanceView> {
  return cliView(await renderedAsync(core.loadInstance(port, id, options)))
}

/**
 * The view after a write: an instance that ended without a history record (history level none)
 * is `{id, state: "ENDED"}` instead of NOT_FOUND.
 */
export async function loadView(
  port: EnginePort,
  id: string,
  options: core.InspectOptions,
): Promise<InstanceView | core.EndedInstance> {
  const view = await core.loadView(port, id, options)
  return "next" in view ? cliView(view) : view
}

/** `pulse inspect`: the first round only with `--dry-run`, else the view. */
export async function inspect(
  port: EnginePort,
  selection: Selection,
  options: core.InspectOptions & { readonly dryRun: boolean },
): Promise<WorkflowResult<InstanceView>> {
  checkSelection(selection)
  if (options.dryRun) {
    const requests = core.selectionRequests(selection)
    return {
      kind: "dry-run",
      requests: requests.length > 0 ? requests : core.instanceRequests(selection.id ?? ""),
    }
  }
  const id = await selectInstance(port, selection, "inspect")
  return { kind: "view", view: await loadInstance(port, id, options) }
}
