/**
 * Instance selection of inspect, wait, advance and retry: a process instance id,
 * or `--business-key` / `--process-definition-key` (with `--latest`) resolved against history
 * and runtime, by @miragon/pulse-engine-core; its errors name the flags and ready commands.
 */

import * as core from "@miragon/pulse-engine-core"
import type { EnginePort } from "../engine-port/engine-port.js"
import { rendered, renderedAsync } from "./error-text.js"

export interface Selection extends core.Selection {
  /**
   * The other words of the command line, shell quoted: the ready commands of an ambiguous
   * selection keep them, so a copied command does what the original would have done.
   */
  readonly options?: readonly string[]
}

/** Usage errors of the selection options; nothing is sent before this passed. */
export function checkSelection(selection: Selection): void {
  rendered(() => {
    core.checkSelection(selection)
  })
}

/** The id of the selected instance; filters are resolved in parallel against history and runtime. */
export async function selectInstance(
  port: EnginePort,
  selection: Selection,
  command: string,
): Promise<string> {
  return renderedAsync(core.selectInstance(port, selection), {
    command,
    ...(selection.options === undefined ? {} : { options: selection.options }),
  })
}
